-- Phase 9F backward-compatibility patch.
-- Each function below is the latest ACCEPTED Phase 8 implementation with ONLY
-- the intended Phase 9F AI hooks layered on top:
--   * arc_guard_ai_source_freeze before any selection-changing mutation
--   * arc_mark_ai_sources_stale only after an association actually changed
--   * draft AI sidecar reset where the draft's work is abandoned
-- No authorization, idempotency, lock ordering, source-association or history
-- protection behaviour is changed.

create or replace function public.arc_reset_amendment_draft(
  p_owner_user_id uuid,
  p_revision_id uuid,
  p_expected_lock_version integer
) returns table(lock_version integer, schema_version text, source_revision_id uuid)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_analysis_id uuid;
  v_current uuid;
  v_status public.arc_revision_status;
  v_lock integer;
  v_source uuid;
  v_inputs jsonb;
  v_schema text;
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
    raise exception 'only an unfinished draft revision can be reset' using errcode = '42501';
  end if;
  if v_source is null then
    raise exception 'this draft does not continue a finalized revision' using errcode = '22023';
  end if;
  if v_current is distinct from v_source then
    raise exception 'the analysis has moved on since it was loaded' using errcode = '40001';
  end if;
  -- Phase 9F: a model result that can still be applied freezes the source set.
  perform public.arc_guard_ai_source_freeze(p_revision_id, null);
  -- Rejected before either the inputs or the source set is touched.
  if v_lock <> p_expected_lock_version then
    raise exception 'the draft changed since it was loaded' using errcode = '40001';
  end if;

  select r.canonical_inputs, r.schema_version
    into v_inputs, v_schema
    from public.analysis_revisions r
   where r.id = v_source;

  update public.analysis_revisions r
     set canonical_inputs = v_inputs,
         schema_version = v_schema,
         lock_version = r.lock_version + 1
   where r.id = p_revision_id
     and r.status = 'draft'
     and r.lock_version = p_expected_lock_version;

  if not found then
    raise exception 'the draft changed since it was loaded' using errcode = '40001';
  end if;

  -- Same transaction, same single lock advance: the draft's source set becomes
  -- exactly the source revision's set. Draft-only documents stay in the
  -- contract library; only the association is removed.
  delete from public.revision_source_documents rsd
   where rsd.revision_id = p_revision_id
     and rsd.source_document_id not in (
       select s.source_document_id
         from public.revision_source_documents s
        where s.revision_id = v_source
     );

  insert into public.revision_source_documents (revision_id, source_document_id)
  select p_revision_id, s.source_document_id
    from public.revision_source_documents s
   where s.revision_id = v_source
  on conflict do nothing;

  -- Phase 9F: the abandoned draft's mutable AI sidecar goes with the abandoned
  -- work. The finalized source revision's own AI state is untouched, and the
  -- finalized sidecar is never copied into the draft.
  delete from public.ai_analysis_state s where s.revision_id = p_revision_id;

  lock_version := p_expected_lock_version + 1;
  schema_version := v_schema;
  source_revision_id := v_source;
  return next;
end;
$$;

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
  v_draft_id uuid;
  v_observed integer;
  v_guest record;
  v_still_selected uuid;
begin
  -- Candidate read only: this is an unlocked identification of the document,
  -- never treated as its final state. Everything is revalidated under locks.
  select * into v_doc from public.source_documents d
   where d.id = p_source_document_id;
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
      where g.id = v_doc.guest_workspace_id
        and g.token_hash = p_guest_token_hash
        and g.status = 'active'
        and g.expires_at > now()
    ) then
      raise exception 'that temporary workspace is no longer available' using errcode = '42501';
    end if;
  end if;

  lock_version := null;

  if v_doc.contract_id is not null then
    -- Is this document selected by the contract's active draft?
    select r.id into v_draft_id
      from public.analysis_revisions r
      join public.analyses a on a.id = r.analysis_id
      join public.revision_source_documents rsd on rsd.revision_id = r.id
     where a.contract_id = v_doc.contract_id
       and r.status = 'draft'
       and rsd.source_document_id = p_source_document_id
     limit 1;

    -- Lock order, identical to arc_finalize_revision: revision first.
    if v_draft_id is not null then
      select r.lock_version into v_observed
        from public.analysis_revisions r
       where r.id = v_draft_id
       for update;
    end if;

    -- Source document second.
    select * into v_doc from public.source_documents d
     where d.id = p_source_document_id
     for update;

    -- Revalidate everything under the locks.
    if v_doc.id is null then
      raise exception 'that document was not found' using errcode = '42501';
    end if;
    if v_doc.contract_id is null or not exists (
      select 1 from public.contracts ct
      join public.customers c on c.id = ct.customer_id
      where ct.id = v_doc.contract_id and c.owner_user_id = p_owner_user_id
    ) then
      raise exception 'that document belongs to another account' using errcode = '42501';
    end if;
    if public.arc_source_document_in_history(p_source_document_id) then
      raise exception 'this document is part of finalized history and cannot be deleted'
        using errcode = '42501';
    end if;

    select r.id into v_still_selected
      from public.analysis_revisions r
      join public.analyses a on a.id = r.analysis_id
      join public.revision_source_documents rsd on rsd.revision_id = r.id
     where a.contract_id = v_doc.contract_id
       and r.status = 'draft'
       and rsd.source_document_id = p_source_document_id
     limit 1;

    if v_still_selected is distinct from v_draft_id then
      -- The draft selection changed between the candidate read and the locks;
      -- the caller's view is stale, so nothing is deleted.
      raise exception 'the draft changed since it was loaded' using errcode = '40001';
    end if;

    if v_draft_id is not null then
      -- Phase 9F: freeze before the selected set is mutated.
      perform public.arc_guard_ai_source_freeze(v_draft_id, null);
      select r.lock_version into v_observed
        from public.analysis_revisions r
       where r.id = v_draft_id;
      if v_observed is distinct from p_expected_lock_version then
        raise exception 'the draft changed since it was loaded' using errcode = '40001';
      end if;
      delete from public.revision_source_documents rsd
       where rsd.revision_id = v_draft_id
         and rsd.source_document_id = p_source_document_id;
      -- Phase 9F: the selection really changed, so any AI result is stale.
      perform public.arc_mark_ai_sources_stale(v_draft_id, null);
      update public.analysis_revisions r
         set lock_version = r.lock_version + 1
       where r.id = v_draft_id;
      lock_version := v_observed + 1;
    end if;
  else
    select * into v_doc from public.source_documents d
     where d.id = p_source_document_id
     for update;
    if v_doc.id is null then
      raise exception 'that document was not found' using errcode = '42501';
    end if;
    if public.arc_source_document_in_history(p_source_document_id) then
      raise exception 'this document is part of finalized history and cannot be deleted'
        using errcode = '42501';
    end if;

    select g.id as workspace_id, g.lock_version as observed into v_guest
      from public.guest_workspaces g
     where g.id = v_doc.guest_workspace_id for update;
    if exists (select 1 from public.guest_source_document_selections s
                where s.guest_workspace_id = v_doc.guest_workspace_id
                  and s.source_document_id = p_source_document_id) then
      perform public.arc_guard_ai_source_freeze(null, v_doc.guest_workspace_id);
      if v_guest.observed is distinct from p_expected_lock_version then
        raise exception 'the temporary workspace changed since it was loaded' using errcode = '40001';
      end if;
      delete from public.guest_source_document_selections s
       where s.guest_workspace_id = v_doc.guest_workspace_id
         and s.source_document_id = p_source_document_id;
      perform public.arc_mark_ai_sources_stale(null, v_doc.guest_workspace_id);
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

  -- Phase 9F: a model result that could still be applied must not have its
  -- target deleted underneath it. Checked only once the draft is locked.
  perform public.arc_guard_ai_source_freeze(v_draft_id, null);

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

  -- ai_analysis_state, ai_runs, ai_run_sources and ai_run_guidance all fall
  -- away through the existing revision/contract cascade.
  delete from public.contracts c where c.id = v_contract_id;

  deleted_contract_id := v_contract_id;
  return next;
end;
$$;

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

  -- Phase 9F: freeze before the selected set can change.
  perform public.arc_guard_ai_source_freeze(null, v_guest.id);

  if v_guest.lock_version is distinct from p_expected_lock_version then
    raise exception 'the temporary workspace changed since it was loaded' using errcode = '40001';
  end if;

  -- A cross-workspace request is refused outright, never a silent no-op.
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

  -- Phase 9F: the selection really changed, so any AI result is stale.
  perform public.arc_mark_ai_sources_stale(null, v_guest.id);
  update public.guest_workspaces g set lock_version = g.lock_version + 1 where g.id = v_guest.id;
  return v_guest.lock_version + 1;
end;
$$;