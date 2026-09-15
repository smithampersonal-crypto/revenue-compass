-- ARC Phase 9C final CI/hardening micro-patch. Additive: the Phase 9C
-- foundation and acceptance-patch migrations are left untouched.

/* ------------------- 1. re-home may change only the ownership target ----- */

create or replace function public.arc_protect_ai_run()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_terminal constant text[] := array['succeeded', 'preflight_failed', 'api_failed',
                                      'response_invalid', 'application_failed'];
  v_rehome boolean;
begin
  -- Deletion is a parent-lifecycle concern: an expired temporary workspace, a
  -- deleted contract or a deleted account must be able to take its AI rows
  -- with it. No browser role holds delete on this table.
  if tg_op = 'DELETE' then
    return old;
  end if;

  -- The single approved ownership transition: temporary workspace -> saved
  -- revision, one way, preserving every other provenance field including the
  -- quota scope that was actually consumed.
  v_rehome := old.revision_id is null and old.guest_workspace_id is not null
              and new.revision_id is not null and new.guest_workspace_id is null;

  if v_rehome then
    if new.id <> old.id
       or new.guest_token_hash is distinct from old.guest_token_hash
       or new.quota_scope <> old.quota_scope
       or new.stage <> old.stage
       or new.source_set_fingerprint <> old.source_set_fingerprint
       or new.pre_run_canonical_inputs is distinct from old.pre_run_canonical_inputs
       or new.pre_run_ai_state is distinct from old.pre_run_ai_state
       or new.model <> old.model
       or new.reasoning_effort <> old.reasoning_effort
       or new.prompt_version <> old.prompt_version
       or new.output_schema_version <> old.output_schema_version
       or new.guidance_registry_hash <> old.guidance_registry_hash
       or new.openai_started_at is distinct from old.openai_started_at
       or new.completed_at is distinct from old.completed_at
       or new.created_at <> old.created_at
       or new.result_metadata is distinct from old.result_metadata
       or new.usage_metadata is distinct from old.usage_metadata
       or new.input_tokens is distinct from old.input_tokens
       or new.source_count is distinct from old.source_count
       or new.page_count is distinct from old.page_count
       or new.failure_stage is distinct from old.failure_stage
       or new.failure_category is distinct from old.failure_category
       or new.failure_code is distinct from old.failure_code
       or new.safe_message is distinct from old.safe_message
       or new.review_issue_count is distinct from old.review_issue_count then
      raise exception 'ARC: re-homing an AI run may change only its owner target';
    end if;
    if new.owner_user_id is null then
      raise exception 'ARC: a re-homed AI run requires the saving account owner';
    end if;
    if old.owner_user_id is not null and new.owner_user_id <> old.owner_user_id then
      raise exception 'ARC: a re-homed AI run keeps its original account owner';
    end if;
    return new;
  end if;

  if old.stage = any (v_terminal) then
    raise exception 'ARC: a completed AI run is immutable';
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

revoke all on function public.arc_protect_ai_run() from public, anon, authenticated;

/* ------------------- 2. an optimistic lock version is always required ---- */

create or replace function public.arc_create_ai_run(
  p_run_id uuid,
  p_owner_user_id uuid,
  p_guest_token_hash text,
  p_revision_id uuid,
  p_guest_workspace_id uuid,
  p_expected_lock_version integer,
  p_quota_scope text,
  p_source_set_fingerprint text,
  p_pre_run_canonical_inputs jsonb,
  p_pre_run_ai_state jsonb,
  p_model text,
  p_reasoning_effort text,
  p_prompt_version text,
  p_output_schema_version text,
  p_guidance_registry_hash text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_active constant text[] := array['created', 'extracting', 'preflight_ready',
                                    'analyzing', 'validating', 'applying'];
  v_lock_version integer;
  v_existing uuid;
begin
  if p_quota_scope not in ('authenticated', 'guest') then
    raise exception 'ARC: unknown quota scope %', p_quota_scope;
  end if;
  if (p_revision_id is not null) = (p_guest_workspace_id is not null) then
    raise exception 'ARC: a run belongs to exactly one revision or one temporary workspace';
  end if;

  if p_revision_id is not null then
    if p_owner_user_id is null or p_quota_scope <> 'authenticated' then
      raise exception 'ARC: a saved revision run requires an authenticated owner';
    end if;
    select r.lock_version into v_lock_version
      from public.analysis_revisions r
      join public.analyses a on a.id = r.analysis_id
      join public.contracts ct on ct.id = a.contract_id
      join public.customers c on c.id = ct.customer_id
     where r.id = p_revision_id
       and r.status = 'draft'
       and c.owner_user_id = p_owner_user_id
     for update of r;
    if v_lock_version is null then
      raise exception 'ARC: no editable revision for this caller';
    end if;
  else
    if p_guest_token_hash is null then
      raise exception 'ARC: a temporary workspace run requires its credential';
    end if;
    select g.lock_version into v_lock_version
      from public.guest_workspaces g
     where g.id = p_guest_workspace_id
       and g.token_hash = p_guest_token_hash
       and g.status = 'active'
       and g.expires_at > now()
     for update;
    if v_lock_version is null then
      raise exception 'ARC: no active temporary workspace for this credential';
    end if;
    if p_quota_scope = 'authenticated' and p_owner_user_id is null then
      raise exception 'ARC: authenticated quota scope requires a signed-in caller';
    end if;
  end if;

  -- Fail closed: a trusted caller must always state the version it observed.
  if p_expected_lock_version is null then
    raise exception 'ARC: expected lock version is required';
  end if;
  if p_expected_lock_version <> v_lock_version then
    raise exception 'ARC: the workspace changed since this run was requested';
  end if;

  -- Idempotent: an owner scope already running keeps its existing run.
  select id into v_existing
    from public.ai_runs
   where stage = any (v_active)
     and ((p_revision_id is not null and revision_id = p_revision_id)
          or (p_guest_workspace_id is not null and guest_workspace_id = p_guest_workspace_id))
   limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  insert into public.ai_runs (
    id, revision_id, guest_workspace_id, owner_user_id, guest_token_hash, quota_scope,
    stage, source_set_fingerprint, pre_run_canonical_inputs, pre_run_ai_state,
    model, reasoning_effort, prompt_version, output_schema_version, guidance_registry_hash)
  values (
    p_run_id, p_revision_id, p_guest_workspace_id,
    case when p_quota_scope = 'guest' then null else p_owner_user_id end,
    p_guest_token_hash, p_quota_scope,
    'created', p_source_set_fingerprint, coalesce(p_pre_run_canonical_inputs, '{}'::jsonb),
    p_pre_run_ai_state, p_model, p_reasoning_effort, p_prompt_version,
    p_output_schema_version, p_guidance_registry_hash);

  return p_run_id;
end;
$$;

revoke all on function public.arc_create_ai_run(uuid, uuid, text, uuid, uuid, integer, text, text, jsonb, jsonb, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.arc_create_ai_run(uuid, uuid, text, uuid, uuid, integer, text, text, jsonb, jsonb, text, text, text, text, text)
  to service_role;