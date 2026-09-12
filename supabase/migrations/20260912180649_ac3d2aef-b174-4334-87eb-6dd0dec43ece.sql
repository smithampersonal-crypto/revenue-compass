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
    select r.id as revision_id, r.lock_version as observed into v_draft
      from public.analysis_revisions r
      join public.analyses a on a.id = r.analysis_id
      join public.revision_source_documents rsd on rsd.revision_id = r.id
     where a.contract_id = v_doc.contract_id
       and r.status = 'draft'
       and rsd.source_document_id = p_source_document_id
     for update of r;

    if v_draft.revision_id is not null then
      if v_draft.observed is distinct from p_expected_lock_version then
        raise exception 'the draft changed since it was loaded' using errcode = '40001';
      end if;
      delete from public.revision_source_documents rsd
       where rsd.revision_id = v_draft.revision_id
         and rsd.source_document_id = p_source_document_id;
      update public.analysis_revisions r
         set lock_version = r.lock_version + 1
       where r.id = v_draft.revision_id;
      lock_version := v_draft.observed + 1;
    end if;
  else
    select g.id as workspace_id, g.lock_version as observed into v_guest
      from public.guest_workspaces g
     where g.id = v_doc.guest_workspace_id for update;
    if exists (select 1 from public.guest_source_document_selections s
                where s.guest_workspace_id = v_doc.guest_workspace_id
                  and s.source_document_id = p_source_document_id) then
      if v_guest.observed is distinct from p_expected_lock_version then
        raise exception 'the temporary workspace changed since it was loaded' using errcode = '40001';
      end if;
      delete from public.guest_source_document_selections s
       where s.guest_workspace_id = v_doc.guest_workspace_id
         and s.source_document_id = p_source_document_id;
      update public.guest_workspaces g
         set lock_version = g.lock_version + 1
       where g.id = v_doc.guest_workspace_id;
      lock_version := v_guest.observed + 1;
    end if;
  end if;

  insert into public.storage_deletion_queue (storage_bucket, storage_object_path, reason)
  values (v_doc.storage_bucket, v_doc.storage_object_path, 'document_deleted')
  on conflict do nothing;

  delete from public.source_documents d where d.id = p_source_document_id;

  queued := true;
  return next;
end;
$$;

revoke all on function public.arc_stage_source_document_deletion(uuid,text,uuid,integer)
  from public, anon, authenticated;
grant execute on function public.arc_stage_source_document_deletion(uuid,text,uuid,integer)
  to service_role;