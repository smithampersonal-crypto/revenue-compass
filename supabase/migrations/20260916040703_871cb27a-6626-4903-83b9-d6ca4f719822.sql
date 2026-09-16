-- ARC Phase 9F acceptance patch — source_state is TEXT, and preflight
-- Guidance provenance is recorded with an integer card id.
-- Additive: the four routines are replaced in place; signatures, lock
-- order, ownership checks and service-role-only grants are unchanged.

create or replace function public.arc_mark_ai_sources_stale(
  p_revision_id uuid,
  p_guest_workspace_id uuid
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.ai_analysis_state s
     set source_state = 'stale'
   where ((p_revision_id is not null and s.revision_id = p_revision_id)
       or (p_guest_workspace_id is not null and s.guest_workspace_id = p_guest_workspace_id))
     and s.last_successful_run_id is not null
     and s.source_state is distinct from 'stale';
end;
$$;

create or replace function public.arc_record_ai_preflight(
  p_run_id uuid,
  p_source_set_fingerprint text,
  p_sources jsonb,
  p_guidance jsonb,
  p_source_count integer,
  p_page_count integer,
  p_input_tokens integer
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_run public.ai_runs;
  v_existing_sources integer;
  v_existing_guidance integer;
begin
  select * into v_run from public.ai_runs where id = p_run_id for update;
  if v_run.id is null then
    raise exception 'ARC: unknown AI run' using errcode = '42501';
  end if;

  -- The run's immutable source identity must still describe the analyzed set.
  if p_source_set_fingerprint is distinct from v_run.source_set_fingerprint then
    raise exception 'ARC: the selected source set changed since this run was requested'
      using errcode = '22023';
  end if;

  if v_run.stage = 'preflight_ready' then
    -- Response-loss retry: identical provenance succeeds, different provenance
    -- is rejected. Nothing is duplicated and the stage never advances twice.
    select count(*) into v_existing_sources from public.ai_run_sources where run_id = p_run_id;
    select count(*) into v_existing_guidance from public.ai_run_guidance where run_id = p_run_id;
    if v_existing_sources <> coalesce(jsonb_array_length(p_sources), 0)
       or v_existing_guidance <> coalesce(jsonb_array_length(p_guidance), 0)
       or v_run.source_count is distinct from p_source_count
       or v_run.page_count is distinct from p_page_count
       or v_run.input_tokens is distinct from p_input_tokens then
      raise exception 'ARC: this run already recorded different preflight provenance'
        using errcode = '22023';
    end if;
    return false;
  end if;

  if v_run.stage <> 'extracting' then
    raise exception 'ARC: preflight provenance can only be recorded while extracting'
      using errcode = '22023';
  end if;

  insert into public.ai_run_sources (run_id, source_document_id, position, sha256, byte_size, page_count)
  select p_run_id,
         (row ->> 'source_document_id')::uuid,
         (row ->> 'position')::integer,
         row ->> 'sha256',
         (row ->> 'byte_size')::bigint,
         (row ->> 'page_count')::integer
    from jsonb_array_elements(coalesce(p_sources, '[]'::jsonb)) as row
  on conflict (run_id, source_document_id) do nothing;

  insert into public.ai_run_guidance (run_id, card_id, inclusion_reason, matched_signals, registry_hash)
  select p_run_id,
         (row ->> 'card_id')::integer,
         row ->> 'inclusion_reason',
         coalesce(
           (select array_agg(value::text) from jsonb_array_elements_text(coalesce(row -> 'matched_signals', '[]'::jsonb)) as value),
           '{}'::text[]),
         row ->> 'registry_hash'
    from jsonb_array_elements(coalesce(p_guidance, '[]'::jsonb)) as row
  on conflict (run_id, card_id) do nothing;

  update public.ai_runs
     set source_count = p_source_count,
         page_count = p_page_count,
         input_tokens = p_input_tokens,
         stage = 'preflight_ready'
   where id = p_run_id;

  return true;
end;
$$;

create or replace function public.arc_apply_ai_run(
  p_run_id uuid,
  p_owner_user_id uuid,
  p_guest_token_hash text,
  p_expected_lock_version integer,
  p_canonical_inputs jsonb,
  p_schema_version text,
  p_ai_state jsonb,
  p_source_set_fingerprint text,
  p_structured_result jsonb,
  p_usage_metadata jsonb,
  p_review_issue_count integer
) returns table(lock_version integer, idempotent boolean)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_run public.ai_runs;
  v_status public.arc_revision_status;
  v_lock integer;
  v_state_id uuid;
  v_last uuid;
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
    -- without applying anything again or advancing the lock a second time.
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
      using errcode = '40001';
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
        using errcode = '40001';
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
        using errcode = '40001';
    end if;
  end if;

  update public.ai_analysis_state s
     set last_successful_run_id = p_run_id,
         source_set_fingerprint = v_run.source_set_fingerprint,
         source_state = coalesce(p_ai_state ->> 'sourceState', 'current'),
         field_provenance = coalesce(p_ai_state -> 'fieldProvenance', '{}'::jsonb),
         object_provenance = coalesce(p_ai_state -> 'objectProvenance', '{}'::jsonb),
         tombstones = coalesce(p_ai_state -> 'tombstones', '[]'::jsonb),
         review_items = coalesce(p_ai_state -> 'reviewItems', '[]'::jsonb),
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
$$;

create or replace function public.arc_restore_pre_ai_run(
  p_run_id uuid,
  p_owner_user_id uuid,
  p_guest_token_hash text,
  p_expected_lock_version integer
) returns table(lock_version integer, idempotent boolean)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_run public.ai_runs;
  v_status public.arc_revision_status;
  v_lock integer;
  v_schema text;
  v_last uuid;
  v_prior jsonb;
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

  -- Response-loss retry: the restore already committed.
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
    raise exception 'ARC: the analysis changed since it was loaded' using errcode = '40001';
  end if;

  if v_run.revision_id is not null then
    update public.analysis_revisions r
       set canonical_inputs = v_run.pre_run_canonical_inputs,
           lock_version = r.lock_version + 1
     where r.id = v_run.revision_id
       and r.status = 'draft'
       and r.lock_version = p_expected_lock_version;
  else
    update public.guest_workspaces g
       set draft_json = v_run.pre_run_canonical_inputs,
           lock_version = g.lock_version + 1
     where g.id = v_run.guest_workspace_id
       and g.lock_version = p_expected_lock_version;
  end if;
  if not found then
    raise exception 'ARC: the analysis changed since it was loaded' using errcode = '40001';
  end if;

  v_prior := v_run.pre_run_ai_state;
  if v_prior is null or v_prior = 'null'::jsonb then
    -- Exactly the recorded prior state: there was no AI sidecar at all.
    delete from public.ai_analysis_state s
     where (v_run.revision_id is not null and s.revision_id = v_run.revision_id)
        or (v_run.guest_workspace_id is not null and s.guest_workspace_id = v_run.guest_workspace_id);
  else
    update public.ai_analysis_state s
       set last_successful_run_id = nullif(v_prior ->> 'lastSuccessfulRunId', '')::uuid,
           source_set_fingerprint = nullif(v_prior ->> 'sourceSetFingerprint', ''),
           source_state = coalesce(v_prior ->> 'sourceState', 'none'),
           field_provenance = coalesce(v_prior -> 'fieldProvenance', '{}'::jsonb),
           object_provenance = coalesce(v_prior -> 'objectProvenance', '{}'::jsonb),
           tombstones = coalesce(v_prior -> 'tombstones', '[]'::jsonb),
           review_items = coalesce(v_prior -> 'reviewItems', '[]'::jsonb),
           lock_version = s.lock_version + 1
     where (v_run.revision_id is not null and s.revision_id = v_run.revision_id)
        or (v_run.guest_workspace_id is not null and s.guest_workspace_id = v_run.guest_workspace_id);
    if not found then
      insert into public.ai_analysis_state (
        revision_id, guest_workspace_id, last_successful_run_id, source_set_fingerprint,
        source_state, field_provenance, object_provenance, tombstones, review_items)
      values (
        v_run.revision_id, v_run.guest_workspace_id,
        nullif(v_prior ->> 'lastSuccessfulRunId', '')::uuid,
        nullif(v_prior ->> 'sourceSetFingerprint', ''),
        coalesce(v_prior ->> 'sourceState', 'none'),
        coalesce(v_prior -> 'fieldProvenance', '{}'::jsonb),
        coalesce(v_prior -> 'objectProvenance', '{}'::jsonb),
        coalesce(v_prior -> 'tombstones', '[]'::jsonb),
        coalesce(v_prior -> 'reviewItems', '[]'::jsonb));
    end if;
  end if;

  -- Run history, quota and the selected source documents are untouched.
  update public.ai_runs set restored_at = now() where id = p_run_id;

  lock_version := p_expected_lock_version + 1;
  idempotent := false;
  return next;
end;
$$;

revoke all on function public.arc_mark_ai_sources_stale(uuid, uuid) from public, anon, authenticated;
revoke all on function public.arc_record_ai_preflight(uuid, text, jsonb, jsonb, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.arc_apply_ai_run(uuid, uuid, text, integer, jsonb, text, jsonb, text, jsonb, jsonb, integer) from public, anon, authenticated;
revoke all on function public.arc_restore_pre_ai_run(uuid, uuid, text, integer) from public, anon, authenticated;

grant execute on function public.arc_mark_ai_sources_stale(uuid, uuid) to service_role;
grant execute on function public.arc_record_ai_preflight(uuid, text, jsonb, jsonb, integer, integer, integer) to service_role;
grant execute on function public.arc_apply_ai_run(uuid, uuid, text, integer, jsonb, text, jsonb, text, jsonb, jsonb, integer) to service_role;
grant execute on function public.arc_restore_pre_ai_run(uuid, uuid, text, integer) to service_role;