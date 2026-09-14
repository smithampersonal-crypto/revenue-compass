-- ARC Phase 8E acceptance correction (B) — deterministic lock ordering between
-- upload finalization and initial-draft contract deletion.
--
-- arc_commit_source_document_upload takes: intent FOR UPDATE -> revision FOR UPDATE.
-- Initial-draft deletion previously took: revision FOR UPDATE -> (cascade) intents,
-- which is the reverse edge and therefore a potential cycle. This function now
-- locks every one of the contract's document_upload_intents rows, in ascending
-- id order, BEFORE the draft revision, so both transactions acquire the same
-- resources in the same direction.
--
-- Lock direction: contract -> analysis -> upload intents -> draft revision ->
-- source documents. Eligibility is revalidated after all locks are held.

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

  -- 1. Contract (ownership decided here, never by the caller's hint).
  select c.id into v_contract_id
    from public.contracts c
    join public.customers cu on cu.id = c.customer_id
   where c.id = p_contract_id
     and cu.owner_user_id = p_owner_user_id
   for update of c;

  if v_contract_id is null then
    raise exception 'that contract is not in your workspace' using errcode = '42501';
  end if;

  -- 2. Analysis.
  select a.id, a.current_finalized_revision_id
    into v_analysis_id, v_current_finalized
    from public.analyses a
   where a.contract_id = v_contract_id
   for update;

  if v_analysis_id is null then
    raise exception 'that analysis is no longer available' using errcode = '42501';
  end if;

  -- 3. Upload intents, ascending id, before any revision lock. This is the
  --    edge that removes the cycle with arc_commit_source_document_upload.
  perform i.id
     from public.document_upload_intents i
    where i.contract_id = v_contract_id
    order by i.id
      for update;

  -- 4. Draft revision.
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

  -- Eligibility revalidated once every lock is held: a concurrent finalize wins.
  select a.current_finalized_revision_id into v_current_finalized
    from public.analyses a where a.id = v_analysis_id;

  if v_current_finalized is not null
     or exists (
          select 1 from public.analysis_revisions r
           where r.analysis_id = v_analysis_id
             and r.status in ('finalized', 'superseded')
        ) then
    raise exception 'that analysis has finalized history and cannot be deleted this way'
      using errcode = '42501';
  end if;

  -- 5. Source documents, ascending id. Every private object is queued durably
  --    before relational ownership disappears.
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