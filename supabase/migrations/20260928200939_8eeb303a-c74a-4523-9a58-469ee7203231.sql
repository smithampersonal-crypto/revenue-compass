-- Package 3D-T allowance refund: the visible allowance counts only delivered
-- (succeeded) analyses plus in-flight provider-started reservations. A
-- separate technical ceiling counts every provider-started attempt.

create or replace function public.arc_guest_session_usage(p_session_id uuid)
returns integer language sql stable security definer
set search_path to 'pg_catalog', 'public'
as $$
  select count(*)::integer
    from public.guest_sessions s
    join public.ai_runs r
      on r.quota_scope = 'guest'
     and r.openai_started_at is not null
     and r.stage in ('succeeded', 'created', 'extracting', 'preflight_ready',
                     'analyzing', 'validating', 'applying')
     and (r.guest_session_id = s.id
          or (r.guest_session_id is null and r.guest_token_hash = s.token_hash))
   where s.id = p_session_id
$$;

create or replace function public.arc_guest_workspace_usage(p_workspace_id uuid)
returns integer language plpgsql stable security definer
set search_path to 'pg_catalog', 'public'
as $$
declare v_session uuid;
begin
  select g.session_id into v_session from public.guest_workspaces g where g.id = p_workspace_id;
  if v_session is not null then
    return public.arc_guest_session_usage(v_session);
  end if;
  return (select count(*)::integer from public.ai_runs r
           where r.quota_scope = 'guest' and r.openai_started_at is not null
             and r.stage in ('succeeded', 'created', 'extracting', 'preflight_ready',
                             'analyzing', 'validating', 'applying')
             and r.guest_workspace_id = p_workspace_id);
end;
$$;

-- Technical provider-attempt count: every provider-started run, any outcome.
create or replace function public.arc_guest_attempt_count(p_session_id uuid, p_workspace_id uuid)
returns integer language sql stable security definer
set search_path to 'pg_catalog', 'public'
as $$
  select case when p_session_id is not null then
    (select count(*)::integer
       from public.guest_sessions s
       join public.ai_runs r
         on r.quota_scope = 'guest' and r.openai_started_at is not null
        and (r.guest_session_id = s.id
             or (r.guest_session_id is null and r.guest_token_hash = s.token_hash))
      where s.id = p_session_id)
  else
    (select count(*)::integer from public.ai_runs r
      where r.quota_scope = 'guest' and r.openai_started_at is not null
        and r.guest_workspace_id = p_workspace_id)
  end
$$;

revoke all on function public.arc_guest_session_usage(uuid) from public, anon, authenticated;
revoke all on function public.arc_guest_workspace_usage(uuid) from public, anon, authenticated;
revoke all on function public.arc_guest_attempt_count(uuid, uuid) from public, anon, authenticated;
grant execute on function public.arc_guest_session_usage(uuid) to service_role;
grant execute on function public.arc_guest_workspace_usage(uuid) to service_role;
grant execute on function public.arc_guest_attempt_count(uuid, uuid) to service_role;

drop function if exists public.arc_reserve_ai_allowance(uuid, uuid, text, date, integer, integer);

create function public.arc_reserve_ai_allowance(p_run_id uuid, p_owner_user_id uuid, p_guest_token_hash text, p_utc_month date, p_user_monthly_limit integer, p_guest_limit integer)
 returns table(reserved boolean, already_reserved boolean, remaining_allowance integer, attempt_limited boolean)
 language plpgsql security definer
 set search_path to 'pg_catalog', 'public'
as $function$
declare
  c_guest_attempt_cap constant integer := 6;
  c_user_attempt_cap constant integer := 20;
  v_run public.ai_runs;
  v_month date := date_trunc('month', coalesce(p_utc_month, (now() at time zone 'utc')::date))::date;
  v_consumed integer;
  v_attempts integer;
  v_session uuid;
begin
  select * into v_run from public.ai_runs where id = p_run_id for update;
  if v_run.id is null then
    raise exception 'ARC: unknown AI run';
  end if;

  if v_run.quota_scope = 'authenticated' then
    if p_owner_user_id is null or p_owner_user_id <> v_run.owner_user_id then
      return query select false, false, 0, false; return;
    end if;
  else
    if p_guest_token_hash is null or p_guest_token_hash is distinct from v_run.guest_token_hash then
      return query select false, false, 0, false; return;
    end if;
    v_session := coalesce(v_run.guest_session_id,
      (select g.session_id from public.guest_workspaces g where g.id = v_run.guest_workspace_id));
  end if;

  if v_run.openai_started_at is not null then
    if v_run.quota_scope = 'authenticated' then
      select coalesce(u.runs_consumed, 0) into v_consumed
        from public.ai_monthly_usage u
       where u.user_id = v_run.owner_user_id and u.usage_month = v_month;
      return query select true, true, greatest(p_user_monthly_limit - coalesce(v_consumed, 0), 0), false;
    else
      if v_session is not null then
        v_consumed := public.arc_guest_session_usage(v_session);
      else
        v_consumed := public.arc_guest_workspace_usage(v_run.guest_workspace_id);
      end if;
      return query select true, true, greatest(p_guest_limit - v_consumed, 0), false;
    end if;
    return;
  end if;

  if v_run.stage <> 'preflight_ready' then
    return query select false, false, 0, false; return;
  end if;

  if v_run.quota_scope = 'authenticated' then
    insert into public.ai_monthly_usage (user_id, usage_month, runs_consumed)
    values (v_run.owner_user_id, v_month, 0)
    on conflict (user_id, usage_month) do nothing;

    -- The usage row lock serializes every reservation for this user and month.
    select u.runs_consumed into v_consumed
      from public.ai_monthly_usage u
     where u.user_id = v_run.owner_user_id and u.usage_month = v_month
     for update;

    if v_consumed >= p_user_monthly_limit then
      return query select false, false, 0, false; return;
    end if;

    select count(*)::integer into v_attempts
      from public.ai_runs r
     where r.quota_scope = 'authenticated'
       and r.owner_user_id = v_run.owner_user_id
       and r.openai_started_at is not null
       and date_trunc('month', r.openai_started_at at time zone 'utc')::date = v_month;
    if v_attempts >= c_user_attempt_cap then
      return query select false, false, greatest(p_user_monthly_limit - v_consumed, 0), true; return;
    end if;

    update public.ai_monthly_usage
       set runs_consumed = runs_consumed + 1
     where user_id = v_run.owner_user_id and usage_month = v_month;
    v_consumed := v_consumed + 1;

    update public.ai_runs set stage = 'analyzing', openai_started_at = now() where id = p_run_id;

    return query select true, false, greatest(p_user_monthly_limit - v_consumed, 0), false;
    return;
  end if;

  if v_session is not null then
    perform 1 from public.guest_sessions where id = v_session for update;
    v_consumed := public.arc_guest_session_usage(v_session);
  else
    perform 1 from public.guest_workspaces where id = v_run.guest_workspace_id for update;
    v_consumed := public.arc_guest_workspace_usage(v_run.guest_workspace_id);
  end if;

  if v_consumed >= p_guest_limit then
    return query select false, false, 0, false; return;
  end if;

  v_attempts := public.arc_guest_attempt_count(v_session, v_run.guest_workspace_id);
  if v_attempts >= c_guest_attempt_cap then
    return query select false, false, greatest(p_guest_limit - v_consumed, 0), true; return;
  end if;

  update public.ai_runs set stage = 'analyzing', openai_started_at = now() where id = p_run_id;

  return query select true, false, greatest(p_guest_limit - (v_consumed + 1), 0), false;
end;
$function$;

revoke all on function public.arc_reserve_ai_allowance(uuid, uuid, text, date, integer, integer) from public, anon, authenticated;
grant execute on function public.arc_reserve_ai_allowance(uuid, uuid, text, date, integer, integer) to service_role;

-- Failure releases the authenticated monthly reservation (prospective only).
create or replace function public.arc_mark_ai_run_failure(
  p_run_id uuid, p_failure_stage text, p_failure_category text, p_failure_code text, p_safe_message text
)
returns text language plpgsql security definer
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

  v_allowed := case v_stage
    when 'preflight_failed' then
      v_run.stage in ('created', 'extracting', 'preflight_ready') and v_run.openai_started_at is null
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

  -- Exactly once: only the active -> terminal transition reaches here.
  if v_run.quota_scope = 'authenticated' and v_run.openai_started_at is not null then
    update public.ai_monthly_usage
       set runs_consumed = greatest(runs_consumed - 1, 0)
     where user_id = v_run.owner_user_id
       and usage_month = date_trunc('month', v_run.openai_started_at at time zone 'utc')::date;
  end if;

  return v_stage;
end;
$$;
revoke all on function public.arc_mark_ai_run_failure(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.arc_mark_ai_run_failure(uuid, text, text, text, text) to service_role;
