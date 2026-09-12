-- ARC Phase 8A — trusted document lifecycle RPCs (service-role only).

-- ------------------------------------------------------------- prepare ----

create or replace function public.arc_prepare_source_document_upload(
  p_intent_id uuid,
  p_owner_user_id uuid,
  p_guest_token_hash text,
  p_sha256 text,
  p_byte_size bigint,
  p_page_count integer
) returns table(
  source_document_id uuid,
  permanent_object_path text,
  duplicate boolean,
  requires_promotion boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v record;
  v_existing uuid;
  v_new_id uuid;
  v_path text;
begin
  if p_sha256 !~ '^[0-9a-f]{64}$' or coalesce(p_byte_size, 0) <= 0
     or coalesce(p_page_count, 0) <= 0 then
    raise exception 'validated upload facts are required' using errcode = '22023';
  end if;

  select * into v from public.document_upload_intents i where i.id = p_intent_id for update;
  if v.id is null then
    raise exception 'that upload was not found' using errcode = '42501';
  end if;

  -- Ownership is derived here; a browser-supplied identity is never authority.
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

  if v.state = 'finalized' then
    source_document_id := v.resolved_source_document_id;
    permanent_object_path := v.permanent_object_path;
    duplicate := coalesce(v.is_duplicate, false);
    requires_promotion := false;
    return next;
    return;
  end if;

  if v.expires_at <= now() then
    raise exception 'that upload has expired' using errcode = '42501';
  end if;

  if v.state = 'prepared' then
    -- Response-loss retry returns exactly the earlier reservation.
    source_document_id := coalesce(v.resolved_source_document_id, v.permanent_document_id);
    permanent_object_path := v.permanent_object_path;
    duplicate := coalesce(v.is_duplicate, false);
    requires_promotion := not coalesce(v.is_duplicate, false);
    return next;
    return;
  end if;

  select d.id into v_existing
    from public.source_documents d
   where d.sha256 = p_sha256
     and ((v.contract_id is not null and d.contract_id = v.contract_id)
       or (v.guest_workspace_id is not null and d.guest_workspace_id = v.guest_workspace_id));

  if v_existing is not null then
    update public.document_upload_intents
       set state = 'prepared', is_duplicate = true, resolved_source_document_id = v_existing,
           validated_sha256 = p_sha256, validated_byte_size = p_byte_size,
           validated_page_count = p_page_count
     where id = p_intent_id;
    source_document_id := v_existing;
    permanent_object_path := null;
    duplicate := true;
    requires_promotion := false;
    return next;
    return;
  end if;

  v_new_id := gen_random_uuid();
  v_path := 'documents/' || v_new_id::text || '.pdf';
  update public.document_upload_intents
     set state = 'prepared', is_duplicate = false,
         permanent_document_id = v_new_id, permanent_object_path = v_path,
         validated_sha256 = p_sha256, validated_byte_size = p_byte_size,
         validated_page_count = p_page_count
   where id = p_intent_id;

  source_document_id := v_new_id;
  permanent_object_path := v_path;
  duplicate := false;
  requires_promotion := true;
  return next;
end;
$$;

-- -------------------------------------------------------------- attach ----

create or replace function public.arc_attach_source_document(
  p_owner_user_id uuid,
  p_revision_id uuid,
  p_source_document_id uuid,
  p_expected_lock_version integer
) returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_status public.arc_revision_status;
  v_lock integer;
begin
  select r.status, r.lock_version into v_status, v_lock
    from public.analysis_revisions r
    join public.analyses a on a.id = r.analysis_id
    join public.contracts ct on ct.id = a.contract_id
    join public.customers c on c.id = ct.customer_id
   where r.id = p_revision_id and c.owner_user_id = p_owner_user_id
   for update of r;

  if v_status is null then
    raise exception 'that revision was not found for this owner' using errcode = '42501';
  end if;
  if v_status <> 'draft' then
    raise exception 'only an unfinished draft revision can change its source documents'
      using errcode = '42501';
  end if;
  if v_lock is distinct from p_expected_lock_version then
    raise exception 'the draft changed since it was loaded' using errcode = '40001';
  end if;

  insert into public.revision_source_documents (revision_id, source_document_id)
  values (p_revision_id, p_source_document_id)
  on conflict do nothing;

  update public.analysis_revisions set lock_version = lock_version + 1 where id = p_revision_id;
  return v_lock + 1;
end;
$$;

create or replace function public.arc_remove_source_document(
  p_owner_user_id uuid,
  p_revision_id uuid,
  p_source_document_id uuid,
  p_expected_lock_version integer
) returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_status public.arc_revision_status;
  v_lock integer;
begin
  select r.status, r.lock_version into v_status, v_lock
    from public.analysis_revisions r
    join public.analyses a on a.id = r.analysis_id
    join public.contracts ct on ct.id = a.contract_id
    join public.customers c on c.id = ct.customer_id
   where r.id = p_revision_id and c.owner_user_id = p_owner_user_id
   for update of r;

  if v_status is null then
    raise exception 'that revision was not found for this owner' using errcode = '42501';
  end if;
  if v_status <> 'draft' then
    raise exception 'only an unfinished draft revision can change its source documents'
      using errcode = '42501';
  end if;
  if v_lock is distinct from p_expected_lock_version then
    raise exception 'the draft changed since it was loaded' using errcode = '40001';
  end if;

  delete from public.revision_source_documents
   where revision_id = p_revision_id and source_document_id = p_source_document_id;

  update public.analysis_revisions set lock_version = lock_version + 1 where id = p_revision_id;
  return v_lock + 1;
end;
$$;

-- -------------------------------------------------------------- commit ----

create or replace function public.arc_commit_source_document_upload(
  p_intent_id uuid,
  p_owner_user_id uuid,
  p_guest_token_hash text,
  p_expected_lock_version integer
) returns table(
  source_document_id uuid,
  duplicate boolean,
  associated boolean,
  association_conflict boolean,
  lock_version integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v record;
  v_doc uuid;
  v_duplicate boolean;
  v_associated boolean := false;
  v_conflict boolean := false;
  v_lock integer;
  v_guest record;
begin
  select * into v from public.document_upload_intents i where i.id = p_intent_id for update;
  if v.id is null then
    raise exception 'that upload was not found' using errcode = '42501';
  end if;

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
      where g.id = v.guest_workspace_id and g.token_hash = p_guest_token_hash
    ) then
      raise exception 'that temporary workspace is no longer available' using errcode = '42501';
    end if;
  end if;

  if v.state = 'finalized' then
    source_document_id := v.resolved_source_document_id;
    duplicate := coalesce(v.is_duplicate, false);
    associated := v.target_revision_id is not null and exists (
      select 1 from public.revision_source_documents rsd
      where rsd.revision_id = v.target_revision_id
        and rsd.source_document_id = v.resolved_source_document_id);
    association_conflict := false;
    select r.lock_version into lock_version from public.analysis_revisions r
      where r.id = v.target_revision_id;
    return next;
    return;
  end if;

  if v.state <> 'prepared' then
    raise exception 'this upload has not been validated yet' using errcode = '22023';
  end if;
  if v.expires_at <= now() then
    raise exception 'that upload has expired' using errcode = '42501';
  end if;

  v_duplicate := coalesce(v.is_duplicate, false);

  if v_duplicate then
    -- An existing document is reused exactly as it is; its metadata is never
    -- overwritten by a later identical upload.
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
    returning id into v_doc;

    if v_doc is null then
      -- Lost a concurrent same-hash race: adopt the winner and queue the
      -- reserved object so no orphan bytes are left behind.
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
    begin
      v_lock := public.arc_attach_source_document(
        p_owner_user_id, v.target_revision_id, v_doc, p_expected_lock_version);
      v_associated := true;
    exception when others then
      -- The document itself is accepted; only the selection failed.
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
      insert into public.guest_source_document_selections (guest_workspace_id, source_document_id)
      values (v.guest_workspace_id, v_doc)
      on conflict do nothing;
      update public.guest_workspaces set lock_version = lock_version + 1
        where id = v.guest_workspace_id;
      v_associated := true;
      v_lock := v_guest.lock_version + 1;
    end if;
  end if;

  update public.document_upload_intents
     set state = 'finalized', resolved_source_document_id = v_doc, is_duplicate = v_duplicate
   where id = p_intent_id;

  source_document_id := v_doc;
  duplicate := v_duplicate;
  associated := v_associated;
  association_conflict := v_conflict;
  lock_version := v_lock;
  return next;
end;
$$;

-- ------------------------------------------------- metadata and archive ----

create or replace function public.arc_update_source_document_metadata(
  p_owner_user_id uuid,
  p_source_document_id uuid,
  p_display_name text,
  p_document_type text,
  p_effective_date date
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_contract uuid;
begin
  if coalesce(trim(p_display_name), '') = '' then
    raise exception 'a document name is required' using errcode = '22023';
  end if;

  select d.contract_id into v_contract
    from public.source_documents d
    join public.contracts ct on ct.id = d.contract_id
    join public.customers c on c.id = ct.customer_id
   where d.id = p_source_document_id and c.owner_user_id = p_owner_user_id
   for update of d;

  if v_contract is null then
    raise exception 'that document was not found for this owner' using errcode = '42501';
  end if;
  if public.arc_source_document_in_history(p_source_document_id) then
    raise exception 'this document is referenced by finalized history, so its details are locked'
      using errcode = '42501';
  end if;

  update public.source_documents
     set display_name = trim(p_display_name),
         document_type = p_document_type,
         effective_date = p_effective_date
   where id = p_source_document_id;

  return p_source_document_id;
end;
$$;

create or replace function public.arc_set_source_document_archived(
  p_owner_user_id uuid,
  p_source_document_id uuid,
  p_archived boolean
) returns timestamptz
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_contract uuid;
  v_at timestamptz;
begin
  select d.contract_id into v_contract
    from public.source_documents d
    join public.contracts ct on ct.id = d.contract_id
    join public.customers c on c.id = ct.customer_id
   where d.id = p_source_document_id and c.owner_user_id = p_owner_user_id
   for update of d;

  if v_contract is null then
    raise exception 'that document was not found for this owner' using errcode = '42501';
  end if;

  -- Archiving stays available even for documents inside finalized history.
  update public.source_documents
     set archived_at = case when p_archived then now() else null end
   where id = p_source_document_id
  returning archived_at into v_at;

  return v_at;
end;
$$;

-- --------------------------------------------------------- hard deletion ---

create or replace function public.arc_stage_source_document_deletion(
  p_owner_user_id uuid,
  p_guest_token_hash text,
  p_source_document_id uuid,
  p_expected_lock_version integer
) returns table(queued boolean, lock_version integer)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_doc record;
  v_draft record;
  v_guest record;
begin
  select * into v_doc from public.source_documents d
   where d.id = p_source_document_id for update;
  if v_doc.id is null then
    raise exception 'that document was not found' using errcode = '42501';
  end if;

  if v_doc.contract_id is not null then
    if p_owner_user_id is null or not exists (
      select 1 from public.contracts ct
      join public.customers c on c.id = ct.customer_id
      where ct.id = v_doc.contract_id and c.owner_user_id = p_owner_user_id
    ) then
      raise exception 'that document belongs to another account' using errcode = '42501';
    end if;
  else
    if coalesce(trim(p_guest_token_hash), '') = '' or not exists (
      select 1 from public.guest_workspaces g
      where g.id = v_doc.guest_workspace_id and g.token_hash = p_guest_token_hash
    ) then
      raise exception 'that temporary workspace is no longer available' using errcode = '42501';
    end if;
  end if;

  if public.arc_source_document_in_history(p_source_document_id) then
    raise exception 'this document is part of finalized history and cannot be deleted'
      using errcode = '42501';
  end if;

  lock_version := null;

  if v_doc.contract_id is not null then
    select r.id, r.lock_version into v_draft
      from public.analysis_revisions r
      join public.analyses a on a.id = r.analysis_id
      join public.revision_source_documents rsd on rsd.revision_id = r.id
     where a.contract_id = v_doc.contract_id
       and r.status = 'draft'
       and rsd.source_document_id = p_source_document_id
     for update of r;

    if v_draft.id is not null then
      if v_draft.lock_version is distinct from p_expected_lock_version then
        raise exception 'the draft changed since it was loaded' using errcode = '40001';
      end if;
      delete from public.revision_source_documents
       where revision_id = v_draft.id and source_document_id = p_source_document_id;
      update public.analysis_revisions set lock_version = lock_version + 1 where id = v_draft.id;
      lock_version := v_draft.lock_version + 1;
    end if;
  else
    select * into v_guest from public.guest_workspaces g
     where g.id = v_doc.guest_workspace_id for update;
    if exists (select 1 from public.guest_source_document_selections s
                where s.guest_workspace_id = v_doc.guest_workspace_id
                  and s.source_document_id = p_source_document_id) then
      if v_guest.lock_version is distinct from p_expected_lock_version then
        raise exception 'the temporary workspace changed since it was loaded' using errcode = '40001';
      end if;
      delete from public.guest_source_document_selections
       where guest_workspace_id = v_doc.guest_workspace_id
         and source_document_id = p_source_document_id;
      update public.guest_workspaces set lock_version = lock_version + 1
        where id = v_doc.guest_workspace_id;
      lock_version := v_guest.lock_version + 1;
    end if;
  end if;

  -- The immutable object reference is queued before the row disappears.
  insert into public.storage_deletion_queue (storage_bucket, storage_object_path, reason)
  values (v_doc.storage_bucket, v_doc.storage_object_path, 'document_deleted')
  on conflict do nothing;

  delete from public.source_documents where id = p_source_document_id;

  queued := true;
  return next;
end;
$$;

-- ------------------------------------------------------- deletion queue ----

create or replace function public.arc_claim_storage_deletion_jobs(p_limit integer default 25)
returns table(id uuid, storage_bucket text, storage_object_path text, attempt_count integer)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  return query
  with claimed as (
    select q.id
      from public.storage_deletion_queue q
     where q.completed_at is null
       and (q.claimed_at is null or q.claimed_at < now() - interval '15 minutes')
     order by q.created_at
     for update skip locked
     limit greatest(coalesce(p_limit, 25), 1)
  )
  update public.storage_deletion_queue q
     set claimed_at = now(), attempt_count = q.attempt_count + 1
    from claimed
   where q.id = claimed.id
  returning q.id, q.storage_bucket, q.storage_object_path, q.attempt_count;
end;
$$;

create or replace function public.arc_complete_storage_deletion_job(p_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.storage_deletion_queue
     set completed_at = now(), last_error = null
   where id = p_job_id and completed_at is null;
  return found;
end;
$$;

create or replace function public.arc_release_storage_deletion_job(p_job_id uuid, p_error text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.storage_deletion_queue
     set claimed_at = null, last_error = left(coalesce(p_error, ''), 500)
   where id = p_job_id and completed_at is null;
  return found;
end;
$$;

-- ------------------------------------------------------------ privileges ---

do $grants$
declare
  fn text;
begin
  foreach fn in array array[
    'public.arc_prepare_source_document_upload(uuid,uuid,text,text,bigint,integer)',
    'public.arc_commit_source_document_upload(uuid,uuid,text,integer)',
    'public.arc_attach_source_document(uuid,uuid,uuid,integer)',
    'public.arc_remove_source_document(uuid,uuid,uuid,integer)',
    'public.arc_update_source_document_metadata(uuid,uuid,text,text,date)',
    'public.arc_set_source_document_archived(uuid,uuid,boolean)',
    'public.arc_stage_source_document_deletion(uuid,text,uuid,integer)',
    'public.arc_claim_storage_deletion_jobs(integer)',
    'public.arc_complete_storage_deletion_job(uuid)',
    'public.arc_release_storage_deletion_job(uuid,text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $grants$;