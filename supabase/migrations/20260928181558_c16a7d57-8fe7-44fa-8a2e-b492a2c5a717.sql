-- Package 3D-T — browser sessions that own several temporary analyses.

create table public.guest_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
revoke all on public.guest_sessions from anon, authenticated;
grant all on public.guest_sessions to service_role;
alter table public.guest_sessions enable row level security;
create trigger guest_sessions_set_updated_at before update on public.guest_sessions
  for each row execute function public.arc_set_updated_at();

alter table public.guest_workspaces
  add column session_id uuid references public.guest_sessions(id) on delete cascade,
  add column credential_kind text not null default 'legacy',
  add column origin text not null default 'blank';
alter table public.guest_workspaces
  add constraint guest_workspaces_credential_kind_check check (credential_kind in ('legacy', 'derived')),
  add constraint guest_workspaces_origin_check check (origin ~ '^(blank|upload|sample:[a-z0-9-]{1,40})$');
create index guest_workspaces_session_idx on public.guest_workspaces (session_id, status, updated_at desc);

-- Immutable session lineage for guest AI runs. Deliberately no foreign key: a
-- referential action would rewrite completed, immutable runs.
alter table public.ai_runs add column guest_session_id uuid;
create index ai_runs_guest_session_idx on public.ai_runs (guest_session_id) where quota_scope = 'guest';

-- Run provenance: guest_session_id joins the immutable set.
create or replace function public.arc_protect_ai_run()
 returns trigger
 language plpgsql
 set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_terminal constant text[] := array['succeeded', 'preflight_failed', 'api_failed',
                                      'response_invalid', 'application_failed'];
  v_probe public.ai_runs;
  v_rehome boolean;
begin
  if tg_op = 'DELETE' then
    return old;
  end if;

  v_rehome := old.guest_workspace_id is not null
              and new.guest_workspace_id is null
              and old.revision_id is null
              and new.revision_id is not null;

  if old.stage = any (v_terminal) then
    v_probe := new;
    v_probe.restored_at := old.restored_at;
    v_probe.updated_at := old.updated_at;
    if v_rehome then
      v_probe.revision_id := old.revision_id;
      v_probe.guest_workspace_id := old.guest_workspace_id;
      v_probe.owner_user_id := old.owner_user_id;
    end if;
    if v_probe is distinct from old then
      raise exception 'ARC: a completed AI run is immutable';
    end if;
    return new;
  end if;

  if new.id <> old.id
     or (not v_rehome and (new.revision_id is distinct from old.revision_id
                           or new.guest_workspace_id is distinct from old.guest_workspace_id
                           or new.owner_user_id is distinct from old.owner_user_id))
     or new.guest_token_hash is distinct from old.guest_token_hash
     or new.guest_session_id is distinct from old.guest_session_id
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
$function$;

-- Stamp the session on every new temporary-workspace run.
create or replace function public.arc_stamp_ai_run_guest_session()
 returns trigger
 language plpgsql
 set search_path to 'pg_catalog', 'public'
as $function$
begin
  if new.guest_workspace_id is not null then
    select g.session_id into new.guest_session_id
      from public.guest_workspaces g where g.id = new.guest_workspace_id;
  else
    new.guest_session_id := null;
  end if;
  return new;
end;
$function$;
create trigger ai_runs_stamp_guest_session before insert on public.ai_runs
  for each row execute function public.arc_stamp_ai_run_guest_session();

-- Legacy backfill: each active, unmigrated workspace becomes the only analysis
-- of a session whose credential is the workspace's existing cookie credential.
insert into public.guest_sessions (token_hash, expires_at)
select g.token_hash, g.expires_at
  from public.guest_workspaces g
 where g.session_id is null and g.status = 'active'
on conflict (token_hash) do nothing;

update public.guest_workspaces g
   set session_id = s.id
  from public.guest_sessions s
 where g.session_id is null and g.status = 'active' and s.token_hash = g.token_hash;

alter table public.ai_runs disable trigger ai_runs_protect_provenance;
update public.ai_runs r
   set guest_session_id = g.session_id
  from public.guest_workspaces g
 where r.guest_workspace_id = g.id and r.guest_session_id is null and g.session_id is not null;
alter table public.ai_runs enable trigger ai_runs_protect_provenance;

-- Resolve (and lazily wrap) the session named by a cookie credential hash.
create or replace function public.arc_resolve_guest_session(p_session_hash text)
 returns table(session_id uuid, expires_at timestamptz)
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_legacy public.guest_workspaces;
begin
  if coalesce(p_session_hash, '') = '' then
    return;
  end if;

  if not exists (select 1 from public.guest_sessions s where s.token_hash = p_session_hash) then
    select * into v_legacy from public.guest_workspaces g
     where g.token_hash = p_session_hash and g.session_id is null
       and g.status = 'active' and g.expires_at > now()
     for update;
    if v_legacy.id is not null then
      insert into public.guest_sessions (token_hash, expires_at)
      values (p_session_hash, v_legacy.expires_at)
      on conflict (token_hash) do nothing;
      update public.guest_workspaces g
         set session_id = (select s.id from public.guest_sessions s where s.token_hash = p_session_hash)
       where g.id = v_legacy.id and g.session_id is null;
    end if;
  end if;

  return query
    select s.id, s.expires_at from public.guest_sessions s
     where s.token_hash = p_session_hash and s.expires_at > now();
end;
$function$;
revoke all on function public.arc_resolve_guest_session(text) from public, anon, authenticated;
grant execute on function public.arc_resolve_guest_session(text) to service_role;

-- Atomic, idempotent re-key of a legacy workspace to its per-analysis credential.
create or replace function public.arc_upgrade_legacy_guest_workspace(
  p_session_hash text, p_workspace_id uuid, p_new_token_hash text)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_session public.guest_sessions;
  v_row public.guest_workspaces;
begin
  select * into v_session from public.guest_sessions s
   where s.token_hash = p_session_hash and s.expires_at > now();
  if v_session.id is null then
    return false;
  end if;

  select * into v_row from public.guest_workspaces g where g.id = p_workspace_id for update;
  if v_row.id is null or v_row.session_id is distinct from v_session.id then
    return false;
  end if;

  if v_row.credential_kind = 'derived' then
    return v_row.token_hash = p_new_token_hash;
  end if;

  if v_row.token_hash <> p_session_hash then
    return false;
  end if;

  update public.guest_workspaces
     set token_hash = p_new_token_hash, credential_kind = 'derived'
   where id = p_workspace_id;
  return true;
end;
$function$;
revoke all on function public.arc_upgrade_legacy_guest_workspace(text, uuid, text) from public, anon, authenticated;
grant execute on function public.arc_upgrade_legacy_guest_workspace(text, uuid, text) to service_role;

-- Guest allowance: counted per browser session (limit unchanged). Legacy runs
-- without a session stamp keep today's per-workspace count.
create or replace function public.arc_reserve_ai_allowance(p_run_id uuid, p_owner_user_id uuid, p_guest_token_hash text, p_utc_month date, p_user_monthly_limit integer, p_guest_limit integer)
 returns table(reserved boolean, already_reserved boolean, remaining_allowance integer)
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
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

  if v_run.openai_started_at is not null then
    if v_run.quota_scope = 'authenticated' then
      select coalesce(u.runs_consumed, 0) into v_consumed
        from public.ai_monthly_usage u
       where u.user_id = v_run.owner_user_id and u.usage_month = v_month;
      return query select true, true,
                          greatest(p_user_monthly_limit - coalesce(v_consumed, 0), 0);
    else
      select count(*) into v_consumed from public.ai_runs r
       where r.quota_scope = 'guest' and r.openai_started_at is not null
         and ((v_run.guest_session_id is not null and r.guest_session_id = v_run.guest_session_id)
              or (v_run.guest_session_id is null and r.guest_workspace_id = v_run.guest_workspace_id));
      return query select true, true, greatest(p_guest_limit - v_consumed, 0);
    end if;
    return;
  end if;

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

  -- Serialize every reservation in the session (or, for a legacy run, the workspace).
  if v_run.guest_session_id is not null then
    perform 1 from public.guest_sessions where id = v_run.guest_session_id for update;
  else
    perform 1 from public.guest_workspaces where id = v_run.guest_workspace_id for update;
  end if;

  select count(*) into v_consumed from public.ai_runs r
   where r.quota_scope = 'guest' and r.openai_started_at is not null
     and ((v_run.guest_session_id is not null and r.guest_session_id = v_run.guest_session_id)
          or (v_run.guest_session_id is null and r.guest_workspace_id = v_run.guest_workspace_id));

  if v_consumed >= p_guest_limit then
    return query select false, false, 0;
    return;
  end if;

  update public.ai_runs
     set stage = 'analyzing', openai_started_at = now()
   where id = p_run_id;

  return query select true, false, greatest(p_guest_limit - (v_consumed + 1), 0);
end;
$function$;

-- Cleanup: expired sessions go once none of their workspaces remain.
create or replace function public.arc_delete_expired_guest_workspaces()
 returns integer
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_count integer;
begin
  delete from public.guest_workspaces g where g.expires_at <= now();
  get diagnostics v_count = row_count;
  delete from public.guest_sessions s
   where s.expires_at <= now()
     and not exists (select 1 from public.guest_workspaces g where g.session_id = s.id);
  return v_count;
end;
$function$;

-- Account deletion: the caller's cookie credential now names a session.
create or replace function public.arc_purge_user_guest_data(p_user_id uuid, p_guest_token_hash text)
 returns integer
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_count integer;
begin
  if p_user_id is null then
    raise exception 'a user is required' using errcode = '22023';
  end if;

  delete from public.guest_workspaces g
   where g.migrated_user_id = p_user_id
      or (coalesce(trim(p_guest_token_hash), '') <> '' and g.token_hash = p_guest_token_hash)
      or (coalesce(trim(p_guest_token_hash), '') <> '' and g.session_id in
            (select s.id from public.guest_sessions s where s.token_hash = p_guest_token_hash));
  get diagnostics v_count = row_count;

  if coalesce(trim(p_guest_token_hash), '') <> '' then
    delete from public.guest_sessions s where s.token_hash = p_guest_token_hash;
  end if;

  return v_count;
end;
$function$;