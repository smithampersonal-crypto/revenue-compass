-- ARC Phase 9C — AI run, state and quota foundation.
-- Non-generative: nothing here calls or authorizes an AI request. It records
-- run provenance, enforces exact allowance semantics and keeps every AI
-- persistence table unreachable from the browser roles.

/* --------------------------------------------------------------- tables */

create table public.ai_runs (
  id uuid primary key,
  -- Owner target: exactly one mutable ARC workspace scope.
  revision_id uuid references public.analysis_revisions(id) on delete cascade,
  guest_workspace_id uuid references public.guest_workspaces(id) on delete cascade,
  -- Authentication / quota identity.
  owner_user_id uuid references auth.users(id) on delete cascade,
  guest_token_hash text,
  quota_scope text not null check (quota_scope in ('authenticated', 'guest')),
  stage text not null default 'created' check (stage in (
    'created', 'extracting', 'preflight_ready', 'analyzing', 'validating', 'applying',
    'succeeded', 'preflight_failed', 'api_failed', 'response_invalid', 'application_failed')),
  source_set_fingerprint text not null,
  source_count integer not null default 0 check (source_count >= 0),
  page_count integer not null default 0 check (page_count >= 0),
  -- Pre-run snapshots for a future whole-run restore. Accountant-owned
  -- canonical inputs and AI sidecar state only: never contract evidence.
  pre_run_canonical_inputs jsonb not null,
  pre_run_ai_state jsonb,
  model text not null,
  reasoning_effort text not null,
  prompt_version text not null,
  output_schema_version text not null,
  guidance_registry_hash text not null,
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  -- Durable evidence that allowance was consumed.
  openai_started_at timestamptz,
  completed_at timestamptz,
  failure_stage text,
  failure_category text,
  failure_code text,
  safe_message text,
  -- Validated structured-result and usage metadata (populated in Phase 9F+).
  result_metadata jsonb,
  usage_metadata jsonb,
  review_issue_count integer not null default 0 check (review_issue_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_runs_owner_scope_xor
    check ((revision_id is not null) <> (guest_workspace_id is not null)),
  constraint ai_runs_quota_scope_identity check (
    (quota_scope = 'authenticated' and owner_user_id is not null)
    or (quota_scope = 'guest' and owner_user_id is null and guest_token_hash is not null)),
  constraint ai_runs_revision_is_authenticated
    check (revision_id is null or quota_scope = 'authenticated'),
  constraint ai_runs_safe_message_length
    check (safe_message is null or length(safe_message) <= 500)
);

comment on table public.ai_runs is
  'ARC Phase 9 AI run history and operational state. Server-only: no browser role holds any privilege. Never stores PDFs, extracted text, prompts, signed URLs or unvalidated model responses.';

-- At most one nonterminal run per owner scope.
create unique index ai_runs_one_active_per_revision on public.ai_runs (revision_id)
  where revision_id is not null
    and stage in ('created', 'extracting', 'preflight_ready', 'analyzing', 'validating', 'applying');
create unique index ai_runs_one_active_per_guest_workspace on public.ai_runs (guest_workspace_id)
  where guest_workspace_id is not null
    and stage in ('created', 'extracting', 'preflight_ready', 'analyzing', 'validating', 'applying');
create index ai_runs_guest_consumed on public.ai_runs (guest_workspace_id)
  where guest_workspace_id is not null and quota_scope = 'guest' and openai_started_at is not null;
create index ai_runs_owner_created_at on public.ai_runs (owner_user_id, created_at desc);

create table public.ai_run_sources (
  run_id uuid not null references public.ai_runs(id) on delete cascade,
  source_document_id uuid not null references public.source_documents(id) on delete cascade,
  position integer not null default 0,
  sha256 text not null,
  byte_size bigint not null check (byte_size > 0),
  page_count integer not null check (page_count > 0),
  created_at timestamptz not null default now(),
  primary key (run_id, source_document_id)
);
comment on table public.ai_run_sources is
  'Which exact source documents participated in a run. Verified identity only — never bytes, base64 or extracted text.';

create table public.ai_run_guidance (
  run_id uuid not null references public.ai_runs(id) on delete cascade,
  card_id text not null,
  inclusion_reason text not null,
  matched_signals text[] not null default '{}',
  registry_hash text not null,
  created_at timestamptz not null default now(),
  primary key (run_id, card_id)
);
comment on table public.ai_run_guidance is
  'Deterministic Guidance Registry provenance for a run. The registry itself remains the source of card content.';

create table public.ai_analysis_state (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid references public.analysis_revisions(id) on delete cascade,
  guest_workspace_id uuid references public.guest_workspaces(id) on delete cascade,
  last_successful_run_id uuid references public.ai_runs(id) on delete set null,
  source_set_fingerprint text,
  source_state jsonb not null default '{}'::jsonb,
  field_provenance jsonb not null default '{}'::jsonb,
  object_provenance jsonb not null default '{}'::jsonb,
  tombstones jsonb not null default '[]'::jsonb,
  review_items jsonb not null default '[]'::jsonb,
  lock_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_analysis_state_owner_scope_xor
    check ((revision_id is not null) <> (guest_workspace_id is not null))
);
create unique index ai_analysis_state_one_per_revision on public.ai_analysis_state (revision_id)
  where revision_id is not null;
create unique index ai_analysis_state_one_per_guest_workspace on public.ai_analysis_state (guest_workspace_id)
  where guest_workspace_id is not null;
comment on table public.ai_analysis_state is
  'Current mutable AI sidecar for one editable owner scope. Phase 9E owns the merge/review semantics.';

create table public.ai_monthly_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_month date not null,
  runs_consumed integer not null default 0 check (runs_consumed >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_monthly_usage_month_is_first_of_month
    check (usage_month = date_trunc('month', usage_month)::date),
  constraint ai_monthly_usage_unique_month unique (user_id, usage_month)
);
comment on table public.ai_monthly_usage is
  'Authenticated AI allowance accounting, one row per account per UTC month. Anonymous workspace runs never become authenticated usage.';

create trigger ai_runs_set_updated_at before update on public.ai_runs
  for each row execute function public.arc_set_updated_at();
create trigger ai_analysis_state_set_updated_at before update on public.ai_analysis_state
  for each row execute function public.arc_set_updated_at();
create trigger ai_monthly_usage_set_updated_at before update on public.ai_monthly_usage
  for each row execute function public.arc_set_updated_at();

/* ---------------------------------------------------------- immutability */

create or replace function public.arc_protect_ai_run()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_terminal constant text[] := array['succeeded', 'preflight_failed', 'api_failed',
                                      'response_invalid', 'application_failed'];
begin
  if tg_op = 'DELETE' then
    if old.openai_started_at is not null or old.stage = any (v_terminal) then
      raise exception 'ARC: completed AI run provenance cannot be deleted';
    end if;
    return old;
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

create trigger ai_runs_protect_provenance
  before update or delete on public.ai_runs
  for each row execute function public.arc_protect_ai_run();

/* ------------------------------------------------------- trusted routines */

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

  if p_expected_lock_version is not null and p_expected_lock_version <> v_lock_version then
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

  -- The caller must be the run's own owner; identity is server-derived.
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

  if v_run.stage not in ('created', 'extracting', 'preflight_ready') then
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

  -- Anonymous allowance belongs to the temporary workspace. Lock it so two
  -- reservations for one workspace cannot both observe the same count.
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

  update public.ai_runs
     set stage = v_stage,
         completed_at = now(),
         failure_stage = left(coalesce(p_failure_stage, ''), 60),
         failure_category = p_failure_category,
         failure_code = left(coalesce(p_failure_code, ''), 60),
         -- Safe operator message only; never a response body, request body or
         -- anything derived from contract evidence.
         safe_message = left(coalesce(p_safe_message, ''), 500)
   where id = p_run_id;

  return v_stage;
end;
$$;

/* --------------------------------------------------------------- grants */

-- The AI persistence tables are not browser-facing. No role but the service
-- role reaches them, and row level security stays on with no policy.
alter table public.ai_runs enable row level security;
alter table public.ai_run_sources enable row level security;
alter table public.ai_run_guidance enable row level security;
alter table public.ai_analysis_state enable row level security;
alter table public.ai_monthly_usage enable row level security;

revoke all on public.ai_runs from public, anon, authenticated;
revoke all on public.ai_run_sources from public, anon, authenticated;
revoke all on public.ai_run_guidance from public, anon, authenticated;
revoke all on public.ai_analysis_state from public, anon, authenticated;
revoke all on public.ai_monthly_usage from public, anon, authenticated;

grant all on public.ai_runs to service_role;
grant all on public.ai_run_sources to service_role;
grant all on public.ai_run_guidance to service_role;
grant all on public.ai_analysis_state to service_role;
grant all on public.ai_monthly_usage to service_role;

revoke all on function public.arc_protect_ai_run() from public, anon, authenticated;
revoke all on function public.arc_create_ai_run(uuid, uuid, text, uuid, uuid, integer, text, text, jsonb, jsonb, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.arc_reserve_ai_allowance(uuid, uuid, text, date, integer, integer) from public, anon, authenticated;
revoke all on function public.arc_mark_ai_run_failure(uuid, text, text, text, text) from public, anon, authenticated;

grant execute on function public.arc_create_ai_run(uuid, uuid, text, uuid, uuid, integer, text, text, jsonb, jsonb, text, text, text, text, text) to service_role;
grant execute on function public.arc_reserve_ai_allowance(uuid, uuid, text, date, integer, integer) to service_role;
grant execute on function public.arc_mark_ai_run_failure(uuid, text, text, text, text) to service_role;