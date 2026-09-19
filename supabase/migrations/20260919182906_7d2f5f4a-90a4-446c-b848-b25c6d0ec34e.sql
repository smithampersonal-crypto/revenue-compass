-- ARC Post-R2 Database Hardening — non-retryable conflict SQLSTATE (part 4 of 4
-- of the reviewed staged migration 20260919060000_post_r2_conflict_sqlstate.sql).

CREATE OR REPLACE FUNCTION public.arc_restore_pre_ai_run(p_run_id uuid, p_owner_user_id uuid, p_guest_token_hash text, p_expected_lock_version integer)
 RETURNS TABLE(lock_version integer, idempotent boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_run public.ai_runs;
  v_status public.arc_revision_status;
  v_lock integer;
  v_schema text;
  v_last uuid;
  v_prior jsonb;
  v_current_sources text;
begin
  select * into v_run from public.ai_runs where id = p_run_id;
  if v_run.id is null then
    raise exception 'ARC: unknown AI run' using errcode = '42501';
  end if;

  if v_run.revision_id is not null then
    select r.status, r.lock_version, r.schema_version into v_status, v_lock, v_schema
      from public.analysis_revisions r
      join public.analyses a on a.id = r.analysis_id
      join public.contracts ct on ct.id = a.contract_id
      join public.customers c on c.id = ct.customer_id
     where r.id = v_run.revision_id
       and c.owner_user_id = p_owner_user_id
     for update of r;
    if v_status is null then
      raise exception 'ARC: that analysis was not found for this caller' using errcode = '42501';
    end if;
    if v_status <> 'draft' then
      raise exception 'ARC: a finalized revision cannot be restored' using errcode = '42501';
    end if;
  else
    select g.lock_version, g.schema_version into v_lock, v_schema
      from public.guest_workspaces g
     where g.id = v_run.guest_workspace_id
       and g.token_hash = p_guest_token_hash
       and g.status = 'active'
       and g.expires_at > now()
     for update;
    if v_lock is null then
      raise exception 'ARC: that temporary workspace is no longer available' using errcode = '42501';
    end if;
  end if;

  select * into v_run from public.ai_runs where id = p_run_id for update;

  if v_run.stage <> 'succeeded' then
    raise exception 'ARC: only a successful AI run can be undone' using errcode = '42501';
  end if;

  -- No other run may be mid-flight underneath a restore.
  if exists (
    select 1 from public.ai_runs r
     where r.id <> p_run_id
       and ((v_run.revision_id is not null and r.revision_id = v_run.revision_id)
         or (v_run.guest_workspace_id is not null and r.guest_workspace_id = v_run.guest_workspace_id))
       and r.stage in ('created', 'extracting', 'preflight_ready', 'analyzing', 'validating', 'applying')
  ) then
    raise exception 'ARC: an AI analysis is still running for this analysis' using errcode = '42501';
  end if;

  select s.last_successful_run_id into v_last
    from public.ai_analysis_state s
   where (v_run.revision_id is not null and s.revision_id = v_run.revision_id)
      or (v_run.guest_workspace_id is not null and s.guest_workspace_id = v_run.guest_workspace_id);

  -- Response-loss retry: the restore already committed. This stays FIRST, so a
  -- lost response is still idempotent even if the world moved on afterwards.
  if v_run.restored_at is not null and v_last is distinct from p_run_id then
    lock_version := v_lock;
    idempotent := true;
    return next;
    return;
  end if;

  -- v1 restores only the CURRENT last successful run, never an older one.
  if v_last is distinct from p_run_id then
    raise exception 'ARC: only the most recent successful AI analysis can be undone'
      using errcode = '42501';
  end if;
  if v_lock <> p_expected_lock_version then
    raise exception 'ARC: the analysis changed since it was loaded' using errcode = 'PT409';
  end if;

  -- Restore does not touch the selected documents, so the selection must still
  -- be the one this run analyzed for the restored state to be exact.
  v_current_sources := public.arc_ai_source_set_fingerprint(
    v_run.revision_id, v_run.guest_workspace_id);
  if v_current_sources is distinct from v_run.source_set_fingerprint then
    raise exception 'ARC: the selected source documents changed since that AI analysis'
      using errcode = '42501';
  end if;

  -- The canonical draft goes back to the exact pre-run snapshot (unchanged
  -- from the original routine), under the same optimistic lock.
  if v_run.revision_id is not null then
    update public.analysis_revisions r
       set canonical_inputs = v_run.pre_run_canonical_inputs,
           lock_version = r.lock_version + 1
     where r.id = v_run.revision_id
       and r.lock_version = p_expected_lock_version;
  else
    update public.guest_workspaces g
       set draft_json = v_run.pre_run_canonical_inputs,
           lock_version = g.lock_version + 1
     where g.id = v_run.guest_workspace_id
       and g.lock_version = p_expected_lock_version;
  end if;

  v_prior := v_run.pre_run_ai_state;

  -- A legacy snapshot cannot be restored exactly, so it is not restored at all.
  if v_prior is not null and v_prior <> 'null'::jsonb then
    if jsonb_typeof(v_prior) <> 'object'
       or not (v_prior ? 'acknowledged_source_fingerprint')
       or not (v_prior ? 'source_acknowledged_at')
       or not (v_prior ? 'source_acknowledged_by') then
      raise exception 'ARC: that AI analysis cannot be restored exactly' using errcode = '42501';
    end if;
  end if;

  if v_prior is null or v_prior = 'null'::jsonb then
    -- Exactly the recorded prior state: there was no AI sidecar at all.
    delete from public.ai_analysis_state s
     where (v_run.revision_id is not null and s.revision_id = v_run.revision_id)
        or (v_run.guest_workspace_id is not null and s.guest_workspace_id = v_run.guest_workspace_id);
  else
    update public.ai_analysis_state s
       set last_successful_run_id = nullif(v_prior ->> 'last_successful_run_id', '')::uuid,
           source_set_fingerprint = nullif(v_prior ->> 'source_set_fingerprint', ''),
           source_state = coalesce(v_prior ->> 'source_state', 'none'),
           field_provenance = coalesce(v_prior -> 'field_provenance', '{}'::jsonb),
           object_provenance = coalesce(v_prior -> 'object_provenance', '{}'::jsonb),
           tombstones = coalesce(v_prior -> 'tombstones', '[]'::jsonb),
           review_items = coalesce(v_prior -> 'review_items', '[]'::jsonb),
           acknowledged_source_fingerprint =
             nullif(v_prior ->> 'acknowledged_source_fingerprint', ''),
           source_acknowledged_at =
             nullif(v_prior ->> 'source_acknowledged_at', '')::timestamptz,
           source_acknowledged_by =
             nullif(v_prior ->> 'source_acknowledged_by', '')::uuid,
           lock_version = s.lock_version + 1
     where (v_run.revision_id is not null and s.revision_id = v_run.revision_id)
        or (v_run.guest_workspace_id is not null and s.guest_workspace_id = v_run.guest_workspace_id);
    if not found then
      insert into public.ai_analysis_state (
        revision_id, guest_workspace_id, last_successful_run_id, source_set_fingerprint,
        source_state, field_provenance, object_provenance, tombstones, review_items,
        acknowledged_source_fingerprint, source_acknowledged_at, source_acknowledged_by)
      values (
        v_run.revision_id, v_run.guest_workspace_id,
        nullif(v_prior ->> 'last_successful_run_id', '')::uuid,
        nullif(v_prior ->> 'source_set_fingerprint', ''),
        coalesce(v_prior ->> 'source_state', 'none'),
        coalesce(v_prior -> 'field_provenance', '{}'::jsonb),
        coalesce(v_prior -> 'object_provenance', '{}'::jsonb),
        coalesce(v_prior -> 'tombstones', '[]'::jsonb),
        coalesce(v_prior -> 'review_items', '[]'::jsonb),
        nullif(v_prior ->> 'acknowledged_source_fingerprint', ''),
        nullif(v_prior ->> 'source_acknowledged_at', '')::timestamptz,
        nullif(v_prior ->> 'source_acknowledged_by', '')::uuid);
    end if;
  end if;

  -- Run history, quota and the selected source documents are untouched.
  update public.ai_runs set restored_at = now() where id = p_run_id;

  lock_version := p_expected_lock_version + 1;
  idempotent := false;
  return next;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.arc_save_draft_with_ai_reconciliation(p_owner_user_id uuid, p_guest_token_hash text, p_revision_id uuid, p_guest_workspace_id uuid, p_expected_lock_version integer, p_canonical_inputs jsonb, p_schema_version text, p_ai_state jsonb, p_review_events jsonb DEFAULT '[]'::jsonb, p_actor_user_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(lock_version integer, saved_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_lock integer;
  v_actor uuid;
  v_run uuid;
  v_saved timestamptz;
  v_event jsonb;
begin
  -- Post-R2 live regression patch. Bound the time this routine may spend
  -- waiting on the owner row, and the time an abandoned in-flight autosave may
  -- keep that row locked. Without these bounds a client that disappears
  -- mid-save leaves the row locked, every later save blocks on it while
  -- holding a pooled connection, and the pool is exhausted (PGRST003) instead
  -- of one save failing cleanly. Nothing else about the routine changes.
  set local lock_timeout = '3s';
  set local idle_in_transaction_session_timeout = '15s';

  if p_expected_lock_version is null or p_canonical_inputs is null
     or p_ai_state is null or coalesce(btrim(p_schema_version), '') = '' then
    raise exception 'ARC: an autosave requires a lock version and canonical state'
      using errcode = '22023';
  end if;

  -- Ownership, draft status, guest credential and expiry, plus the owner-row
  -- lock, in the accepted Task 2 order.
  v_lock := public.arc_lock_ai_review_scope(p_owner_user_id, p_guest_token_hash,
                                            p_revision_id, p_guest_workspace_id);
  v_actor := public.arc_ai_review_actor(p_owner_user_id, p_actor_user_id, p_revision_id);

  if v_lock <> p_expected_lock_version then
    raise exception 'ARC: the analysis changed since it was loaded' using errcode = 'PT409';
  end if;

  if p_revision_id is not null then
    update public.analysis_revisions r
       set canonical_inputs = p_canonical_inputs,
           schema_version = p_schema_version,
           lock_version = r.lock_version + 1
     where r.id = p_revision_id
       and r.status = 'draft'
       and r.lock_version = p_expected_lock_version
    returning r.updated_at into v_saved;
  else
    update public.guest_workspaces g
       set draft_json = p_canonical_inputs,
           schema_version = p_schema_version,
           lock_version = g.lock_version + 1
     where g.id = p_guest_workspace_id
       and g.status = 'active'
       and g.lock_version = p_expected_lock_version
    returning g.updated_at into v_saved;
  end if;

  if v_saved is null then
    raise exception 'ARC: the analysis changed since it was loaded' using errcode = 'PT409';
  end if;

  -- Only the reconciliation fields move. A missing sidecar row means this
  -- analysis has never used AI, so there is nothing to reconcile.
  select s.last_successful_run_id into v_run
    from public.ai_analysis_state s
   where (p_revision_id is not null and s.revision_id = p_revision_id)
      or (p_guest_workspace_id is not null and s.guest_workspace_id = p_guest_workspace_id)
   for update;

  if found then
    update public.ai_analysis_state s
       set field_provenance = coalesce(p_ai_state -> 'fieldProvenance', s.field_provenance),
           object_provenance = coalesce(p_ai_state -> 'objectProvenance', s.object_provenance),
           tombstones = coalesce(p_ai_state -> 'tombstones', s.tombstones),
           review_items = coalesce(p_ai_state -> 'reviewItems', s.review_items),
           lock_version = s.lock_version + 1
     where (p_revision_id is not null and s.revision_id = p_revision_id)
        or (p_guest_workspace_id is not null and s.guest_workspace_id = p_guest_workspace_id);

    for v_event in select value from jsonb_array_elements(coalesce(p_review_events, '[]'::jsonb)) value
    loop
      if (v_event ->> 'type') = 'yellow_affirmed' then
        insert into public.ai_review_events (
          revision_id, guest_workspace_id, ai_run_id, actor_kind, actor_user_id, event_type,
          review_item_id, review_target_key, review_section, review_severity, review_fingerprint)
        values (
          p_revision_id, p_guest_workspace_id, v_run,
          case when v_actor is not null then 'authenticated' else 'guest' end,
          v_actor,
          'yellow_affirmed',
          v_event ->> 'reviewItemId', v_event ->> 'targetKey', v_event ->> 'section',
          'yellow', v_event ->> 'reviewFingerprint');
      elsif (v_event ->> 'type') = 'review_item_reopened' then
        insert into public.ai_review_events (
          revision_id, guest_workspace_id, ai_run_id, actor_kind, actor_user_id, event_type,
          review_item_id, review_target_key, review_section, review_severity, review_fingerprint)
        values (
          p_revision_id, p_guest_workspace_id, v_run, 'system', null,
          'review_item_reopened',
          v_event ->> 'reviewItemId', v_event ->> 'targetKey', v_event ->> 'section',
          coalesce(v_event ->> 'severity', 'yellow'), v_event ->> 'reviewFingerprint');
      else
        raise exception 'ARC: unknown reconciliation event' using errcode = '22023';
      end if;
    end loop;
  end if;

  lock_version := p_expected_lock_version + 1;
  saved_at := v_saved;
  return next;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.arc_stage_source_document_deletion(p_owner_user_id uuid, p_guest_token_hash text, p_source_document_id uuid, p_expected_lock_version integer)
 RETURNS TABLE(queued boolean, lock_version integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
      raise exception 'the draft changed since it was loaded' using errcode = 'PT409';
    end if;

    if v_draft_id is not null then
      -- Phase 9F: freeze before the selected set is mutated.
      perform public.arc_guard_ai_source_freeze(v_draft_id, null);
      select r.lock_version into v_observed
        from public.analysis_revisions r
       where r.id = v_draft_id;
      if v_observed is distinct from p_expected_lock_version then
        raise exception 'the draft changed since it was loaded' using errcode = 'PT409';
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
        raise exception 'the temporary workspace changed since it was loaded' using errcode = 'PT409';
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
$function$
;

CREATE OR REPLACE FUNCTION public.arc_start_amendment_revision(p_owner_user_id uuid, p_contract_id uuid, p_expected_source_revision_id uuid)
 RETURNS TABLE(revision_id uuid, created boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_analysis_id uuid;
  v_current uuid;
  v_existing uuid;
  v_next integer;
  v_inputs jsonb;
  v_schema text;
  v_new uuid;
begin
  if p_owner_user_id is null or p_contract_id is null or p_expected_source_revision_id is null then
    raise exception 'owner, contract and expected source revision are required' using errcode = '22023';
  end if;

  select a.id, a.current_finalized_revision_id
    into v_analysis_id, v_current
    from public.analyses a
    join public.contracts ct on ct.id = a.contract_id
    join public.customers c on c.id = ct.customer_id
   where a.contract_id = p_contract_id
     and c.owner_user_id = p_owner_user_id
   for update of a;

  if v_analysis_id is null then
    raise exception 'that contract was not found for this owner' using errcode = '42501';
  end if;

  select r.id into v_existing
    from public.analysis_revisions r
   where r.analysis_id = v_analysis_id
     and r.status = 'draft'
   limit 1;

  if v_existing is not null then
    -- Idempotent retry: the active draft is returned untouched. Its source set
    -- is the accountant's working selection and is never re-copied, and its
    -- lock version is not bumped.
    revision_id := v_existing;
    created := false;
    return next;
    return;
  end if;

  if v_current is null then
    raise exception 'this analysis has no finalized revision to continue from' using errcode = '22023';
  end if;

  if v_current is distinct from p_expected_source_revision_id then
    raise exception 'the analysis has moved on since it was loaded (expected source %, found %)',
      p_expected_source_revision_id, v_current using errcode = 'PT409';
  end if;

  select r.canonical_inputs, r.schema_version
    into v_inputs, v_schema
    from public.analysis_revisions r
   where r.id = v_current;

  select coalesce(max(r.revision_number), 0) + 1
    into v_next
    from public.analysis_revisions r
   where r.analysis_id = v_analysis_id;

  insert into public.analysis_revisions (
    analysis_id, revision_number, status, supersedes_revision_id,
    canonical_inputs, schema_version, lock_version
  ) values (
    v_analysis_id, v_next, 'draft', v_current, v_inputs, v_schema, 1
  )
  returning id into v_new;

  -- Associations only. Documents and Storage objects are shared, never copied.
  insert into public.revision_source_documents (revision_id, source_document_id)
  select v_new, rsd.source_document_id
    from public.revision_source_documents rsd
   where rsd.revision_id = v_current;

  revision_id := v_new;
  created := true;
  return next;
end;
$function$
;

/* ----------------------------------------------------------- privileges */
-- Re-affirmed explicitly; CREATE OR REPLACE preserves the existing ACLs.
revoke all on function public.arc_acknowledge_ai_stale_sources(p_owner_user_id uuid, p_guest_token_hash text, p_revision_id uuid, p_guest_workspace_id uuid, p_expected_lock_version integer, p_expected_source_set_fingerprint text, p_actor_user_id uuid) from public, anon, authenticated;
grant execute on function public.arc_acknowledge_ai_stale_sources(p_owner_user_id uuid, p_guest_token_hash text, p_revision_id uuid, p_guest_workspace_id uuid, p_expected_lock_version integer, p_expected_source_set_fingerprint text, p_actor_user_id uuid) to service_role;
revoke all on function public.arc_affirm_ai_review_item(p_owner_user_id uuid, p_guest_token_hash text, p_revision_id uuid, p_guest_workspace_id uuid, p_expected_lock_version integer, p_review_item_id text, p_expected_review_fingerprint text, p_method text, p_actor_user_id uuid) from public, anon, authenticated;
grant execute on function public.arc_affirm_ai_review_item(p_owner_user_id uuid, p_guest_token_hash text, p_revision_id uuid, p_guest_workspace_id uuid, p_expected_lock_version integer, p_review_item_id text, p_expected_review_fingerprint text, p_method text, p_actor_user_id uuid) to service_role;
revoke all on function public.arc_apply_ai_run(p_run_id uuid, p_owner_user_id uuid, p_guest_token_hash text, p_expected_lock_version integer, p_canonical_inputs jsonb, p_schema_version text, p_ai_state jsonb, p_source_set_fingerprint text, p_structured_result jsonb, p_usage_metadata jsonb, p_review_issue_count integer) from public, anon, authenticated;
grant execute on function public.arc_apply_ai_run(p_run_id uuid, p_owner_user_id uuid, p_guest_token_hash text, p_expected_lock_version integer, p_canonical_inputs jsonb, p_schema_version text, p_ai_state jsonb, p_source_set_fingerprint text, p_structured_result jsonb, p_usage_metadata jsonb, p_review_issue_count integer) to service_role;
revoke all on function public.arc_attach_guest_source_document(p_guest_token_hash text, p_source_document_id uuid, p_expected_lock_version integer) from public, anon, authenticated;
grant execute on function public.arc_attach_guest_source_document(p_guest_token_hash text, p_source_document_id uuid, p_expected_lock_version integer) to service_role;
revoke all on function public.arc_attach_source_document(p_owner_user_id uuid, p_revision_id uuid, p_source_document_id uuid, p_expected_lock_version integer) from public, anon, authenticated;
grant execute on function public.arc_attach_source_document(p_owner_user_id uuid, p_revision_id uuid, p_source_document_id uuid, p_expected_lock_version integer) to service_role;
revoke all on function public.arc_commit_source_document_upload(p_intent_id uuid, p_owner_user_id uuid, p_guest_token_hash text, p_expected_lock_version integer) from public, anon, authenticated;
grant execute on function public.arc_commit_source_document_upload(p_intent_id uuid, p_owner_user_id uuid, p_guest_token_hash text, p_expected_lock_version integer) to service_role;
revoke all on function public.arc_discard_amendment_draft(p_owner_user_id uuid, p_revision_id uuid, p_expected_lock_version integer) from public, anon, authenticated;
grant execute on function public.arc_discard_amendment_draft(p_owner_user_id uuid, p_revision_id uuid, p_expected_lock_version integer) to service_role;
revoke all on function public.arc_finalize_revision(p_owner_user_id uuid, p_revision_id uuid, p_expected_lock_version integer, p_engine_outputs jsonb, p_reconciliation_snapshot jsonb, p_schema_version text, p_engine_version text) from public, anon, authenticated;
grant execute on function public.arc_finalize_revision(p_owner_user_id uuid, p_revision_id uuid, p_expected_lock_version integer, p_engine_outputs jsonb, p_reconciliation_snapshot jsonb, p_schema_version text, p_engine_version text) to service_role;
revoke all on function public.arc_migrate_guest_workspace_by_token(p_token_hash text, p_owner_user_id uuid, p_expected_lock_version integer, p_customer_name text, p_contract_title text, p_contract_number text) from public, anon, authenticated;
grant execute on function public.arc_migrate_guest_workspace_by_token(p_token_hash text, p_owner_user_id uuid, p_expected_lock_version integer, p_customer_name text, p_contract_title text, p_contract_number text) to service_role;
revoke all on function public.arc_migrate_guest_workspace_by_token_v2(p_token_hash text, p_owner_user_id uuid, p_expected_lock_version integer, p_existing_customer_id uuid, p_new_customer_name text, p_contract_title text, p_contract_number text) from public, anon, authenticated;
grant execute on function public.arc_migrate_guest_workspace_by_token_v2(p_token_hash text, p_owner_user_id uuid, p_expected_lock_version integer, p_existing_customer_id uuid, p_new_customer_name text, p_contract_title text, p_contract_number text) to service_role;
revoke all on function public.arc_migrate_guest_workspace_by_token_v3(p_token_hash text, p_owner_user_id uuid, p_expected_lock_version integer, p_existing_customer_id uuid, p_new_customer_name text, p_contract_title text, p_contract_number text) from public, anon, authenticated;
grant execute on function public.arc_migrate_guest_workspace_by_token_v3(p_token_hash text, p_owner_user_id uuid, p_expected_lock_version integer, p_existing_customer_id uuid, p_new_customer_name text, p_contract_title text, p_contract_number text) to service_role;
revoke all on function public.arc_remove_guest_source_document(p_guest_token_hash text, p_source_document_id uuid, p_expected_lock_version integer) from public, anon, authenticated;
grant execute on function public.arc_remove_guest_source_document(p_guest_token_hash text, p_source_document_id uuid, p_expected_lock_version integer) to service_role;
revoke all on function public.arc_remove_source_document(p_owner_user_id uuid, p_revision_id uuid, p_source_document_id uuid, p_expected_lock_version integer) from public, anon, authenticated;
grant execute on function public.arc_remove_source_document(p_owner_user_id uuid, p_revision_id uuid, p_source_document_id uuid, p_expected_lock_version integer) to service_role;
revoke all on function public.arc_reset_amendment_draft(p_owner_user_id uuid, p_revision_id uuid, p_expected_lock_version integer) from public, anon, authenticated;
grant execute on function public.arc_reset_amendment_draft(p_owner_user_id uuid, p_revision_id uuid, p_expected_lock_version integer) to service_role;
revoke all on function public.arc_resolve_ai_review_issue(p_owner_user_id uuid, p_guest_token_hash text, p_revision_id uuid, p_guest_workspace_id uuid, p_expected_lock_version integer, p_review_item_id text, p_expected_review_fingerprint text, p_reason text, p_note text, p_actor_user_id uuid) from public, anon, authenticated;
grant execute on function public.arc_resolve_ai_review_issue(p_owner_user_id uuid, p_guest_token_hash text, p_revision_id uuid, p_guest_workspace_id uuid, p_expected_lock_version integer, p_review_item_id text, p_expected_review_fingerprint text, p_reason text, p_note text, p_actor_user_id uuid) to service_role;
revoke all on function public.arc_restore_pre_ai_run(p_run_id uuid, p_owner_user_id uuid, p_guest_token_hash text, p_expected_lock_version integer) from public, anon, authenticated;
grant execute on function public.arc_restore_pre_ai_run(p_run_id uuid, p_owner_user_id uuid, p_guest_token_hash text, p_expected_lock_version integer) to service_role;
revoke all on function public.arc_save_draft_with_ai_reconciliation(p_owner_user_id uuid, p_guest_token_hash text, p_revision_id uuid, p_guest_workspace_id uuid, p_expected_lock_version integer, p_canonical_inputs jsonb, p_schema_version text, p_ai_state jsonb, p_review_events jsonb, p_actor_user_id uuid) from public, anon, authenticated;
grant execute on function public.arc_save_draft_with_ai_reconciliation(p_owner_user_id uuid, p_guest_token_hash text, p_revision_id uuid, p_guest_workspace_id uuid, p_expected_lock_version integer, p_canonical_inputs jsonb, p_schema_version text, p_ai_state jsonb, p_review_events jsonb, p_actor_user_id uuid) to service_role;
revoke all on function public.arc_stage_source_document_deletion(p_owner_user_id uuid, p_guest_token_hash text, p_source_document_id uuid, p_expected_lock_version integer) from public, anon, authenticated;
grant execute on function public.arc_stage_source_document_deletion(p_owner_user_id uuid, p_guest_token_hash text, p_source_document_id uuid, p_expected_lock_version integer) to service_role;
revoke all on function public.arc_start_amendment_revision(p_owner_user_id uuid, p_contract_id uuid, p_expected_source_revision_id uuid) from public, anon, authenticated;
grant execute on function public.arc_start_amendment_revision(p_owner_user_id uuid, p_contract_id uuid, p_expected_source_revision_id uuid) to service_role;