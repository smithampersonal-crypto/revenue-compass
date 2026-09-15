-- ARC Phase 9C acceptance patch. Additive: the Phase 9C foundation migration
-- is left untouched.

/* ------------------------------------------------ 1. lifecycle constraints */

-- A revision-backed run may carry guest quota provenance once it has been
-- re-homed from a temporary workspace. New revision runs still require
-- authenticated quota; that is enforced by arc_create_ai_run, not the schema.
alter table public.ai_runs drop constraint if exists ai_runs_revision_is_authenticated;

alter table public.ai_runs drop constraint if exists ai_runs_quota_scope_identity;
alter table public.ai_runs add constraint ai_runs_quota_scope_identity check (
  (quota_scope = 'authenticated' and owner_user_id is not null)
  or (quota_scope = 'guest'
      and guest_token_hash is not null
      -- While still owned by the temporary workspace, no account owner exists.
      and (guest_workspace_id is null or owner_user_id is null)));

/* --------------------------------------------- 2. run source durability */

-- Historical provenance must outlive the live document row.
alter table public.ai_run_sources
  drop constraint if exists ai_run_sources_source_document_id_fkey;

comment on column public.ai_run_sources.source_document_id is
  'Historical document identity as used by the run. Deliberately not a foreign key: removing the live source document must not erase run provenance.';

/* ------------------------------------------------ 3. guidance card typing */

alter table public.ai_run_guidance
  alter column card_id type integer using card_id::integer;
alter table public.ai_run_guidance
  add constraint ai_run_guidance_card_id_positive check (card_id > 0);

/* -------------------------------------------- 4. AI state source freshness */

alter table public.ai_analysis_state alter column source_state drop default;
alter table public.ai_analysis_state
  alter column source_state type text
  using case
    when jsonb_typeof(source_state) = 'string' and (source_state #>> '{}') in ('none', 'current', 'stale')
      then source_state #>> '{}'
    else 'none'
  end;
alter table public.ai_analysis_state alter column source_state set default 'none';
alter table public.ai_analysis_state alter column source_state set not null;
alter table public.ai_analysis_state
  add constraint ai_analysis_state_source_state_known
  check (source_state in ('none', 'current', 'stale'));

/* ------------------------------------------- 5. protection trigger rework */

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
       or new.input_tokens is distinct from old.input_tokens then
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

/* --------------------------------------- 6. reservation stage gate */

create or replace function public.arc_reserve_ai_allowance(
  p_run_id uuid,
  p_owner_user_id uuid,
  p_guest_token_hash text,
  p_utc_month date,
  p_user_monthly_limit integer,
  p_guest_limit integer
)
returns table (reserved boolean, already_reserved boolean, remaining_allowance integer)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_run public.ai_runs;
  v_month date := date_trunc('month', coalesce(p_utc_month, (now() at time zone 'utc')::date))::date;
  v_consumed integer;
begin
  select * into v_run from public.ai_runs where id = p_run_id for update;
  if v_run.id is null then
    raise exception 'ARC: unknown AI run';
  end if;

  if v_run.quota_scope = 'authenticated' then
    if p_owner_user_id is null or p_owner_user_id <> v_run.owner_user_id then
      return query select false, false, 0;
      return;
    end if;
  else
    if p_guest_token_hash is null or p_guest_token_hash is distinct from v_run.guest_token_hash then
      return query select false, false, 0;
      return;
    end if;
  end if;

  -- Response-loss safety: an already-reserved run never consumes twice.
  if v_run.openai_started_at is not null then
    if v_run.quota_scope = 'authenticated' then
      select coalesce(u.runs_consumed, 0) into v_consumed
        from public.ai_monthly_usage u
       where u.user_id = v_run.owner_user_id and u.usage_month = v_month;
      return query select true, true,
                          greatest(p_user_monthly_limit - coalesce(v_consumed, 0), 0);
    else
      select count(*) into v_consumed from public.ai_runs r
       where r.guest_workspace_id = v_run.guest_workspace_id
         and r.quota_scope = 'guest' and r.openai_started_at is not null;
      return query select true, true, greatest(p_guest_limit - v_consumed, 0);
    end if;
    return;
  end if;

  -- Fail closed: allowance is spent at the exact preflight -> OpenAI boundary
  -- and nowhere else.
  if v_run.stage <> 'preflight_ready' then
    return query select false, false, 0;
    return;
  end if;

  if v_run.quota_scope = 'authenticated' then
    insert into public.ai_monthly_usage (user_id, usage_month, runs_consumed)
    values (v_run.owner_user_id, v_month, 0)
    on conflict (user_id, usage_month) do nothing;

    select u.runs_consumed into v_consumed
      from public.ai_monthly_usage u
     where u.user_id = v_run.owner_user_id and u.usage_month = v_month
     for update;

    if v_consumed >= p_user_monthly_limit then
      return query select false, false, 0;
      return;
    end if;

    update public.ai_monthly_usage
       set runs_consumed = runs_consumed + 1
     where user_id = v_run.owner_user_id and usage_month = v_month;
    v_consumed := v_consumed + 1;

    update public.ai_runs
       set stage = 'analyzing', openai_started_at = now()
     where id = p_run_id;

    return query select true, false, greatest(p_user_monthly_limit - v_consumed, 0);
    return;
  end if;

  perform 1 from public.guest_workspaces where id = v_run.guest_workspace_id for update;

  select count(*) into v_consumed from public.ai_runs r
   where r.guest_workspace_id = v_run.guest_workspace_id
     and r.quota_scope = 'guest' and r.openai_started_at is not null;

  if v_consumed >= p_guest_limit then
    return query select false, false, 0;
    return;
  end if;

  update public.ai_runs
     set stage = 'analyzing', openai_started_at = now()
   where id = p_run_id;

  return query select true, false, greatest(p_guest_limit - (v_consumed + 1), 0);
end;
$$;

revoke all on function public.arc_reserve_ai_allowance(uuid, uuid, text, date, integer, integer)
  from public, anon, authenticated;
grant execute on function public.arc_reserve_ai_allowance(uuid, uuid, text, date, integer, integer)
  to service_role;

/* ------------------------------------- 7. failure transition matrix */

create or replace function public.arc_mark_ai_run_failure(
  p_run_id uuid,
  p_failure_stage text,
  p_failure_category text,
  p_failure_code text,
  p_safe_message text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_terminal constant text[] := array['succeeded', 'preflight_failed', 'api_failed',
                                      'response_invalid', 'application_failed'];
  v_run public.ai_runs;
  v_stage text;
  v_allowed boolean;
begin
  select * into v_run from public.ai_runs where id = p_run_id for update;
  if v_run.id is null then
    raise exception 'ARC: unknown AI run';
  end if;
  if v_run.stage = any (v_terminal) then
    raise exception 'ARC: a completed AI run cannot be re-marked';
  end if;

  v_stage := case coalesce(p_failure_category, '')
               when 'preflight' then 'preflight_failed'
               when 'api' then 'api_failed'
               when 'response' then 'response_invalid'
               when 'application' then 'application_failed'
               else null
             end;
  if v_stage is null then
    raise exception 'ARC: unknown AI failure category %', p_failure_category;
  end if;

  -- A failure must match where the run actually was. History may never claim
  -- an API failure before ARC crossed the API boundary.
  v_allowed := case v_stage
    when 'preflight_failed' then
      v_run.stage in ('created', 'extracting', 'preflight_ready')
        and v_run.openai_started_at is null
    when 'api_failed' then
      v_run.stage = 'analyzing' and v_run.openai_started_at is not null
    when 'response_invalid' then
      v_run.stage = 'validating' and v_run.openai_started_at is not null
    when 'application_failed' then
      v_run.stage = 'applying' and v_run.openai_started_at is not null
    else false
  end;
  if not v_allowed then
    raise exception 'ARC: % is not a valid outcome for a run at stage %', v_stage, v_run.stage;
  end if;

  update public.ai_runs
     set stage = v_stage,
         completed_at = now(),
         failure_stage = left(coalesce(p_failure_stage, ''), 60),
         failure_category = p_failure_category,
         failure_code = left(coalesce(p_failure_code, ''), 60),
         safe_message = left(coalesce(p_safe_message, ''), 500)
   where id = p_run_id;

  return v_stage;
end;
$$;

revoke all on function public.arc_mark_ai_run_failure(uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.arc_mark_ai_run_failure(uuid, text, text, text, text)
  to service_role;