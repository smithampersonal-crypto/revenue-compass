-- =========================================================
-- ARC Phase 7A acceptance patch (additive)
-- Least-privilege lifecycle control for analyses / analysis_revisions
-- =========================================================

-- ---------------------------------------------------------
-- 1. Least-privilege column grants
-- ---------------------------------------------------------

-- contracts: metadata editable, ownership parent frozen
revoke update on public.contracts from authenticated;
grant update (contract_number, title, status) on public.contracts to authenticated;

-- analyses: read + create only; no direct updates at all
revoke update on public.analyses from authenticated;
revoke insert on public.analyses from authenticated;
grant insert (contract_id) on public.analyses to authenticated;

-- analysis_revisions: read, create draft, edit draft payload only
revoke update on public.analysis_revisions from authenticated;
revoke insert on public.analysis_revisions from authenticated;
grant insert (analysis_id, revision_number, canonical_inputs, schema_version)
  on public.analysis_revisions to authenticated;
grant update (canonical_inputs, lock_version)
  on public.analysis_revisions to authenticated;

-- ---------------------------------------------------------
-- 2. Lifecycle-state consistency constraints
-- ---------------------------------------------------------
alter table public.analysis_revisions
  add constraint analysis_revisions_schema_version_nonblank
    check (length(trim(schema_version)) > 0),
  add constraint analysis_revisions_no_self_supersede
    check (supersedes_revision_id is distinct from id),
  add constraint analysis_revisions_lifecycle_shape check (
    (status = 'draft'
      and engine_outputs is null
      and reconciliation_snapshot is null
      and engine_version is null
      and finalized_at is null)
    or (status in ('finalized', 'superseded')
      and engine_outputs is not null
      and reconciliation_snapshot is not null
      and engine_version is not null
      and length(trim(engine_version)) > 0
      and finalized_at is not null)
  );

-- ---------------------------------------------------------
-- 3. Revision trigger: validate INSERT, tighten UPDATE
-- ---------------------------------------------------------
create or replace function public.arc_protect_revision_immutability()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_parent_analysis uuid;
begin
  -- ---------------- INSERT ----------------
  if tg_op = 'INSERT' then
    if new.status <> 'draft'
       or new.engine_outputs is not null
       or new.reconciliation_snapshot is not null
       or new.engine_version is not null
       or new.finalized_at is not null
       or new.lock_version <> 1 then
      raise exception
        'a new analysis revision must be created as an empty draft (lock version 1)'
        using errcode = '42501';
    end if;

    if new.supersedes_revision_id is not null then
      select analysis_id into v_parent_analysis
        from public.analysis_revisions where id = new.supersedes_revision_id;
      if v_parent_analysis is distinct from new.analysis_id then
        raise exception 'supersedes_revision_id must belong to the same analysis'
          using errcode = '23514';
      end if;
    end if;

    return new;
  end if;

  -- ---------------- UPDATE ----------------
  if tg_op = 'UPDATE' then
    -- identity / lineage columns are frozen for every transition
    if new.id <> old.id
       or new.analysis_id <> old.analysis_id
       or new.revision_number <> old.revision_number
       or new.created_at <> old.created_at then
      raise exception 'analysis revision identity columns are immutable'
        using errcode = '42501';
    end if;

    -- draft -> draft: editable payload + concurrency metadata only
    if old.status = 'draft' and new.status = 'draft' then
      if new.engine_outputs is not null
         or new.reconciliation_snapshot is not null
         or new.engine_version is not null
         or new.finalized_at is not null then
        raise exception 'draft revisions cannot carry finalized outputs'
          using errcode = '42501';
      end if;
      if new.supersedes_revision_id is not distinct from old.supersedes_revision_id then
        new.updated_at := now();
        return new;
      end if;
      raise exception 'supersedes_revision_id cannot be changed on a draft'
        using errcode = '42501';
    end if;

    -- draft -> finalized: only via a complete, trusted snapshot
    if old.status = 'draft' and new.status = 'finalized' then
      if new.engine_outputs is null
         or new.reconciliation_snapshot is null
         or coalesce(trim(new.engine_version), '') = ''
         or coalesce(trim(new.schema_version), '') = ''
         or new.finalized_at is null then
        raise exception
          'finalization requires engine outputs, reconciliation snapshot, versions, and a finalization timestamp'
          using errcode = '22023';
      end if;
      if new.canonical_inputs is distinct from old.canonical_inputs then
        raise exception 'canonical inputs cannot change during finalization'
          using errcode = '42501';
      end if;
      if new.lock_version <> old.lock_version + 1 then
        raise exception 'finalization must advance the lock version exactly once'
          using errcode = '40001';
      end if;
      if new.supersedes_revision_id is not null then
        if new.supersedes_revision_id = new.id then
          raise exception 'a revision cannot supersede itself' using errcode = '23514';
        end if;
        select analysis_id into v_parent_analysis
          from public.analysis_revisions where id = new.supersedes_revision_id;
        if v_parent_analysis is distinct from new.analysis_id then
          raise exception 'supersedes_revision_id must belong to the same analysis'
            using errcode = '23514';
        end if;
      end if;
      new.updated_at := now();
      return new;
    end if;

    -- finalized -> superseded: status only, snapshot byte-identical
    if old.status = 'finalized' and new.status = 'superseded'
       and new.canonical_inputs is not distinct from old.canonical_inputs
       and new.engine_outputs is not distinct from old.engine_outputs
       and new.reconciliation_snapshot is not distinct from old.reconciliation_snapshot
       and new.schema_version is not distinct from old.schema_version
       and new.engine_version is not distinct from old.engine_version
       and new.supersedes_revision_id is not distinct from old.supersedes_revision_id
       and new.finalized_at is not distinct from old.finalized_at
       and new.lock_version = old.lock_version
    then
      new.updated_at := now();
      return new;
    end if;

    raise exception
      'analysis revision % cannot transition from % to % in this way',
      old.id, old.status, new.status
      using errcode = '42501';
  end if;

  -- ---------------- DELETE ----------------
  if old.status in ('finalized', 'superseded') then
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

drop trigger if exists analysis_revisions_immutability on public.analysis_revisions;
create trigger analysis_revisions_immutability
  before insert or update or delete on public.analysis_revisions
  for each row execute function public.arc_protect_revision_immutability();

-- ---------------------------------------------------------
-- 4. Stable ownership hierarchy + pointer lineage
-- ---------------------------------------------------------
create or replace function public.arc_protect_contract_parent()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.customer_id <> old.customer_id or new.id <> old.id then
    raise exception 'a contract cannot be moved to a different customer'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger contracts_protect_parent
  before update on public.contracts
  for each row execute function public.arc_protect_contract_parent();

create or replace function public.arc_protect_analysis_integrity()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_analysis uuid;
  v_status public.arc_revision_status;
begin
  if tg_op = 'UPDATE' then
    if new.contract_id <> old.contract_id or new.id <> old.id then
      raise exception 'an analysis cannot be moved to a different contract'
        using errcode = '42501';
    end if;
  end if;

  if new.current_finalized_revision_id is not null then
    select analysis_id, status into v_analysis, v_status
      from public.analysis_revisions
     where id = new.current_finalized_revision_id;

    if v_analysis is distinct from new.id then
      raise exception 'current_finalized_revision_id must reference a revision of this analysis'
        using errcode = '23514';
    end if;
    if v_status <> 'finalized' then
      raise exception 'current_finalized_revision_id must reference a finalized revision'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger analyses_protect_integrity
  before insert or update on public.analyses
  for each row execute function public.arc_protect_analysis_integrity();

-- ---------------------------------------------------------
-- 5. Trusted finalization: lock the analyses row too
-- ---------------------------------------------------------
create or replace function public.arc_finalize_revision(
  p_owner_user_id uuid,
  p_revision_id uuid,
  p_expected_lock_version integer,
  p_engine_outputs jsonb,
  p_reconciliation_snapshot jsonb,
  p_schema_version text,
  p_engine_version text
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_analysis_id uuid;
  v_owner uuid;
  v_status public.arc_revision_status;
  v_lock integer;
  v_current uuid;
begin
  if p_engine_outputs is null or p_reconciliation_snapshot is null
     or coalesce(trim(p_schema_version), '') = ''
     or coalesce(trim(p_engine_version), '') = '' then
    raise exception 'finalization requires engine outputs, reconciliation snapshot, and version metadata'
      using errcode = '22023';
  end if;

  select r.analysis_id into v_analysis_id
  from public.analysis_revisions r
  where r.id = p_revision_id;

  if v_analysis_id is null then
    raise exception 'revision % not found', p_revision_id using errcode = 'P0002';
  end if;

  -- lock the analysis row first so the current-finalized pointer participates
  -- in this transaction's concurrency boundary
  select a.current_finalized_revision_id into v_current
  from public.analyses a
  where a.id = v_analysis_id
  for update;

  select r.status, r.lock_version, cu.owner_user_id
    into v_status, v_lock, v_owner
  from public.analysis_revisions r
  join public.analyses a on a.id = r.analysis_id
  join public.contracts ct on ct.id = a.contract_id
  join public.customers cu on cu.id = ct.customer_id
  where r.id = p_revision_id
  for update of r;

  if v_owner is distinct from p_owner_user_id then
    raise exception 'revision % is not owned by the caller', p_revision_id using errcode = '42501';
  end if;

  if v_status <> 'draft' then
    raise exception 'revision % is % and cannot be finalized', p_revision_id, v_status
      using errcode = '22023';
  end if;

  if v_lock is distinct from p_expected_lock_version then
    raise exception 'revision % has changed since it was loaded (expected lock version %, found %)',
      p_revision_id, p_expected_lock_version, v_lock using errcode = '40001';
  end if;

  update public.analysis_revisions
     set status = 'finalized',
         engine_outputs = p_engine_outputs,
         reconciliation_snapshot = p_reconciliation_snapshot,
         schema_version = p_schema_version,
         engine_version = p_engine_version,
         supersedes_revision_id = case
           when v_current is not null and v_current <> p_revision_id then v_current
           else supersedes_revision_id end,
         finalized_at = now(),
         lock_version = lock_version + 1
   where id = p_revision_id;

  if v_current is not null and v_current <> p_revision_id then
    update public.analysis_revisions
       set status = 'superseded'
     where id = v_current and status = 'finalized';
  end if;

  update public.analyses
     set current_finalized_revision_id = p_revision_id
   where id = v_analysis_id;

  return p_revision_id;
end;
$$;

revoke all on function public.arc_finalize_revision(uuid, uuid, integer, jsonb, jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.arc_finalize_revision(uuid, uuid, integer, jsonb, jsonb, text, text)
  to service_role;

revoke all on function public.arc_migrate_guest_workspace(uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.arc_migrate_guest_workspace(uuid, uuid, text, text, text)
  to service_role;