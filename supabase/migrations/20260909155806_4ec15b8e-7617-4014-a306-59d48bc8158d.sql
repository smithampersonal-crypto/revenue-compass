-- =========================================================
-- ARC Phase 7A core schema
-- =========================================================

create type public.arc_contract_status as enum ('active', 'archived');
create type public.arc_revision_status as enum ('draft', 'finalized', 'superseded');
create type public.arc_guest_workspace_status as enum ('active', 'migrating', 'migrated', 'expired');

-- ---------- customers ----------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.customers to authenticated;
grant all on public.customers to service_role;
alter table public.customers enable row level security;

-- ---------- contracts ----------
create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  contract_number text,
  title text not null check (length(trim(title)) > 0),
  status public.arc_contract_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.contracts to authenticated;
grant all on public.contracts to service_role;
alter table public.contracts enable row level security;

-- ---------- analyses ----------
create table public.analyses (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null unique references public.contracts(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.analyses to authenticated;
grant all on public.analyses to service_role;
alter table public.analyses enable row level security;

-- ---------- analysis_revisions ----------
create table public.analysis_revisions (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.analyses(id) on delete cascade,
  revision_number integer not null check (revision_number > 0),
  status public.arc_revision_status not null default 'draft',
  supersedes_revision_id uuid references public.analysis_revisions(id),
  canonical_inputs jsonb not null,
  engine_outputs jsonb,
  reconciliation_snapshot jsonb,
  schema_version text not null,
  engine_version text,
  lock_version integer not null default 1 check (lock_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finalized_at timestamptz,
  unique (analysis_id, revision_number)
);
grant select, insert, update, delete on public.analysis_revisions to authenticated;
grant all on public.analysis_revisions to service_role;
alter table public.analysis_revisions enable row level security;

alter table public.analyses
  add column current_finalized_revision_id uuid references public.analysis_revisions(id);

create unique index analysis_one_active_draft
  on public.analysis_revisions (analysis_id)
  where status = 'draft';

create index customers_owner_user_id_idx on public.customers (owner_user_id);
create index contracts_customer_id_idx on public.contracts (customer_id);
create index analysis_revisions_analysis_id_idx on public.analysis_revisions (analysis_id);
create index analysis_revisions_supersedes_idx on public.analysis_revisions (supersedes_revision_id);

-- ---------- guest_workspaces (server-only) ----------
create table public.guest_workspaces (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  draft_json jsonb not null,
  schema_version text not null,
  lock_version integer not null default 1 check (lock_version > 0),
  status public.arc_guest_workspace_status not null default 'active',
  migrated_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null
);
revoke all on public.guest_workspaces from anon, authenticated;
grant all on public.guest_workspaces to service_role;
alter table public.guest_workspaces enable row level security;
create index guest_workspaces_expires_at_idx on public.guest_workspaces (expires_at);

-- =========================================================
-- updated_at maintenance
-- =========================================================
create or replace function public.arc_set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger customers_set_updated_at before update on public.customers
  for each row execute function public.arc_set_updated_at();
create trigger contracts_set_updated_at before update on public.contracts
  for each row execute function public.arc_set_updated_at();
create trigger analyses_set_updated_at before update on public.analyses
  for each row execute function public.arc_set_updated_at();
create trigger guest_workspaces_set_updated_at before update on public.guest_workspaces
  for each row execute function public.arc_set_updated_at();

-- =========================================================
-- Revision immutability: finalized / superseded snapshots are frozen.
-- The only permitted transition is finalized -> superseded, which may
-- change status and updated_at and nothing else.
-- =========================================================
create or replace function public.arc_protect_revision_immutability()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' then
    if old.status = 'draft' then
      new.updated_at := now();
      return new;
    end if;

    if old.status = 'finalized' and new.status = 'superseded'
       and new.id = old.id
       and new.analysis_id = old.analysis_id
       and new.revision_number = old.revision_number
       and new.canonical_inputs is not distinct from old.canonical_inputs
       and new.engine_outputs is not distinct from old.engine_outputs
       and new.reconciliation_snapshot is not distinct from old.reconciliation_snapshot
       and new.schema_version is not distinct from old.schema_version
       and new.engine_version is not distinct from old.engine_version
       and new.supersedes_revision_id is not distinct from old.supersedes_revision_id
       and new.finalized_at is not distinct from old.finalized_at
       and new.created_at = old.created_at
       and new.lock_version = old.lock_version
    then
      new.updated_at := now();
      return new;
    end if;

    raise exception
      'analysis revision % is % and immutable; create a new draft revision instead',
      old.id, old.status
      using errcode = '42501';
  end if;

  -- DELETE
  if old.status in ('finalized', 'superseded') then
    -- Permitted only as part of owner account deletion, where the owning
    -- auth user row has already been removed in the same transaction.
    if exists (
      select 1
      from public.analyses a
      join public.contracts c on c.id = a.contract_id
      join public.customers cu on cu.id = c.customer_id
      join auth.users u on u.id = cu.owner_user_id
      where a.id = old.analysis_id
    ) then
      raise exception
        'analysis revision % is % and cannot be deleted', old.id, old.status
        using errcode = '42501';
    end if;
  end if;

  return old;
end;
$$;

create trigger analysis_revisions_immutability
  before update or delete on public.analysis_revisions
  for each row execute function public.arc_protect_revision_immutability();

-- =========================================================
-- RLS policies (ownership derived through joins, never client input)
-- =========================================================
create policy "customers_owner_all" on public.customers
  for all to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

create policy "contracts_owner_all" on public.contracts
  for all to authenticated
  using (exists (
    select 1 from public.customers c
    where c.id = contracts.customer_id and c.owner_user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.customers c
    where c.id = contracts.customer_id and c.owner_user_id = auth.uid()
  ));

create policy "analyses_owner_all" on public.analyses
  for all to authenticated
  using (exists (
    select 1 from public.contracts ct
    join public.customers c on c.id = ct.customer_id
    where ct.id = analyses.contract_id and c.owner_user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.contracts ct
    join public.customers c on c.id = ct.customer_id
    where ct.id = analyses.contract_id and c.owner_user_id = auth.uid()
  ));

create policy "analysis_revisions_owner_all" on public.analysis_revisions
  for all to authenticated
  using (exists (
    select 1 from public.analyses a
    join public.contracts ct on ct.id = a.contract_id
    join public.customers c on c.id = ct.customer_id
    where a.id = analysis_revisions.analysis_id and c.owner_user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.analyses a
    join public.contracts ct on ct.id = a.contract_id
    join public.customers c on c.id = ct.customer_id
    where a.id = analysis_revisions.analysis_id and c.owner_user_id = auth.uid()
  ));

-- guest_workspaces intentionally has RLS enabled with no policies:
-- unreachable for anon/authenticated, service-role server code only.