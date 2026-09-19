-- ARC Post-R2 Database Hardening — non-retryable conflict SQLSTATE (part 2 of 4
-- of the reviewed staged migration 20260919060000_post_r2_conflict_sqlstate.sql).

CREATE OR REPLACE FUNCTION public.arc_commit_source_document_upload(p_intent_id uuid, p_owner_user_id uuid, p_guest_token_hash text, p_expected_lock_version integer)
 RETURNS TABLE(source_document_id uuid, duplicate boolean, associated boolean, association_conflict boolean, lock_version integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v record;
  v_doc uuid;
  v_duplicate boolean;
  v_associated boolean := false;
  v_conflict boolean := false;
  v_lock integer;
  v_guest record;
  v_selected uuid;
begin
  select * into v from public.document_upload_intents i where i.id = p_intent_id for update;
  if v.id is null then
    raise exception 'that upload was not found' using errcode = '42501';
  end if;

  -- Authorization is evaluated before any finalized readback, so an expired guest
  -- credential never regains access to a previously finalized intent.
  if v.contract_id is not null then
    if p_owner_user_id is null or not exists (
      select 1 from public.contracts ct
      join public.customers c on c.id = ct.customer_id
      where ct.id = v.contract_id and c.owner_user_id = p_owner_user_id
    ) then
      raise exception 'that upload belongs to another account' using errcode = '42501';
    end if;
  else
    if coalesce(trim(p_guest_token_hash), '') = '' or not exists (
      select 1 from public.guest_workspaces g
      where g.id = v.guest_workspace_id
        and g.token_hash = p_guest_token_hash
        and g.status = 'active'
        and g.expires_at > now()
    ) then
      raise exception 'that temporary workspace is no longer available' using errcode = '42501';
    end if;
  end if;

  -- Finalized readback: authoritative association state is reconstructed, never
  -- rewritten. No selection mutation happens here, so no AI source freeze applies.
  if v.state = 'finalized' then
    source_document_id := v.resolved_source_document_id;
    duplicate := coalesce(v.is_duplicate, false);

    if v.target_revision_id is not null then
      associated := exists (
        select 1 from public.revision_source_documents rsd
        where rsd.revision_id = v.target_revision_id
          and rsd.source_document_id = v.resolved_source_document_id);
      association_conflict := not associated;
      select r.lock_version into lock_version from public.analysis_revisions r
        where r.id = v.target_revision_id;
    elsif v.guest_workspace_id is not null then
      associated := exists (
        select 1 from public.guest_source_document_selections s
        where s.guest_workspace_id = v.guest_workspace_id
          and s.source_document_id = v.resolved_source_document_id);
      association_conflict := not associated;
      select g.lock_version into lock_version from public.guest_workspaces g
        where g.id = v.guest_workspace_id;
    else
      associated := false;
      association_conflict := false;
      lock_version := null;
    end if;

    return next;
    return;
  end if;

  if v.state <> 'prepared' then
    raise exception 'this upload has not been validated yet' using errcode = '22023';
  end if;
  if v.expires_at <= now() then
    raise exception 'that upload has expired' using errcode = '42501';
  end if;

  -- Phase 9F: an upload that would join an active run's frozen selection must not
  -- partially mutate that selection. Nothing at all is committed in that case.
  if v.target_revision_id is not null then
    perform public.arc_guard_ai_source_freeze(v.target_revision_id, null);
  elsif v.guest_workspace_id is not null then
    perform public.arc_guard_ai_source_freeze(null, v.guest_workspace_id);
  end if;

  v_duplicate := coalesce(v.is_duplicate, false);

  if v_duplicate then
    v_doc := v.resolved_source_document_id;
  else
    insert into public.source_documents (
      id, contract_id, guest_workspace_id, storage_object_path, original_filename,
      display_name, document_type, effective_date, sha256, byte_size, page_count)
    values (
      v.permanent_document_id, v.contract_id, v.guest_workspace_id, v.permanent_object_path,
      v.original_filename, v.display_name, v.document_type, v.effective_date,
      v.validated_sha256, v.validated_byte_size, v.validated_page_count)
    on conflict do nothing
    returning public.source_documents.id into v_doc;

    if v_doc is null then
      select d.id into v_doc from public.source_documents d
       where d.sha256 = v.validated_sha256
         and ((v.contract_id is not null and d.contract_id = v.contract_id)
           or (v.guest_workspace_id is not null and d.guest_workspace_id = v.guest_workspace_id));
      if v_doc is null then
        raise exception 'the uploaded document could not be recorded' using errcode = '23505';
      end if;
      insert into public.storage_deletion_queue (storage_bucket, storage_object_path, reason)
      values ('arc-source-documents', v.permanent_object_path, 'duplicate_race')
      on conflict do nothing;
      v_duplicate := true;
    end if;
  end if;

  if v.target_revision_id is not null then
    -- arc_attach_source_document owns the revision-side freeze check and the
    -- stale marking for a selection that actually changes.
    begin
      v_lock := public.arc_attach_source_document(
        p_owner_user_id, v.target_revision_id, v_doc, p_expected_lock_version);
      v_associated := true;
    exception when sqlstate 'PT409' then
      v_conflict := true;
      select r.lock_version into v_lock from public.analysis_revisions r
        where r.id = v.target_revision_id;
    end;
  elsif v.guest_workspace_id is not null then
    select * into v_guest from public.guest_workspaces g
      where g.id = v.guest_workspace_id for update;
    if v_guest.lock_version is distinct from p_expected_lock_version then
      v_conflict := true;
      v_lock := v_guest.lock_version;
    else
      insert into public.guest_source_document_selections as s (guest_workspace_id, source_document_id)
      values (v.guest_workspace_id, v_doc)
      on conflict do nothing
      returning s.source_document_id into v_selected;
      v_associated := true;
      if v_selected is null then
        -- The selection already contained this document: no stale marking and no
        -- second lock advance.
        v_lock := v_guest.lock_version;
      else
        perform public.arc_mark_ai_sources_stale(null, v.guest_workspace_id);
        update public.guest_workspaces g set lock_version = g.lock_version + 1
          where g.id = v.guest_workspace_id;
        v_lock := v_guest.lock_version + 1;
      end if;
    end if;
  end if;

  update public.document_upload_intents i
     set state = 'finalized', resolved_source_document_id = v_doc, is_duplicate = v_duplicate
   where i.id = p_intent_id;

  source_document_id := v_doc;
  duplicate := v_duplicate;
  associated := v_associated;
  association_conflict := v_conflict;
  lock_version := v_lock;
  return next;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.arc_discard_amendment_draft(p_owner_user_id uuid, p_revision_id uuid, p_expected_lock_version integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_analysis_id uuid;
  v_current uuid;
  v_status public.arc_revision_status;
  v_lock integer;
  v_source uuid;
begin
  if p_owner_user_id is null or p_revision_id is null or p_expected_lock_version is null then
    raise exception 'owner, revision and expected lock version are required' using errcode = '22023';
  end if;

  select a.id, a.current_finalized_revision_id
    into v_analysis_id, v_current
    from public.analyses a
    join public.contracts ct on ct.id = a.contract_id
    join public.customers c on c.id = ct.customer_id
    join public.analysis_revisions r on r.analysis_id = a.id
   where r.id = p_revision_id
     and c.owner_user_id = p_owner_user_id
   for update of a;

  if v_analysis_id is null then
    raise exception 'that revision was not found for this owner' using errcode = '42501';
  end if;

  select r.status, r.lock_version, r.supersedes_revision_id
    into v_status, v_lock, v_source
    from public.analysis_revisions r
   where r.id = p_revision_id
   for update;

  if v_status <> 'draft' then
    raise exception 'only an unfinished draft revision can be discarded' using errcode = '42501';
  end if;
  if v_source is null then
    raise exception 'this draft does not continue a finalized revision' using errcode = '22023';
  end if;
  if v_current is distinct from v_source then
    raise exception 'the analysis has moved on since it was loaded' using errcode = 'PT409';
  end if;
  perform public.arc_guard_ai_source_freeze(p_revision_id, null);
  if v_lock <> p_expected_lock_version then
    raise exception 'the draft changed since it was loaded' using errcode = 'PT409';
  end if;

  delete from public.analysis_revisions r
   where r.id = p_revision_id
     and r.status = 'draft'
     and r.lock_version = p_expected_lock_version;

  if not found then
    raise exception 'the draft changed since it was loaded' using errcode = 'PT409';
  end if;

  return v_current;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.arc_finalize_revision(p_owner_user_id uuid, p_revision_id uuid, p_expected_lock_version integer, p_engine_outputs jsonb, p_reconciliation_snapshot jsonb, p_schema_version text, p_engine_version text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
      p_revision_id, p_expected_lock_version, v_lock using errcode = 'PT409';
  end if;

  -- Freeze the selected source set: every selected document row is locked, in
  -- document-id order, before the revision leaves 'draft'. A concurrent
  -- metadata edit or delete cannot cross the historical boundary.
  perform 1
  from public.source_documents d
  where d.id in (
    select rsd.source_document_id
    from public.revision_source_documents rsd
    where rsd.revision_id = p_revision_id
  )
  order by d.id
  for update;

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
$function$
;

CREATE OR REPLACE FUNCTION public.arc_migrate_guest_workspace_by_token(p_token_hash text, p_owner_user_id uuid, p_expected_lock_version integer, p_customer_name text, p_contract_title text, p_contract_number text)
 RETURNS TABLE(customer_id uuid, contract_id uuid, analysis_id uuid, revision_id uuid, idempotent boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
  if coalesce(trim(p_customer_name), '') = '' then
    raise exception 'a customer name is required' using errcode = '22023';
  end if;
  if coalesce(trim(p_contract_title), '') = '' then
    raise exception 'a contract title is required' using errcode = '22023';
  end if;

  -- The credential hash is the only way in: the browser never supplies the
  -- guest workspace id. The row lock makes the checks below and the whole
  -- migration a single serialized decision.
  select * into v_row
    from public.guest_workspaces g
   where g.token_hash = p_token_hash
   for update;

  if v_row.id is null then
    raise exception 'that guest workspace is no longer available' using errcode = '42501';
  end if;

  -- Response-loss retry: the work already exists, so return exactly what the
  -- committed transaction created rather than creating it a second time.
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
    raise exception 'the temporary workspace changed since it was confirmed' using errcode = 'PT409';
  end if;

  select * into v_res
  from public.arc_migrate_guest_workspace(
    v_row.id, p_owner_user_id, trim(p_customer_name), trim(p_contract_title), p_contract_number);

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
$function$
;

CREATE OR REPLACE FUNCTION public.arc_migrate_guest_workspace_by_token_v2(p_token_hash text, p_owner_user_id uuid, p_expected_lock_version integer, p_existing_customer_id uuid, p_new_customer_name text, p_contract_title text, p_contract_number text)
 RETURNS TABLE(customer_id uuid, contract_id uuid, analysis_id uuid, revision_id uuid, idempotent boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
    raise exception 'the temporary workspace changed since it was confirmed' using errcode = 'PT409';
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
$function$
;