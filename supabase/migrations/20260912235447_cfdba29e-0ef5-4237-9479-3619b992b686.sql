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
    begin
      v_lock := public.arc_attach_source_document(
        p_owner_user_id, v.target_revision_id, v_doc, p_expected_lock_version);
      v_associated := true;
    exception when sqlstate '40001' then
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
        v_lock := v_guest.lock_version;
      else
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
$$;

revoke all on function public.arc_commit_source_document_upload(uuid,uuid,text,integer)
  from public, anon, authenticated;
grant execute on function public.arc_commit_source_document_upload(uuid,uuid,text,integer) to service_role;