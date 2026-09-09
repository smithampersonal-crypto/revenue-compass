-- =========================================================
-- ARC Phase 7A trusted transactions (service-role only)
-- =========================================================

create or replace function public.arc_finalize_revision(
  p_owner_user_id uuid,
  p_revision_id uuid,
  p_expected_lock_version integer,
  p_engine_outputs jsonb,
  p_reconciliation_snapshot jsonb,
  p_schema_version text,
  p_engine_version text
)
returns uuid
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

  select r.analysis_id, r.status, r.lock_version, cu.owner_user_id, a.current_finalized_revision_id
    into v_analysis_id, v_status, v_lock, v_owner, v_current
  from public.analysis_revisions r
  join public.analyses a on a.id = r.analysis_id
  join public.contracts ct on ct.id = a.contract_id
  join public.customers cu on cu.id = ct.customer_id
  where r.id = p_revision_id
  for update of r;

  if v_analysis_id is null then
    raise exception 'revision % not found', p_revision_id using errcode = 'P0002';
  end if;

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

  if v_current is not null and v_current <> p_revision_id then
    update public.analysis_revisions
       set status = 'superseded'
     where id = v_current and status = 'finalized';
  end if;

  update public.analysis_revisions
     set status = 'finalized',
         engine_outputs = p_engine_outputs,
         reconciliation_snapshot = p_reconciliation_snapshot,
         schema_version = p_schema_version,
         engine_version = p_engine_version,
         supersedes_revision_id = case when v_current <> p_revision_id then v_current else supersedes_revision_id end,
         finalized_at = now(),
         lock_version = lock_version + 1,
         updated_at = now()
   where id = p_revision_id;

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

create or replace function public.arc_migrate_guest_workspace(
  p_guest_workspace_id uuid,
  p_owner_user_id uuid,
  p_customer_name text,
  p_contract_title text,
  p_contract_number text
)
returns table (
  customer_id uuid,
  contract_id uuid,
  analysis_id uuid,
  revision_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_draft jsonb;
  v_schema_version text;
  v_customer_id uuid;
  v_contract_id uuid;
  v_analysis_id uuid;
  v_revision_id uuid;
begin
  select g.draft_json, g.schema_version
    into v_draft, v_schema_version
  from public.guest_workspaces g
  where g.id = p_guest_workspace_id
    and g.status = 'active'
    and g.expires_at > now()
  for update;

  if v_draft is null then
    raise exception 'guest workspace % is not available for migration', p_guest_workspace_id
      using errcode = '42501';
  end if;

  if not exists (select 1 from auth.users u where u.id = p_owner_user_id) then
    raise exception 'owner % does not exist', p_owner_user_id using errcode = '42501';
  end if;

  update public.guest_workspaces
     set status = 'migrating'
   where id = p_guest_workspace_id;

  insert into public.customers (owner_user_id, name)
  values (p_owner_user_id, p_customer_name)
  returning id into v_customer_id;

  insert into public.contracts (customer_id, title, contract_number)
  values (v_customer_id, p_contract_title, nullif(trim(coalesce(p_contract_number, '')), ''))
  returning id into v_contract_id;

  insert into public.analyses (contract_id)
  values (v_contract_id)
  returning id into v_analysis_id;

  insert into public.analysis_revisions (analysis_id, revision_number, status, canonical_inputs, schema_version)
  values (v_analysis_id, 1, 'draft', v_draft, v_schema_version)
  returning id into v_revision_id;

  update public.guest_workspaces
     set status = 'migrated',
         migrated_user_id = p_owner_user_id
   where id = p_guest_workspace_id;

  customer_id := v_customer_id;
  contract_id := v_contract_id;
  analysis_id := v_analysis_id;
  revision_id := v_revision_id;
  return next;
end;
$$;

revoke all on function public.arc_migrate_guest_workspace(uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.arc_migrate_guest_workspace(uuid, uuid, text, text, text)
  to service_role;