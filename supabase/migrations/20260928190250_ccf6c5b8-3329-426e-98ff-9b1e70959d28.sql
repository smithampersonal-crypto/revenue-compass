-- Package 3D-T quota correction: ONE authoritative session-wide guest-usage definition.
create or replace function public.arc_guest_session_usage(p_session_id uuid)
returns integer
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select count(*)::integer
    from public.guest_sessions s
    join public.ai_runs r
      on r.quota_scope = 'guest'
     and r.openai_started_at is not null
     and (r.guest_session_id = s.id
          -- Legacy / mixed-deployment lineage: a pre-session run carries the
          -- legacy workspace credential, which is exactly the session hash the
          -- lazy wrap preserved. Exact equality only; survives re-homing.
          or (r.guest_session_id is null and r.guest_token_hash = s.token_hash))
   where s.id = p_session_id
$$;

create or replace function public.arc_guest_workspace_usage(p_workspace_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_session uuid;
begin
  select g.session_id into v_session from public.guest_workspaces g where g.id = p_workspace_id;
  if v_session is not null then
    return public.arc_guest_session_usage(v_session);
  end if;
  -- Truly legacy, not yet attached to a session: unchanged per-workspace count.
  return (select count(*)::integer from public.ai_runs r
           where r.quota_scope = 'guest' and r.openai_started_at is not null
             and r.guest_workspace_id = p_workspace_id);
end;
$$;

revoke all on function public.arc_guest_session_usage(uuid) from public, anon, authenticated;
revoke all on function public.arc_guest_workspace_usage(uuid) from public, anon, authenticated;
grant execute on function public.arc_guest_session_usage(uuid) to service_role;
grant execute on function public.arc_guest_workspace_usage(uuid) to service_role;

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
  v_session uuid;
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
    v_session := coalesce(v_run.guest_session_id,
      (select g.session_id from public.guest_workspaces g where g.id = v_run.guest_workspace_id));
  end if;

  if v_run.openai_started_at is not null then
    if v_run.quota_scope = 'authenticated' then
      select coalesce(u.runs_consumed, 0) into v_consumed
        from public.ai_monthly_usage u
       where u.user_id = v_run.owner_user_id and u.usage_month = v_month;
      return query select true, true,
                          greatest(p_user_monthly_limit - coalesce(v_consumed, 0), 0);
    else
      if v_session is not null then
        v_consumed := public.arc_guest_session_usage(v_session);
      else
        v_consumed := public.arc_guest_workspace_usage(v_run.guest_workspace_id);
      end if;
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

  -- Serialize every reservation in the session (or, for a truly legacy run, the workspace).
  if v_session is not null then
    perform 1 from public.guest_sessions where id = v_session for update;
    v_consumed := public.arc_guest_session_usage(v_session);
  else
    perform 1 from public.guest_workspaces where id = v_run.guest_workspace_id for update;
    v_consumed := public.arc_guest_workspace_usage(v_run.guest_workspace_id);
  end if;

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