-- ARC Phase 8E acceptance — saving under an existing customer, and deleting a
-- never-finalized initial draft contract with its private documents queued.

-- 1. Migration that can attach to an existing customer owned by the caller.
create or replace function public.arc_migrate_guest_workspace_v2(
  p_guest_workspace_id uuid,
  p_owner_user_id uuid,
  p_existing_customer_id uuid,
  p_new_customer_name text,
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
  v_selected uuid[];
  v_new_name text := nullif(trim(coalesce(p_new_customer_name, '')), '');
begin
  -- Exactly one customer mode. Never both, never neither.
  if (p_existing_customer_id is not null)::int + (v_new_name is not null)::int <> 1 then
    raise exception 'exactly one of an existing customer or a new customer name is required'
      using errcode = '22023';
  end if;

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

  if p_existing_customer_id is not null then
    -- Ownership is decided here, never by the browser's hint.
    select cu.id into v_customer_id
      from public.customers cu
     where cu.id = p_existing_customer_id
       and cu.owner_user_id = p_owner_user_id
     for update;
    if v_customer_id is null then
      raise exception 'that customer is not in your workspace' using errcode = '42501';
    end if;
  else
    insert into public.customers (owner_user_id, name)
    values (p_owner_user_id, v_new_name)
    returning id into v_customer_id;
  end if;

  insert into public.contracts (customer_id, title, contract_number)
  values (v_customer_id, p_contract_title, nullif(trim(coalesce(p_contract_number, '')), ''))
  returning id into v_contract_id;

  insert into public.analyses (contract_id)
  values (v_contract_id)
  returning id into v_analysis_id;

  insert into public.analysis_revisions (analysis_id, revision_number, status, canonical_inputs, schema_version)
  values (v_analysis_id, 1, 'draft', v_draft, v_schema_version)
  returning id into v_revision_id;

  select coalesce(array_agg(s.source_document_id), '{}')
    into v_selected
    from public.guest_source_document_selections s
   where s.guest_workspace_id = p_guest_workspace_id;

  update public.source_documents d
     set contract_id = v_contract_id,
         guest_workspace_id = null
   where d.guest_workspace_id = p_guest_workspace_id;

  if array_length(v_selected, 1) is not null then
    insert into public.revision_source_documents (revision_id, source_document_id)
    select v_revision_id, unnest(v_selected)
    on conflict do nothing;
  end if;

  delete from public.guest_source_document_selections s
   where s.guest_workspace_id = p_guest_workspace_id;

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

revoke all on function public.arc_migrate_guest_workspace_v2(uuid, uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.arc_migrate_guest_workspace_v2(uuid, uuid, uuid, text, text, text)
  to service_role;

-- 2. Credential-addressed wrapper, with the same idempotent retry semantics.
create or replace function public.arc_migrate_guest_workspace_by_token_v2(
  p_token_hash text,
  p_owner_user_id uuid,
  p_expected_lock_version integer,
  p_existing_customer_id uuid,
  p_new_customer_name text,
  p_contract_title text,
  p_contract_number text
)
returns table(customer_id uuid, contract_id uuid, analysis_id uuid, revision_id uuid, idempotent boolean)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.guest_workspaces%rowtype;
  v_res record;
begin
  if coalesce(trim(p_token_hash), '') = '' or p_owner_user_id is null then
    raise exception 'a guest credential and an owner are required' using errcode = '22023';
  end if;
  if p_expected_lock_version is null or p_expected_lock_version < 1 then
    raise exception 'an expected lock version is required' using errcode = '22023';
  end if;
  if coalesce(trim(p_contract_title), '') = '' then
    raise exception 'a contract title is required' using errcode = '22023';
  end if;

  select * into v_row
    from public.guest_workspaces g
   where g.token_hash = p_token_hash
   for update;

  if v_row.id is null then
    raise exception 'that guest workspace is no longer available' using errcode = '42501';
  end if;

  -- Response-loss retry returns exactly what the committed transaction made.
  if v_row.status = 'migrated' then
    if v_row.migrated_user_id is distinct from p_owner_user_id then
      raise exception 'that guest workspace belongs to another account' using errcode = '42501';
    end if;
    if v_row.migrated_revision_id is null then
      raise exception 'that guest workspace has no recoverable migration result' using errcode = '42501';
    end if;
    customer_id := v_row.migrated_customer_id;
    contract_id := v_row.migrated_contract_id;
    analysis_id := v_row.migrated_analysis_id;
    revision_id := v_row.migrated_revision_id;
    idempotent := true;
    return next;
    return;
  end if;

  if v_row.status <> 'active' or v_row.expires_at <= now() then
    raise exception 'that guest workspace is no longer available' using errcode = '42501';
  end if;

  if v_row.lock_version <> p_expected_lock_version then
    raise exception 'the temporary workspace changed since it was confirmed' using errcode = '40001';
  end if;

  select * into v_res
  from public.arc_migrate_guest_workspace_v2(
    v_row.id, p_owner_user_id, p_existing_customer_id, p_new_customer_name,
    trim(p_contract_title), p_contract_number);

  update public.guest_workspaces
     set migrated_customer_id = v_res.customer_id,
         migrated_contract_id = v_res.contract_id,
         migrated_analysis_id = v_res.analysis_id,
         migrated_revision_id = v_res.revision_id
   where id = v_row.id;

  customer_id := v_res.customer_id;
  contract_id := v_res.contract_id;
  analysis_id := v_res.analysis_id;
  revision_id := v_res.revision_id;
  idempotent := false;
  return next;
end;
$$;

revoke all on function public.arc_migrate_guest_workspace_by_token_v2(text, uuid, integer, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.arc_migrate_guest_workspace_by_token_v2(text, uuid, integer, uuid, text, text, text)
  to service_role;

-- 3. Deleting a saved analysis that has never been finalized.
create or replace function public.arc_delete_initial_draft_contract(
  p_owner_user_id uuid,
  p_contract_id uuid
)
returns table (deleted_contract_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_contract_id uuid;
  v_analysis_id uuid;
  v_current_finalized uuid;
  v_draft_id uuid;
  v_draft_number integer;
  v_doc record;
begin
  if p_owner_user_id is null or p_contract_id is null then
    raise exception 'an owner and a contract are required' using errcode = '22023';
  end if;

  -- Lock direction (Phase 8D): contract -> analysis -> draft revision ->
  -- source documents in deterministic id order.
  select c.id into v_contract_id
    from public.contracts c
    join public.customers cu on cu.id = c.customer_id
   where c.id = p_contract_id
     and cu.owner_user_id = p_owner_user_id
   for update of c;

  if v_contract_id is null then
    raise exception 'that contract is not in your workspace' using errcode = '42501';
  end if;

  select a.id, a.current_finalized_revision_id
    into v_analysis_id, v_current_finalized
    from public.analyses a
   where a.contract_id = v_contract_id
   for update;

  if v_analysis_id is null then
    raise exception 'that analysis is no longer available' using errcode = '42501';
  end if;
  if v_current_finalized is not null then
    raise exception 'that analysis has finalized history and cannot be deleted this way'
      using errcode = '42501';
  end if;

  select r.id, r.revision_number
    into v_draft_id, v_draft_number
    from public.analysis_revisions r
   where r.analysis_id = v_analysis_id
     and r.status = 'draft'
   for update;

  if v_draft_id is null or v_draft_number <> 1 then
    raise exception 'only an unfinalized first draft can be deleted this way'
      using errcode = '42501';
  end if;

  -- Revalidated after the locks: a concurrent finalize must win.
  if exists (
    select 1 from public.analysis_revisions r
     where r.analysis_id = v_analysis_id
       and r.status in ('finalized', 'superseded')
  ) then
    raise exception 'that analysis has finalized history and cannot be deleted this way'
      using errcode = '42501';
  end if;

  -- Every private object is queued before relational ownership disappears.
  for v_doc in
    select d.id, d.storage_bucket, d.storage_object_path
      from public.source_documents d
     where d.contract_id = v_contract_id
     order by d.id
     for update
  loop
    insert into public.storage_deletion_queue (storage_bucket, storage_object_path, reason)
    values (v_doc.storage_bucket, v_doc.storage_object_path, 'initial_draft_contract_deleted')
    on conflict (storage_bucket, storage_object_path) do nothing;
  end loop;

  -- Unfinished uploads for this contract leave no orphaned objects either.
  insert into public.storage_deletion_queue (storage_bucket, storage_object_path, reason)
  select 'arc-source-documents', i.pending_object_path, 'initial_draft_contract_deleted'
    from public.document_upload_intents i
   where i.contract_id = v_contract_id
     and i.pending_object_path is not null
  on conflict (storage_bucket, storage_object_path) do nothing;

  insert into public.storage_deletion_queue (storage_bucket, storage_object_path, reason)
  select 'arc-source-documents', i.permanent_object_path, 'initial_draft_contract_deleted'
    from public.document_upload_intents i
   where i.contract_id = v_contract_id
     and i.permanent_object_path is not null
  on conflict (storage_bucket, storage_object_path) do nothing;

  delete from public.contracts c where c.id = v_contract_id;

  deleted_contract_id := v_contract_id;
  return next;
end;
$$;

revoke all on function public.arc_delete_initial_draft_contract(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.arc_delete_initial_draft_contract(uuid, uuid)
  to service_role;