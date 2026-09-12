-- ARC Phase 8A — source document schema, ownership guards, RLS and grants.

create table public.source_documents (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid references public.contracts(id) on delete cascade,
  guest_workspace_id uuid references public.guest_workspaces(id) on delete cascade,
  storage_bucket text not null default 'arc-source-documents',
  storage_object_path text not null unique,
  original_filename text not null,
  display_name text not null,
  document_type text,
  effective_date date,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size bigint not null check (byte_size > 0 and byte_size <= 10485760),
  page_count integer not null check (page_count > 0 and page_count <= 500),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((contract_id is not null)::int + (guest_workspace_id is not null)::int = 1),
  check (storage_bucket = 'arc-source-documents'),
  check (document_type is null or document_type in (
    'Master Agreement','Order Form','Statement of Work','Amendment',
    'Renewal','Pricing / Exhibit','Other'
  ))
);

create unique index source_documents_contract_sha256_key
  on public.source_documents(contract_id, sha256) where contract_id is not null;
create unique index source_documents_guest_sha256_key
  on public.source_documents(guest_workspace_id, sha256) where guest_workspace_id is not null;
create index source_documents_contract_idx on public.source_documents(contract_id);
create index source_documents_guest_idx on public.source_documents(guest_workspace_id);

create table public.revision_source_documents (
  revision_id uuid not null references public.analysis_revisions(id) on delete cascade,
  source_document_id uuid not null references public.source_documents(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (revision_id, source_document_id)
);
create index revision_source_documents_document_idx
  on public.revision_source_documents(source_document_id);

create table public.guest_source_document_selections (
  guest_workspace_id uuid not null references public.guest_workspaces(id) on delete cascade,
  source_document_id uuid not null references public.source_documents(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (guest_workspace_id, source_document_id)
);

create table public.document_upload_intents (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid references public.contracts(id) on delete cascade,
  guest_workspace_id uuid references public.guest_workspaces(id) on delete cascade,
  target_revision_id uuid references public.analysis_revisions(id) on delete set null,
  pending_object_path text not null unique,
  permanent_document_id uuid,
  permanent_object_path text,
  resolved_source_document_id uuid references public.source_documents(id) on delete set null,
  original_filename text not null,
  display_name text not null,
  document_type text,
  effective_date date,
  validated_sha256 text,
  validated_byte_size bigint,
  validated_page_count integer,
  is_duplicate boolean,
  state text not null default 'pending' check (state in ('pending','prepared','finalized','failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check ((contract_id is not null)::int + (guest_workspace_id is not null)::int = 1)
);

create table public.storage_deletion_queue (
  id uuid primary key default gen_random_uuid(),
  storage_bucket text not null,
  storage_object_path text not null,
  reason text not null,
  attempt_count integer not null default 0,
  last_error text,
  claimed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (storage_bucket, storage_object_path)
);

-- ---------------------------------------------------------------- helpers --

create or replace function public.arc_source_document_in_history(p_document_id uuid)
returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.revision_source_documents rsd
    join public.analysis_revisions r on r.id = rsd.revision_id
    where rsd.source_document_id = p_document_id
      and r.status in ('finalized', 'superseded')
  )
$$;

-- True when the owning auth identity is gone, so account-deletion cascades are
-- never blocked by the immutability guards below.
create or replace function public.arc_source_document_owner_present(p_contract_id uuid)
returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.contracts ct
    join public.customers c on c.id = ct.customer_id
    join auth.users u on u.id = c.owner_user_id
    where ct.id = p_contract_id
  )
$$;

create or replace function public.arc_protect_source_document()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_guest_status public.arc_guest_workspace_status;
begin
  if tg_op = 'DELETE' then
    if public.arc_source_document_in_history(old.id)
       and (old.contract_id is null or public.arc_source_document_owner_present(old.contract_id)) then
      raise exception 'source document % is part of finalized history and cannot be deleted', old.id
        using errcode = '42501';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if new.id <> old.id
       or new.storage_bucket is distinct from old.storage_bucket
       or new.storage_object_path is distinct from old.storage_object_path
       or new.original_filename is distinct from old.original_filename
       or new.sha256 is distinct from old.sha256
       or new.byte_size is distinct from old.byte_size
       or new.page_count is distinct from old.page_count
       or new.created_at is distinct from old.created_at then
      raise exception 'the technical facts of a source document are immutable'
        using errcode = '42501';
    end if;

    if new.contract_id is distinct from old.contract_id
       or new.guest_workspace_id is distinct from old.guest_workspace_id then
      -- Guest -> contract reassignment is allowed only while the owning guest
      -- workspace is being migrated into an account.
      if old.guest_workspace_id is null
         or new.guest_workspace_id is not null
         or new.contract_id is null then
        raise exception 'a source document cannot be moved to a different owner'
          using errcode = '42501';
      end if;
      select g.status into v_guest_status
        from public.guest_workspaces g where g.id = old.guest_workspace_id;
      if v_guest_status not in ('migrating', 'migrated') then
        raise exception 'guest documents may only be reassigned during migration'
          using errcode = '42501';
      end if;
    end if;

    if public.arc_source_document_in_history(old.id)
       and (new.display_name is distinct from old.display_name
            or new.document_type is distinct from old.document_type
            or new.effective_date is distinct from old.effective_date) then
      raise exception 'this document is referenced by finalized history, so its details are locked'
        using errcode = '42501';
    end if;

    new.updated_at := now();
  end if;

  return new;
end;
$$;

create trigger source_documents_protect
before insert or update or delete on public.source_documents
for each row execute function public.arc_protect_source_document();

create or replace function public.arc_protect_revision_source_document()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_revision uuid;
  v_status public.arc_revision_status;
  v_contract uuid;
  v_doc_contract uuid;
begin
  v_revision := case when tg_op = 'DELETE' then old.revision_id else new.revision_id end;

  select r.status, ct.id
    into v_status, v_contract
    from public.analysis_revisions r
    join public.analyses a on a.id = r.analysis_id
    join public.contracts ct on ct.id = a.contract_id
   where r.id = v_revision;

  if v_status is null then
    -- The revision itself is being removed (cascade); nothing to protect.
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if v_status <> 'draft' then
    if public.arc_source_document_owner_present(v_contract) then
      raise exception 'the source set of a % revision is immutable', v_status
        using errcode = '42501';
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'INSERT' then
    select d.contract_id into v_doc_contract
      from public.source_documents d where d.id = new.source_document_id;
    if v_doc_contract is null or v_doc_contract <> v_contract then
      raise exception 'a source document must belong to the same contract as the revision'
        using errcode = '23514';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger revision_source_documents_protect
before insert or delete on public.revision_source_documents
for each row execute function public.arc_protect_revision_source_document();

create or replace function public.arc_protect_guest_source_selection()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_owner uuid;
begin
  select d.guest_workspace_id into v_owner
    from public.source_documents d where d.id = new.source_document_id;
  if v_owner is distinct from new.guest_workspace_id then
    raise exception 'a guest selection must reference a document of the same guest workspace'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger guest_source_document_selections_protect
before insert on public.guest_source_document_selections
for each row execute function public.arc_protect_guest_source_selection();

create trigger document_upload_intents_set_updated_at
before update on public.document_upload_intents
for each row execute function public.arc_set_updated_at();

-- ----------------------------------------------------- privileges and RLS --

revoke all on public.source_documents from anon, authenticated;
revoke all on public.revision_source_documents from anon, authenticated;
revoke all on public.guest_source_document_selections from anon, authenticated;
revoke all on public.document_upload_intents from anon, authenticated;
revoke all on public.storage_deletion_queue from anon, authenticated;

grant select on public.source_documents to authenticated;
grant select on public.revision_source_documents to authenticated;
grant all on public.source_documents to service_role;
grant all on public.revision_source_documents to service_role;
grant all on public.guest_source_document_selections to service_role;
grant all on public.document_upload_intents to service_role;
grant all on public.storage_deletion_queue to service_role;

alter table public.source_documents enable row level security;
alter table public.revision_source_documents enable row level security;
alter table public.guest_source_document_selections enable row level security;
alter table public.document_upload_intents enable row level security;
alter table public.storage_deletion_queue enable row level security;

create policy source_documents_owner_select on public.source_documents
for select to authenticated
using (exists (
  select 1 from public.contracts ct
  join public.customers c on c.id = ct.customer_id
  where ct.id = source_documents.contract_id and c.owner_user_id = auth.uid()
));

create policy revision_source_documents_owner_select on public.revision_source_documents
for select to authenticated
using (exists (
  select 1
  from public.analysis_revisions r
  join public.analyses a on a.id = r.analysis_id
  join public.contracts ct on ct.id = a.contract_id
  join public.customers c on c.id = ct.customer_id
  where r.id = revision_source_documents.revision_id and c.owner_user_id = auth.uid()
));