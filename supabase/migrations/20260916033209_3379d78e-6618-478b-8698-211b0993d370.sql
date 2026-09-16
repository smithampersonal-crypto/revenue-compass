-- ARC Phase 9F — Task 11. Trusted atomic run/apply/restore boundary.
-- Additive only. No existing migration is edited.

alter table public.ai_runs add column if not exists restored_at timestamptz;
comment on column public.ai_runs.restored_at is
  'Set when this run was rolled back by arc_restore_pre_ai_run. The only mutable field on a terminal run.';

/* ---------------------------------------------- terminal-run immutability */

-- A terminal run stays immutable EXCEPT for the restore stamp, which is the
-- durable idempotency evidence for a response-loss restore retry.
create or replace function public.arc_protect_ai_run()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_terminal constant text[] := array['succeeded', 'preflight_failed', 'api_failed',
                                      'response_invalid', 'application_failed'];
  v_probe public.ai_runs;
begin
  if tg_op = 'DELETE' then
    if old.openai_started_at is not null or old.stage = any (v_terminal) then
      raise exception 'ARC: completed AI run provenance cannot be deleted';
    end if;
    return old;
  end if;

  if old.stage = any (v_terminal) then
    v_probe := new;
    v_probe.restored_at := old.restored_at;
    v_probe.updated_at := old.updated_at;
    if v_probe is distinct from old then
      raise exception 'ARC: a completed AI run is immutable';
    end if;
    return new;
  end if;

  if new.id <> old.id
     or new.revision_id is distinct from old.revision_id
     or new.guest_workspace_id is distinct from old.guest_workspace_id
     or new.owner_user_id is distinct from old.owner_user_id
     or new.guest_token_hash is distinct from old.guest_token_hash
     or new.quota_scope <> old.quota_scope
     or new.source_set_fingerprint <> old.source_set_fingerprint
     or new.pre_run_canonical_inputs is distinct from old.pre_run_canonical_inputs
     or new.pre_run_ai_state is distinct from old.pre_run_ai_state
     or new.model <> old.model
     or new.reasoning_effort <> old.reasoning_effort
     or new.prompt_version <> old.prompt_version
     or new.output_schema_version <> old.output_schema_version
     or new.guidance_registry_hash <> old.guidance_registry_hash
     or new.created_at <> old.created_at then
    raise exception 'ARC: AI run provenance is immutable';
  end if;

  if old.openai_started_at is not null
     and new.openai_started_at is distinct from old.openai_started_at then
    raise exception 'ARC: the OpenAI start stamp is immutable once set';
  end if;

  return new;
end;
$$;

/* ------------------------------------------------- stage transition claim */

-- The atomic execution claim. Exactly one caller can move a run out of a
-- given stage, so a double click can never dispatch two model calls.
create or replace function public.arc_advance_ai_run_stage(
  p_run_id uuid,
  p_from text,
  p_to text
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_order constant text[] := array['created', 'extracting', 'preflight_ready',
                                   'analyzing', 'validating', 'applying', 'succeeded'];
  v_from_pos integer;
  v_to_pos integer;
  v_stage text;
begin
  v_from_pos := array_position(v_order, p_from);
  v_to_pos := array_position(v_order, p_to);
  if v_from_pos is null or v_to_pos is null then
    raise exception 'ARC: unknown AI run stage transition % -> %', p_from, p_to
      using errcode = '22023';
  end if;
  if v_to_pos <> v_from_pos + 1 then
    raise exception 'ARC: AI run stages cannot be skipped or reversed (% -> %)', p_from, p_to
      using errcode = '22023';
  end if;

  select stage into v_stage from public.ai_runs where id = p_run_id for update;
  if v_stage is null then
    raise exception 'ARC: unknown AI run' using errcode = '42501';
  end if;
  -- A run already past this point (or terminal) is simply not claimed.
  if v_stage <> p_from then
    return false;
  end if;

  update public.ai_runs set stage = p_to where id = p_run_id;
  return true;
end;
$$;

/* ------------------------------------------------ preflight provenance --- */

-- One transaction records the exact source set, the exact Guidance cards, the
-- measured size and the counted tokens, and enters preflight_ready.
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
         row ->> 'card_id',
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

/* ------------------------------------------------------ atomic apply ----- */

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
         source_state = coalesce(p_ai_state -> 'sourceState', to_jsonb('current'::text)),
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
      coalesce(p_ai_state -> 'sourceState', to_jsonb('current'::text)),
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

/* ---------------------------------------------------- whole-run restore -- */

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
           source_state = coalesce(v_prior -> 'sourceState', to_jsonb('none'::text)),
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
        coalesce(v_prior -> 'sourceState', to_jsonb('none'::text)),
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

/* --------------------------------------------- review-state mutation ----- */

create or replace function public.arc_set_ai_review_state(
  p_owner_user_id uuid,
  p_guest_token_hash text,
  p_revision_id uuid,
  p_guest_workspace_id uuid,
  p_expected_lock_version integer,
  p_review_items jsonb
) returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_status public.arc_revision_status;
  v_lock integer;
begin
  if (p_revision_id is not null) = (p_guest_workspace_id is not null) then
    raise exception 'ARC: exactly one owner scope is required' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_review_items, 'null'::jsonb)) <> 'array' then
    raise exception 'ARC: review items must be an array' using errcode = '22023';
  end if;

  if p_revision_id is not null then
    select r.status, r.lock_version into v_status, v_lock
      from public.analysis_revisions r
      join public.analyses a on a.id = r.analysis_id
      join public.contracts ct on ct.id = a.contract_id
      join public.customers c on c.id = ct.customer_id
     where r.id = p_revision_id and c.owner_user_id = p_owner_user_id
     for update of r;
    if v_status is null then
      raise exception 'ARC: that analysis was not found for this caller' using errcode = '42501';
    end if;
    if v_status <> 'draft' then
      raise exception 'ARC: finalized review history cannot be changed' using errcode = '42501';
    end if;
  else
    select g.lock_version into v_lock
      from public.guest_workspaces g
     where g.id = p_guest_workspace_id
       and g.token_hash = p_guest_token_hash
       and g.status = 'active'
       and g.expires_at > now()
     for update;
    if v_lock is null then
      raise exception 'ARC: that temporary workspace is no longer available' using errcode = '42501';
    end if;
  end if;

  if v_lock <> p_expected_lock_version then
    raise exception 'ARC: the analysis changed since it was loaded' using errcode = '40001';
  end if;

  -- Review items only. Provenance, tombstones, source state and run history
  -- are all out of reach of this operation.
  update public.ai_analysis_state s
     set review_items = p_review_items,
         lock_version = s.lock_version + 1
   where (p_revision_id is not null and s.revision_id = p_revision_id)
      or (p_guest_workspace_id is not null and s.guest_workspace_id = p_guest_workspace_id);
  if not found then
    raise exception 'ARC: this analysis has no AI review state' using errcode = '42501';
  end if;

  if p_revision_id is not null then
    update public.analysis_revisions set lock_version = lock_version + 1 where id = p_revision_id;
  else
    update public.guest_workspaces set lock_version = lock_version + 1 where id = p_guest_workspace_id;
  end if;

  return p_expected_lock_version + 1;
end;
$$;

/* --------------------------------------------------------- affirmation --- */

create or replace function public.arc_affirm_ai_review_scope(
  p_owner_user_id uuid,
  p_guest_token_hash text,
  p_revision_id uuid,
  p_guest_workspace_id uuid,
  p_expected_lock_version integer,
  p_scope text
) returns table(lock_version integer, affirmed_count integer)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_scopes constant text[] := array['global', 'step_1', 'step_2', 'step_3', 'step_4', 'step_5',
                                    'additional_topics'];
  v_status public.arc_revision_status;
  v_lock integer;
  v_items jsonb;
  v_next jsonb := '[]'::jsonb;
  v_item jsonb;
  v_count integer := 0;
  v_method text;
  v_now text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
begin
  if p_scope is null or not (p_scope = any (v_scopes)) then
    raise exception 'ARC: unknown review scope %', p_scope using errcode = '22023';
  end if;
  if (p_revision_id is not null) = (p_guest_workspace_id is not null) then
    raise exception 'ARC: exactly one owner scope is required' using errcode = '22023';
  end if;
  v_method := case when p_scope = 'global' then 'global_all' else 'page_all' end;

  if p_revision_id is not null then
    select r.status, r.lock_version into v_status, v_lock
      from public.analysis_revisions r
      join public.analyses a on a.id = r.analysis_id
      join public.contracts ct on ct.id = a.contract_id
      join public.customers c on c.id = ct.customer_id
     where r.id = p_revision_id and c.owner_user_id = p_owner_user_id
     for update of r;
    if v_status is null then
      raise exception 'ARC: that analysis was not found for this caller' using errcode = '42501';
    end if;
    if v_status <> 'draft' then
      raise exception 'ARC: finalized review history cannot be changed' using errcode = '42501';
    end if;
  else
    select g.lock_version into v_lock
      from public.guest_workspaces g
     where g.id = p_guest_workspace_id
       and g.token_hash = p_guest_token_hash
       and g.status = 'active'
       and g.expires_at > now()
     for update;
    if v_lock is null then
      raise exception 'ARC: that temporary workspace is no longer available' using errcode = '42501';
    end if;
  end if;

  if v_lock <> p_expected_lock_version then
    raise exception 'ARC: the analysis changed since it was loaded' using errcode = '40001';
  end if;

  select s.review_items into v_items
    from public.ai_analysis_state s
   where (p_revision_id is not null and s.revision_id = p_revision_id)
      or (p_guest_workspace_id is not null and s.guest_workspace_id = p_guest_workspace_id)
   for update;
  if v_items is null then
    raise exception 'ARC: this analysis has no AI review state' using errcode = '42501';
  end if;

  for v_item in select value from jsonb_array_elements(v_items) as value loop
    -- Only a yellow affirmation item in scope is resolved. A red issue is
    -- never touched, and no accounting value changes.
    if (v_item ->> 'state') = 'yellow'
       and (p_scope = 'global' or (v_item ->> 'section') = p_scope) then
      v_item := v_item
        || jsonb_build_object('state', 'resolved', 'affirmedAt', v_now, 'affirmedMethod', v_method);
      v_count := v_count + 1;
    end if;
    v_next := v_next || jsonb_build_array(v_item);
  end loop;

  update public.ai_analysis_state s
     set review_items = v_next,
         lock_version = s.lock_version + 1
   where (p_revision_id is not null and s.revision_id = p_revision_id)
      or (p_guest_workspace_id is not null and s.guest_workspace_id = p_guest_workspace_id);

  if p_revision_id is not null then
    update public.analysis_revisions set lock_version = lock_version + 1 where id = p_revision_id;
  else
    update public.guest_workspaces set lock_version = lock_version + 1 where id = p_guest_workspace_id;
  end if;

  lock_version := p_expected_lock_version + 1;
  affirmed_count := v_count;
  return next;
end;
$$;

/* ------------------------------------------------------------- privileges */

revoke all on function public.arc_advance_ai_run_stage(uuid, text, text) from public, anon, authenticated;
revoke all on function public.arc_record_ai_preflight(uuid, text, jsonb, jsonb, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.arc_apply_ai_run(uuid, uuid, text, integer, jsonb, text, jsonb, text, jsonb, jsonb, integer) from public, anon, authenticated;
revoke all on function public.arc_restore_pre_ai_run(uuid, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.arc_set_ai_review_state(uuid, text, uuid, uuid, integer, jsonb) from public, anon, authenticated;
revoke all on function public.arc_affirm_ai_review_scope(uuid, text, uuid, uuid, integer, text) from public, anon, authenticated;

grant execute on function public.arc_advance_ai_run_stage(uuid, text, text) to service_role;
grant execute on function public.arc_record_ai_preflight(uuid, text, jsonb, jsonb, integer, integer, integer) to service_role;
grant execute on function public.arc_apply_ai_run(uuid, uuid, text, integer, jsonb, text, jsonb, text, jsonb, jsonb, integer) to service_role;
grant execute on function public.arc_restore_pre_ai_run(uuid, uuid, text, integer) to service_role;
grant execute on function public.arc_set_ai_review_state(uuid, text, uuid, uuid, integer, jsonb) to service_role;
grant execute on function public.arc_affirm_ai_review_scope(uuid, text, uuid, uuid, integer, text) to service_role;