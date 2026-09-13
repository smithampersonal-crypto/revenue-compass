-- ARC Phase 8E — guest source-document selection and document-aware migration.

-- 1. Add a guest-owned document to the temporary analysis.
create or replace function public.arc_attach_guest_source_document(
  p_guest_token_hash text,
  p_source_document_id uuid,
  p_expected_lock_version integer
) returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_guest record;
  v_inserted uuid;
begin
  if coalesce(trim(p_guest_token_hash), '') = '' then
    raise exception 'that temporary workspace is no longer available' using errcode = '42501';
  end if;

  select * into v_guest from public.guest_workspaces g
   where g.token_hash = p_guest_token_hash
   for update;

  if v_guest.id is null or v_guest.status <> 'active' or v_guest.expires_at <= now() then
    raise exception 'that temporary workspace is no longer available' using errcode = '42501';
  end if;

  -- Stale-lock rejection happens before the mutation is evaluated, even when
  -- the requested end state already exists.
  if v_guest.lock_version is distinct from p_expected_lock_version then
    raise exception 'the temporary workspace changed since it was loaded' using errcode = '40001';
  end if;

  if not exists (
    select 1 from public.source_documents d
     where d.id = p_source_document_id
       and d.guest_workspace_id = v_guest.id
  ) then
    raise exception 'that document was not found' using errcode = '42501';
  end if;

  insert into public.guest_source_document_selections (guest_workspace_id, source_document_id)
  values (v_guest.id, p_source_document_id)
  on conflict do nothing
  returning source_document_id into v_inserted;

  if v_inserted is null then
    return v_guest.lock_version;
  end if;

  update public.guest_workspaces set lock_version = lock_version + 1 where id = v_guest.id;
  return v_guest.lock_version + 1;
end;
$$;

revoke all on function public.arc_attach_guest_source_document(text, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.arc_attach_guest_source_document(text, uuid, integer)
  to service_role;

-- 2. Remove a guest-owned document from the temporary analysis.
create or replace function public.arc_remove_guest_source_document(
  p_guest_token_hash text,
  p_source_document_id uuid,
  p_expected_lock_version integer
) returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_guest record;
  v_removed integer;
begin
  if coalesce(trim(p_guest_token_hash), '') = '' then
    raise exception 'that temporary workspace is no longer available' using errcode = '42501';
  end if;

  select * into v_guest from public.guest_workspaces g
   where g.token_hash = p_guest_token_hash
   for update;

  if v_guest.id is null or v_guest.status <> 'active' or v_guest.expires_at <= now() then
    raise exception 'that temporary workspace is no longer available' using errcode = '42501';
  end if;

  if v_guest.lock_version is distinct from p_expected_lock_version then
    raise exception 'the temporary workspace changed since it was loaded' using errcode = '40001';
  end if;

  if not exists (
    select 1 from public.source_documents d
     where d.id = p_source_document_id
       and d.guest_workspace_id = v_guest.id
  ) then
    raise exception 'that document was not found' using errcode = '42501';
  end if;

  delete from public.guest_source_document_selections s
   where s.guest_workspace_id = v_guest.id
     and s.source_document_id = p_source_document_id;
  get diagnostics v_removed = row_count;

  if v_removed = 0 then
    return v_guest.lock_version;
  end if;

  update public.guest_workspaces set lock_version = lock_version + 1 where id = v_guest.id;
  return v_guest.lock_version + 1;
end;
$$;

revoke all on function public.arc_remove_guest_source_document(text, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.arc_remove_guest_source_document(text, uuid, integer)
  to service_role;

-- 3. Migration carries the uploaded PDFs across in the same transaction.
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
  v_selected uuid[];
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

  -- The documents the visitor had included, captured before ownership moves.
  select coalesce(array_agg(s.source_document_id), '{}')
    into v_selected
    from public.guest_source_document_selections s
   where s.guest_workspace_id = p_guest_workspace_id;

  -- Every uploaded PDF moves to the new contract: the same rows, the same
  -- stored files. Nothing is copied and nothing is left behind.
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

revoke all on function public.arc_migrate_guest_workspace(uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.arc_migrate_guest_workspace(uuid, uuid, text, text, text)
  to service_role;