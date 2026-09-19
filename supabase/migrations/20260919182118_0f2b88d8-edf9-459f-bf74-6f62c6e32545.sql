-- ARC Post-R2 Database Hardening — non-retryable conflict SQLSTATE (part 1 of 4
-- of the reviewed staged migration 20260919060000_post_r2_conflict_sqlstate.sql).

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