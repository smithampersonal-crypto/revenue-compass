-- ARC Post-R2 Database Hardening — non-retryable conflict SQLSTATE.
--
-- Incident: a PostgREST backend treated ARC-authored SQLSTATE 40001 optimistic
-- lock / business-conflict exceptions as genuine PostgreSQL serialization
-- failures and retried them, producing hundreds of thousands of
-- "ARC: the analysis changed since it was loaded" errors and sustained high
-- database CPU. Those conflicts are permanent for the request that raised them:
-- the caller must reload, never retry.
--
-- This migration replaces ONLY function bodies. Every raise that ARC itself
-- authors for an optimistic-lock / business conflict now uses the explicit
-- non-retryable code PT409 (PostgREST maps PT4xx to HTTP 409). Genuine database
-- serialization failures still surface as real 40001 raised by PostgreSQL, and
-- bounded lock contention still surfaces as 55P03; neither is changed here.
--
-- Nothing else moves: signatures, return shapes, SECURITY DEFINER, search_path,
-- ownership validation, scope locking, actor derivation, lock ordering,
-- optimistic-lock semantics, canonical/sidecar writes, review-event append
-- semantics and privileges are all identical. No table, schema, RLS, grant,
-- trigger definition, index or data change is made. The frozen Phase 9G
-- migrations are untouched, and the approved staged autosave timeout hardening
-- (lock_timeout 3s / idle_in_transaction_session_timeout 15s) is retained
-- verbatim inside arc_save_draft_with_ai_reconciliation.
--
-- Routines replaced (20): every public routine that raised an ARC-authored
-- 40001, including the revision immutability trigger function, plus
-- arc_commit_source_document_upload whose handler now catches PT409 from the
-- routine it calls.

CREATE OR REPLACE FUNCTION public.arc_acknowledge_ai_stale_sources(p_owner_user_id uuid, p_guest_token_hash text, p_revision_id uuid, p_guest_workspace_id uuid, p_expected_lock_version integer, p_expected_source_set_fingerprint text, p_actor_user_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(lock_version integer, source_set_fingerprint text, already_acknowledged boolean, event_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_lock integer;
  v_current text;
  v_recorded text;
  v_event uuid;
  v_exists boolean;
  v_state text;
  v_run uuid;
  v_actor uuid;
begin
  v_lock := public.arc_lock_ai_review_scope(p_owner_user_id, p_guest_token_hash,
                                            p_revision_id, p_guest_workspace_id);
  v_actor := public.arc_ai_review_actor(p_owner_user_id, p_actor_user_id, p_revision_id);

  -- Authoritative and server-derived. The browser value is a precondition only.
  v_current := public.arc_ai_source_set_fingerprint(p_revision_id, p_guest_workspace_id);
  if p_expected_source_set_fingerprint is null
     or p_expected_source_set_fingerprint <> v_current then
    raise exception 'ARC: the selected source documents changed since they were displayed'
      using errcode = 'PT409';
  end if;

  select true, s.acknowledged_source_fingerprint, s.source_state, s.last_successful_run_id
    into v_exists, v_recorded, v_state, v_run
    from public.ai_analysis_state s
   where (p_revision_id is not null and s.revision_id = p_revision_id)
      or (p_guest_workspace_id is not null and s.guest_workspace_id = p_guest_workspace_id)
   for update;
  if v_exists is not true then
    raise exception 'ARC: this analysis has no AI analysis state' using errcode = '42501';
  end if;
  if v_run is null then
    raise exception 'ARC: there is no AI analysis to acknowledge' using errcode = '22023';
  end if;

  if v_recorded = v_current then
    select e.id into v_event from public.ai_review_events e
     where e.event_type = 'stale_sources_acknowledged'
       and e.source_set_fingerprint = v_current
       and coalesce(e.revision_id, e.guest_workspace_id)
           = coalesce(p_revision_id, p_guest_workspace_id)
     order by e.event_seq desc
     limit 1;
    lock_version := v_lock;
    source_set_fingerprint := v_current;
    already_acknowledged := true;
    event_id := v_event;
    return next;
    return;
  end if;

  if v_state is distinct from 'stale' then
    raise exception 'ARC: the selected source documents are not out of date'
      using errcode = '22023';
  end if;

  if v_lock <> p_expected_lock_version then
    raise exception 'ARC: the analysis changed since it was loaded' using errcode = 'PT409';
  end if;

  update public.ai_analysis_state s
     set acknowledged_source_fingerprint = v_current,
         source_acknowledged_at = now(),
         source_acknowledged_by = v_actor,
         lock_version = s.lock_version + 1
   where (p_revision_id is not null and s.revision_id = p_revision_id)
      or (p_guest_workspace_id is not null and s.guest_workspace_id = p_guest_workspace_id);

  insert into public.ai_review_events (
    revision_id, guest_workspace_id, ai_run_id, actor_kind, actor_user_id, event_type,
    source_set_fingerprint)
  values (
    p_revision_id, p_guest_workspace_id, v_run,
    case when v_actor is not null then 'authenticated' else 'guest' end,
    v_actor,
    'stale_sources_acknowledged', v_current)
  returning id into v_event;

  perform public.arc_bump_ai_review_scope(p_revision_id, p_guest_workspace_id);

  lock_version := p_expected_lock_version + 1;
  source_set_fingerprint := v_current;
  already_acknowledged := false;
  event_id := v_event;
  return next;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.arc_affirm_ai_review_item(p_owner_user_id uuid, p_guest_token_hash text, p_revision_id uuid, p_guest_workspace_id uuid, p_expected_lock_version integer, p_review_item_id text, p_expected_review_fingerprint text, p_method text DEFAULT 'individual'::text, p_actor_user_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(lock_version integer, already_resolved boolean, event_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_lock integer;
  v_items jsonb;
  v_item jsonb;
  v_next jsonb := '[]'::jsonb;
  v_entry jsonb;
  v_now text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  v_event uuid;
  v_run uuid;
  v_actor uuid;
begin
  if p_method is null or p_method not in ('individual', 'page_all', 'global_all') then
    raise exception 'ARC: unknown affirmation method' using errcode = '22023';
  end if;
  v_lock := public.arc_lock_ai_review_scope(p_owner_user_id, p_guest_token_hash,
                                            p_revision_id, p_guest_workspace_id);
  v_actor := public.arc_ai_review_actor(p_owner_user_id, p_actor_user_id, p_revision_id);

  select s.review_items, s.last_successful_run_id into v_items, v_run
    from public.ai_analysis_state s
   where (p_revision_id is not null and s.revision_id = p_revision_id)
      or (p_guest_workspace_id is not null and s.guest_workspace_id = p_guest_workspace_id)
   for update;
  if v_items is null then
    raise exception 'ARC: this analysis has no AI review state' using errcode = '42501';
  end if;

  select value into v_item from jsonb_array_elements(v_items) value
   where value ->> 'id' = p_review_item_id;
  if v_item is null then
    raise exception 'ARC: that review item is not part of this analysis' using errcode = '22023';
  end if;
  if (v_item ->> 'reviewFingerprint') is distinct from p_expected_review_fingerprint then
    raise exception 'ARC: this conclusion changed since it was displayed' using errcode = 'PT409';
  end if;
  if (v_item ->> 'severity') <> 'yellow' then
    raise exception 'ARC: only an affirmation item can be affirmed' using errcode = '22023';
  end if;

  -- Idempotent retry: the identical affirmation is already recorded, so the
  -- second click changes nothing rather than failing a stale lock check. The
  -- same conclusion may have been reviewed in an earlier cycle too, so the
  -- most recent matching event is the one this retry refers to.
  if (v_item ->> 'state') = 'resolved' then
    if (v_item -> 'resolution' ->> 'kind') = 'affirmed'
       and (v_item -> 'resolution' ->> 'reviewFingerprint') = p_expected_review_fingerprint then
      select e.id into v_event from public.ai_review_events e
       where e.event_type = 'yellow_affirmed'
         and e.review_item_id = p_review_item_id
         and e.review_fingerprint = p_expected_review_fingerprint
         and coalesce(e.revision_id, e.guest_workspace_id)
             = coalesce(p_revision_id, p_guest_workspace_id)
       order by e.event_seq desc
       limit 1;
      lock_version := v_lock;
      already_resolved := true;
      event_id := v_event;
      return next;
      return;
    end if;
    raise exception 'ARC: that review item was already resolved another way' using errcode = '22023';
  end if;
  if (v_item ->> 'state') <> 'yellow' then
    raise exception 'ARC: that review item is not open for affirmation' using errcode = '22023';
  end if;
  if v_lock <> p_expected_lock_version then
    raise exception 'ARC: the analysis changed since it was loaded' using errcode = 'PT409';
  end if;

  for v_entry in select value from jsonb_array_elements(v_items) value loop
    if (v_entry ->> 'id') = p_review_item_id then
      v_entry := v_entry || jsonb_build_object(
        'state', 'resolved',
        'resolution', jsonb_build_object(
          'kind', 'affirmed', 'at', v_now, 'method', p_method,
          'reviewFingerprint', p_expected_review_fingerprint),
        'affirmedAt', v_now,
        'affirmedMethod', p_method);
    end if;
    v_next := v_next || jsonb_build_array(v_entry);
  end loop;

  update public.ai_analysis_state s
     set review_items = v_next,
         lock_version = s.lock_version + 1
   where (p_revision_id is not null and s.revision_id = p_revision_id)
      or (p_guest_workspace_id is not null and s.guest_workspace_id = p_guest_workspace_id);

  insert into public.ai_review_events (
    revision_id, guest_workspace_id, ai_run_id, actor_kind, actor_user_id, event_type,
    review_item_id, review_target_key, review_section, review_severity, review_fingerprint)
  values (
    p_revision_id, p_guest_workspace_id, v_run,
    case when v_actor is not null then 'authenticated' else 'guest' end,
    v_actor,
    'yellow_affirmed', p_review_item_id, v_item ->> 'targetKey', v_item ->> 'section',
    'yellow', p_expected_review_fingerprint)
  returning id into v_event;

  perform public.arc_bump_ai_review_scope(p_revision_id, p_guest_workspace_id);

  lock_version := p_expected_lock_version + 1;
  already_resolved := false;
  event_id := v_event;
  return next;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.arc_apply_ai_run(p_run_id uuid, p_owner_user_id uuid, p_guest_token_hash text, p_expected_lock_version integer, p_canonical_inputs jsonb, p_schema_version text, p_ai_state jsonb, p_source_set_fingerprint text, p_structured_result jsonb, p_usage_metadata jsonb, p_review_issue_count integer)
 RETURNS TABLE(lock_version integer, idempotent boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_run public.ai_runs;
  v_status public.arc_revision_status;
  v_lock integer;
  v_state_id uuid;
  v_last uuid;
  v_prior jsonb;
begin
  if p_run_id is null or p_expected_lock_version is null or p_canonical_inputs is null
     or p_ai_state is null or coalesce(trim(p_schema_version), '') = '' then
    raise exception 'ARC: an apply requires a run, a lock version and canonical state'
      using errcode = '22023';
  end if;

  -- Read the run WITHOUT locking, only to discover its owner target, then take
  -- the accepted lock order: owner row -> run -> AI state.
  select * into v_run from public.ai_runs where id = p_run_id;
  if v_run.id is null then
    raise exception 'ARC: unknown AI run' using errcode = '42501';
  end if;

  if v_run.revision_id is not null then
    select r.status, r.lock_version into v_status, v_lock
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
      raise exception 'ARC: only an unfinished draft can receive an AI analysis'
        using errcode = '42501';
    end if;
  else
    select g.lock_version into v_lock
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

  -- Revalidate the run now that the owner row is held.
  select * into v_run from public.ai_runs where id = p_run_id for update;

  if v_run.stage = 'succeeded' then
    select s.last_successful_run_id, s.id into v_last, v_state_id
      from public.ai_analysis_state s
     where (v_run.revision_id is not null and s.revision_id = v_run.revision_id)
        or (v_run.guest_workspace_id is not null and s.guest_workspace_id = v_run.guest_workspace_id);
    -- Response-loss retry of a committed apply: report the committed outcome
    -- without applying anything again, advancing the lock a second time, or
    -- appending a second set of reopen events.
    if v_last = p_run_id then
      lock_version := v_lock;
      idempotent := true;
      return next;
      return;
    end if;
    raise exception 'ARC: that AI run was already completed' using errcode = '42501';
  end if;

  if v_run.stage <> 'applying' then
    raise exception 'ARC: only a run in the applying stage can be applied' using errcode = '22023';
  end if;
  if v_lock <> p_expected_lock_version then
    raise exception 'ARC: the analysis changed while the AI result was being applied'
      using errcode = 'PT409';
  end if;
  if p_source_set_fingerprint is distinct from v_run.source_set_fingerprint then
    raise exception 'ARC: the selected source set no longer matches this run'
      using errcode = '22023';
  end if;

  if v_run.revision_id is not null then
    update public.analysis_revisions r
       set canonical_inputs = p_canonical_inputs,
           schema_version = p_schema_version,
           lock_version = r.lock_version + 1
     where r.id = v_run.revision_id
       and r.status = 'draft'
       and r.lock_version = p_expected_lock_version;
    if not found then
      raise exception 'ARC: the analysis changed while the AI result was being applied'
        using errcode = 'PT409';
    end if;
  else
    update public.guest_workspaces g
       set draft_json = p_canonical_inputs,
           schema_version = p_schema_version,
           lock_version = g.lock_version + 1
     where g.id = v_run.guest_workspace_id
       and g.status = 'active'
       and g.lock_version = p_expected_lock_version;
    if not found then
      raise exception 'ARC: the analysis changed while the AI result was being applied'
        using errcode = 'PT409';
    end if;
  end if;

  -- The review state that the new analysis is about to replace.
  select s.review_items into v_prior
    from public.ai_analysis_state s
   where (v_run.revision_id is not null and s.revision_id = v_run.revision_id)
      or (v_run.guest_workspace_id is not null and s.guest_workspace_id = v_run.guest_workspace_id);

  update public.ai_analysis_state s
     set last_successful_run_id = p_run_id,
         source_set_fingerprint = v_run.source_set_fingerprint,
         source_state = coalesce(p_ai_state ->> 'sourceState', 'current'),
         field_provenance = coalesce(p_ai_state -> 'fieldProvenance', '{}'::jsonb),
         object_provenance = coalesce(p_ai_state -> 'objectProvenance', '{}'::jsonb),
         tombstones = coalesce(p_ai_state -> 'tombstones', '[]'::jsonb),
         review_items = coalesce(p_ai_state -> 'reviewItems', '[]'::jsonb),
         acknowledged_source_fingerprint = null,
         source_acknowledged_at = null,
         source_acknowledged_by = null,
         lock_version = s.lock_version + 1
   where (v_run.revision_id is not null and s.revision_id = v_run.revision_id)
      or (v_run.guest_workspace_id is not null and s.guest_workspace_id = v_run.guest_workspace_id);

  if not found then
    insert into public.ai_analysis_state (
      revision_id, guest_workspace_id, last_successful_run_id, source_set_fingerprint,
      source_state, field_provenance, object_provenance, tombstones, review_items)
    values (
      v_run.revision_id, v_run.guest_workspace_id, p_run_id, v_run.source_set_fingerprint,
      coalesce(p_ai_state ->> 'sourceState', 'current'),
      coalesce(p_ai_state -> 'fieldProvenance', '{}'::jsonb),
      coalesce(p_ai_state -> 'objectProvenance', '{}'::jsonb),
      coalesce(p_ai_state -> 'tombstones', '[]'::jsonb),
      coalesce(p_ai_state -> 'reviewItems', '[]'::jsonb));
  end if;

  -- Reconciliation reopened a conclusion the accountant had already settled.
  insert into public.ai_review_events (
    revision_id, guest_workspace_id, ai_run_id, actor_kind, actor_user_id, event_type,
    review_item_id, review_target_key, review_section, review_severity, review_fingerprint)
  select v_run.revision_id, v_run.guest_workspace_id, p_run_id, 'system', null,
         'review_item_reopened',
         n.value ->> 'id', n.value ->> 'targetKey', n.value ->> 'section',
         coalesce(n.value ->> 'severity', n.value ->> 'state'),
         n.value ->> 'reviewFingerprint'
    from jsonb_array_elements(coalesce(p_ai_state -> 'reviewItems', '[]'::jsonb)) n
   where (n.value ->> 'state') in ('yellow', 'red')
     and exists (
       select 1 from jsonb_array_elements(coalesce(v_prior, '[]'::jsonb)) o
        where (o.value ->> 'id') = (n.value ->> 'id')
          and (o.value ->> 'state') = 'resolved');

  update public.ai_runs
     set stage = 'succeeded',
         completed_at = now(),
         result_metadata = p_structured_result,
         usage_metadata = p_usage_metadata,
         review_issue_count = greatest(coalesce(p_review_issue_count, 0), 0)
   where id = p_run_id;

  lock_version := p_expected_lock_version + 1;
  idempotent := false;
  return next;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.arc_attach_guest_source_document(p_guest_token_hash text, p_source_document_id uuid, p_expected_lock_version integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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

  perform public.arc_guard_ai_source_freeze(null, v_guest.id);

  if v_guest.lock_version is distinct from p_expected_lock_version then
    raise exception 'the temporary workspace changed since it was loaded' using errcode = 'PT409';
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

  perform public.arc_mark_ai_sources_stale(null, v_guest.id);
  update public.guest_workspaces set lock_version = lock_version + 1 where id = v_guest.id;
  return v_guest.lock_version + 1;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.arc_attach_source_document(p_owner_user_id uuid, p_revision_id uuid, p_source_document_id uuid, p_expected_lock_version integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_status public.arc_revision_status;
  v_lock integer;
  v_inserted uuid;
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
  -- The selected set is frozen while a model result can still be applied.
  perform public.arc_guard_ai_source_freeze(p_revision_id, null);
  if v_lock is distinct from p_expected_lock_version then
    raise exception 'the draft changed since it was loaded' using errcode = 'PT409';
  end if;

  insert into public.revision_source_documents (revision_id, source_document_id)
  values (p_revision_id, p_source_document_id)
  on conflict do nothing
  returning source_document_id into v_inserted;

  if v_inserted is null then
    return v_lock;
  end if;

  perform public.arc_mark_ai_sources_stale(p_revision_id, null);
  update public.analysis_revisions set lock_version = lock_version + 1 where id = p_revision_id;
  return v_lock + 1;
end;
$function$
;

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

CREATE OR REPLACE FUNCTION public.arc_migrate_guest_workspace_by_token_v3(p_token_hash text, p_owner_user_id uuid, p_expected_lock_version integer, p_existing_customer_id uuid, p_new_customer_name text, p_contract_title text, p_contract_number text)
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
  -- Nothing is moved twice and no lock advances again.
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
  from public.arc_migrate_guest_workspace_v3(
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

CREATE OR REPLACE FUNCTION public.arc_protect_revision_immutability()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_parent_analysis uuid;
begin
  -- ---------------- INSERT ----------------
  if tg_op = 'INSERT' then
    if new.status <> 'draft'
       or new.engine_outputs is not null
       or new.reconciliation_snapshot is not null
       or new.engine_version is not null
       or new.finalized_at is not null
       or new.lock_version <> 1 then
      raise exception
        'a new analysis revision must be created as an empty draft (lock version 1)'
        using errcode = '42501';
    end if;

    if new.supersedes_revision_id is not null then
      select analysis_id into v_parent_analysis
        from public.analysis_revisions where id = new.supersedes_revision_id;
      if v_parent_analysis is distinct from new.analysis_id then
        raise exception 'supersedes_revision_id must belong to the same analysis'
          using errcode = '23514';
      end if;
    end if;

    return new;
  end if;

  -- ---------------- UPDATE ----------------
  if tg_op = 'UPDATE' then
    -- identity / lineage columns are frozen for every transition
    if new.id <> old.id
       or new.analysis_id <> old.analysis_id
       or new.revision_number <> old.revision_number
       or new.created_at <> old.created_at then
      raise exception 'analysis revision identity columns are immutable'
        using errcode = '42501';
    end if;

    -- draft -> draft: editable payload + concurrency metadata only
    if old.status = 'draft' and new.status = 'draft' then
      if new.engine_outputs is not null
         or new.reconciliation_snapshot is not null
         or new.engine_version is not null
         or new.finalized_at is not null then
        raise exception 'draft revisions cannot carry finalized outputs'
          using errcode = '42501';
      end if;
      if new.supersedes_revision_id is not distinct from old.supersedes_revision_id then
        new.updated_at := now();
        return new;
      end if;
      raise exception 'supersedes_revision_id cannot be changed on a draft'
        using errcode = '42501';
    end if;

    -- draft -> finalized: only via a complete, trusted snapshot
    if old.status = 'draft' and new.status = 'finalized' then
      if new.engine_outputs is null
         or new.reconciliation_snapshot is null
         or coalesce(trim(new.engine_version), '') = ''
         or coalesce(trim(new.schema_version), '') = ''
         or new.finalized_at is null then
        raise exception
          'finalization requires engine outputs, reconciliation snapshot, versions, and a finalization timestamp'
          using errcode = '22023';
      end if;
      if new.canonical_inputs is distinct from old.canonical_inputs then
        raise exception 'canonical inputs cannot change during finalization'
          using errcode = '42501';
      end if;
      if new.lock_version <> old.lock_version + 1 then
        raise exception 'finalization must advance the lock version exactly once'
          using errcode = 'PT409';
      end if;
      if new.supersedes_revision_id is not null then
        if new.supersedes_revision_id = new.id then
          raise exception 'a revision cannot supersede itself' using errcode = '23514';
        end if;
        select analysis_id into v_parent_analysis
          from public.analysis_revisions where id = new.supersedes_revision_id;
        if v_parent_analysis is distinct from new.analysis_id then
          raise exception 'supersedes_revision_id must belong to the same analysis'
            using errcode = '23514';
        end if;
      end if;
      new.updated_at := now();
      return new;
    end if;

    -- finalized -> superseded: status only, snapshot byte-identical
    if old.status = 'finalized' and new.status = 'superseded'
       and new.canonical_inputs is not distinct from old.canonical_inputs
       and new.engine_outputs is not distinct from old.engine_outputs
       and new.reconciliation_snapshot is not distinct from old.reconciliation_snapshot
       and new.schema_version is not distinct from old.schema_version
       and new.engine_version is not distinct from old.engine_version
       and new.supersedes_revision_id is not distinct from old.supersedes_revision_id
       and new.finalized_at is not distinct from old.finalized_at
       and new.lock_version = old.lock_version
    then
      new.updated_at := now();
      return new;
    end if;

    raise exception
      'analysis revision % cannot transition from % to % in this way',
      old.id, old.status, new.status
      using errcode = '42501';
  end if;

  -- ---------------- DELETE ----------------
  if old.status in ('finalized', 'superseded') then
    if exists (
      select 1
      from public.analyses a
      join public.contracts c on c.id = a.contract_id
      join public.customers cu on cu.id = c.customer_id
      join auth.users u on u.id = cu.owner_user_id
      where a.id = old.analysis_id
    ) then
      raise exception
        'analysis revision % is % and cannot be deleted', old.id, old.status
        using errcode = '42501';
    end if;
  end if;

  return old;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.arc_remove_guest_source_document(p_guest_token_hash text, p_source_document_id uuid, p_expected_lock_version integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
    raise exception 'the temporary workspace changed since it was loaded' using errcode = 'PT409';
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
$function$
;

CREATE OR REPLACE FUNCTION public.arc_remove_source_document(p_owner_user_id uuid, p_revision_id uuid, p_source_document_id uuid, p_expected_lock_version integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_status public.arc_revision_status;
  v_lock integer;
  v_removed integer;
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
  perform public.arc_guard_ai_source_freeze(p_revision_id, null);
  if v_lock is distinct from p_expected_lock_version then
    raise exception 'the draft changed since it was loaded' using errcode = 'PT409';
  end if;

  delete from public.revision_source_documents
   where revision_id = p_revision_id and source_document_id = p_source_document_id;
  get diagnostics v_removed = row_count;

  if v_removed = 0 then
    return v_lock;
  end if;

  perform public.arc_mark_ai_sources_stale(p_revision_id, null);
  update public.analysis_revisions set lock_version = lock_version + 1 where id = p_revision_id;
  return v_lock + 1;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.arc_reset_amendment_draft(p_owner_user_id uuid, p_revision_id uuid, p_expected_lock_version integer)
 RETURNS TABLE(lock_version integer, schema_version text, source_revision_id uuid)
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
    raise exception 'the analysis has moved on since it was loaded' using errcode = 'PT409';
  end if;
  -- Phase 9F: a model result that can still be applied freezes the source set.
  perform public.arc_guard_ai_source_freeze(p_revision_id, null);
  -- Rejected before either the inputs or the source set is touched.
  if v_lock <> p_expected_lock_version then
    raise exception 'the draft changed since it was loaded' using errcode = 'PT409';
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
    raise exception 'the draft changed since it was loaded' using errcode = 'PT409';
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
$function$
;

CREATE OR REPLACE FUNCTION public.arc_resolve_ai_review_issue(p_owner_user_id uuid, p_guest_token_hash text, p_revision_id uuid, p_guest_workspace_id uuid, p_expected_lock_version integer, p_review_item_id text, p_expected_review_fingerprint text, p_reason text, p_note text, p_actor_user_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(lock_version integer, already_resolved boolean, event_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_lock integer;
  v_items jsonb;
  v_item jsonb;
  v_next jsonb := '[]'::jsonb;
  v_entry jsonb;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_now text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  v_event uuid;
  v_run uuid;
  v_actor uuid;
begin
  if p_reason is null or p_reason not in ('reviewed_current_treatment',
                                          'outside_source_information', 'not_applicable') then
    raise exception 'ARC: unknown resolution reason' using errcode = '22023';
  end if;
  if v_note is not null and length(v_note) > 2000 then
    raise exception 'ARC: that note is too long' using errcode = '22023';
  end if;

  v_lock := public.arc_lock_ai_review_scope(p_owner_user_id, p_guest_token_hash,
                                            p_revision_id, p_guest_workspace_id);
  v_actor := public.arc_ai_review_actor(p_owner_user_id, p_actor_user_id, p_revision_id);

  select s.review_items, s.last_successful_run_id into v_items, v_run
    from public.ai_analysis_state s
   where (p_revision_id is not null and s.revision_id = p_revision_id)
      or (p_guest_workspace_id is not null and s.guest_workspace_id = p_guest_workspace_id)
   for update;
  if v_items is null then
    raise exception 'ARC: this analysis has no AI review state' using errcode = '42501';
  end if;

  select value into v_item from jsonb_array_elements(v_items) value
   where value ->> 'id' = p_review_item_id;
  if v_item is null then
    raise exception 'ARC: that review item is not part of this analysis' using errcode = '22023';
  end if;
  if (v_item ->> 'reviewFingerprint') is distinct from p_expected_review_fingerprint then
    raise exception 'ARC: this conclusion changed since it was displayed' using errcode = 'PT409';
  end if;
  if (v_item ->> 'severity') <> 'red' then
    raise exception 'ARC: only a red review issue can be resolved this way' using errcode = '22023';
  end if;
  -- A deterministic validation or calculation error is ARC's own conclusion.
  -- It is never an AI review item and can never be dismissed by a person.
  if coalesce((v_item ->> 'deterministic')::boolean, false) then
    raise exception 'ARC: a calculation error must be corrected, not dismissed'
      using errcode = '22023';
  end if;

  if (v_item ->> 'state') = 'resolved' then
    if (v_item -> 'resolution' ->> 'kind') = 'manual_red'
       and (v_item -> 'resolution' ->> 'reviewFingerprint') = p_expected_review_fingerprint
       and (v_item -> 'resolution' ->> 'reason') = p_reason
       and (v_item -> 'resolution' ->> 'note') is not distinct from v_note then
      select e.id into v_event from public.ai_review_events e
       where e.event_type = 'red_manually_resolved'
         and e.review_item_id = p_review_item_id
         and e.review_fingerprint = p_expected_review_fingerprint
         and coalesce(e.revision_id, e.guest_workspace_id)
             = coalesce(p_revision_id, p_guest_workspace_id)
       order by e.event_seq desc
       limit 1;
      lock_version := v_lock;
      already_resolved := true;
      event_id := v_event;
      return next;
      return;
    end if;
    raise exception 'ARC: that review item was already resolved another way' using errcode = '22023';
  end if;
  if (v_item ->> 'state') <> 'red' then
    raise exception 'ARC: that review item is not open' using errcode = '22023';
  end if;
  if v_lock <> p_expected_lock_version then
    raise exception 'ARC: the analysis changed since it was loaded' using errcode = 'PT409';
  end if;

  for v_entry in select value from jsonb_array_elements(v_items) value loop
    if (v_entry ->> 'id') = p_review_item_id then
      v_entry := v_entry || jsonb_build_object(
        'state', 'resolved',
        'resolution', jsonb_build_object(
          'kind', 'manual_red', 'at', v_now, 'reason', p_reason,
          'note', to_jsonb(v_note), 'reviewFingerprint', p_expected_review_fingerprint));
    end if;
    v_next := v_next || jsonb_build_array(v_entry);
  end loop;

  update public.ai_analysis_state s
     set review_items = v_next,
         lock_version = s.lock_version + 1
   where (p_revision_id is not null and s.revision_id = p_revision_id)
      or (p_guest_workspace_id is not null and s.guest_workspace_id = p_guest_workspace_id);

  insert into public.ai_review_events (
    revision_id, guest_workspace_id, ai_run_id, actor_kind, actor_user_id, event_type,
    review_item_id, review_target_key, review_section, review_severity, review_fingerprint,
    manual_red_reason, note)
  values (
    p_revision_id, p_guest_workspace_id, v_run,
    case when v_actor is not null then 'authenticated' else 'guest' end,
    v_actor,
    'red_manually_resolved', p_review_item_id, v_item ->> 'targetKey', v_item ->> 'section',
    'red', p_expected_review_fingerprint, p_reason, v_note)
  returning id into v_event;

  perform public.arc_bump_ai_review_scope(p_revision_id, p_guest_workspace_id);

  lock_version := p_expected_lock_version + 1;
  already_resolved := false;
  event_id := v_event;
  return next;
end;
$function$
;

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
