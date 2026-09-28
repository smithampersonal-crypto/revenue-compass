-- ARC Package 3D-T allowance refund. The visible allowance counts delivered
-- (succeeded) analyses plus in-flight reservations; failed provider-started
-- runs release it but still count toward the technical attempt ceiling
-- (6 guest per session / 20 authenticated per month). Synthetic data only;
-- rolled back. Every row must report passed = true.
begin;

create temporary table arc_test_results (assertion text, passed boolean not null) on commit drop;

-- Creates a run and reserves through the real RPC. Returns the run id and
-- the reservation outcome.
create function pg_temp.arc_rf_reserve(p_ws uuid, p_hash text, p_owner uuid default null)
returns table(run_id uuid, reserved boolean, remaining integer, attempt_limited boolean)
language plpgsql as $$
declare v_run uuid := gen_random_uuid(); v_r record;
begin
  insert into public.ai_runs (id, guest_workspace_id, guest_token_hash, owner_user_id, quota_scope,
                              stage, source_set_fingerprint, pre_run_canonical_inputs, model,
                              reasoning_effort, prompt_version, output_schema_version,
                              guidance_registry_hash)
  values (v_run, p_ws, p_hash, p_owner,
          case when p_owner is null then 'guest' else 'authenticated' end,
          'preflight_ready', 'fp', '{}'::jsonb, 'm', 'high', 'p', 's', 'h');
  select * into v_r from public.arc_reserve_ai_allowance(v_run, p_owner, p_hash,
    (now() at time zone 'utc')::date, 10, 3);
  if not v_r.reserved then
    perform public.arc_mark_ai_run_failure(v_run, 'preflight_ready', 'preflight',
      case when v_r.attempt_limited then 'attempt_limit' else 'allowance_exhausted' end, 'x');
  end if;
  run_id := v_run; reserved := v_r.reserved; remaining := v_r.remaining_allowance;
  attempt_limited := v_r.attempt_limited;
  return next;
end $$;

-- Terminal outcomes after a reservation.
create function pg_temp.arc_rf_succeed(p_run uuid) returns void language sql as $$
  update public.ai_runs set stage = 'succeeded', completed_at = now() where id = p_run;
$$;
create function pg_temp.arc_rf_fail_response(p_run uuid) returns void language plpgsql as $$
begin
  update public.ai_runs set stage = 'validating' where id = p_run;
  perform public.arc_mark_ai_run_failure(p_run, 'validating', 'response',
                                         'citation_anchor_failure', 'x');
end $$;

insert into arc_test_results values
  ('00 browser roles cannot execute the attempt counter',
   not (has_function_privilege('anon', 'public.arc_guest_attempt_count(uuid,uuid)', 'execute')
        or has_function_privilege('authenticated', 'public.arc_guest_attempt_count(uuid,uuid)', 'execute'))),
  ('00b browser roles cannot reserve',
   not has_function_privilege('authenticated',
     'public.arc_reserve_ai_allowance(uuid,uuid,text,date,integer,integer)', 'execute'));

do $$
declare
  draft jsonb := '{"schemaVersion":"arc.workflow.v1","draft":{}}'::jsonb;
  v_user uuid := '00000000-0000-4000-8000-0000000003f1';
  v_session uuid; v_a uuid; v_b uuid; v_s2 uuid; v_c uuid;
  a_hash text := repeat('a', 64); b_hash text := repeat('b', 64); c_hash text := repeat('c', 64);
  r record; v_fail uuid; v_active uuid; i integer;
begin
  insert into auth.users (id, aud, role, email) values (v_user, 'authenticated', 'authenticated', 'rf@example.test');

  insert into public.guest_sessions (token_hash, expires_at)
  values (repeat('1', 64), now() + interval '9 hours') returning id into v_session;
  insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at, session_id, credential_kind, origin)
  values (a_hash, draft, 'arc.workflow.v1', now() + interval '9 hours', v_session, 'derived', 'blank') returning id into v_a;
  insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at, session_id, credential_kind, origin)
  values (b_hash, draft, 'arc.workflow.v1', now() + interval '9 hours', v_session, 'derived', 'blank') returning id into v_b;

  /* Live case */
  insert into arc_test_results values ('10 fresh session shows 3 remaining', public.arc_guest_session_usage(v_session) = 0);
  select * into r from pg_temp.arc_rf_reserve(v_a, a_hash); perform pg_temp.arc_rf_succeed(r.run_id);
  insert into arc_test_results values ('11 Test A succeeds -> 2 remaining', public.arc_guest_session_usage(v_session) = 1);
  select * into r from pg_temp.arc_rf_reserve(v_b, b_hash);
  insert into arc_test_results values ('12 in-flight B holds a reservation', public.arc_guest_session_usage(v_session) = 2);
  v_fail := r.run_id; perform pg_temp.arc_rf_fail_response(v_fail);
  insert into arc_test_results values
    ('13 B citation_anchor_failure -> still 2 remaining', public.arc_guest_session_usage(v_session) = 1),
    ('14 failed run remains in history with evidence',
     (select stage = 'response_invalid' and openai_started_at is not null and failure_code = 'citation_anchor_failure'
        from public.ai_runs where id = v_fail)),
    ('15 A and B show the same usage',
     public.arc_guest_workspace_usage(v_a) = 1 and public.arc_guest_workspace_usage(v_b) = 1),
    ('16 failed run still counts toward attempts', public.arc_guest_attempt_count(v_session, v_b) = 2);
  select * into r from pg_temp.arc_rf_reserve(v_b, b_hash); perform pg_temp.arc_rf_succeed(r.run_id);
  insert into arc_test_results values ('17 retry B succeeds -> 1 remaining', public.arc_guest_session_usage(v_session) = 2);

  /* Restore keeps the success counted */
  update public.ai_runs set restored_at = now() where id = r.run_id;
  insert into arc_test_results values ('18 restored success still counts', public.arc_guest_session_usage(v_session) = 2);

  /* Other failure stages release */
  select * into r from pg_temp.arc_rf_reserve(v_a, a_hash);
  perform public.arc_mark_ai_run_failure(r.run_id, 'analyzing', 'api', 'api_failure', 'x');
  insert into arc_test_results values ('19 api_failed releases', public.arc_guest_session_usage(v_session) = 2);
  select * into r from pg_temp.arc_rf_reserve(v_a, a_hash);
  update public.ai_runs set stage = 'applying' where id = r.run_id;
  perform public.arc_mark_ai_run_failure(r.run_id, 'applying', 'application', 'apply_failed', 'x');
  insert into arc_test_results values ('20 application_failed releases', public.arc_guest_session_usage(v_session) = 2);

  /* Save does not change the count */
  perform public.arc_migrate_guest_workspace_v3(v_a, v_user, null, 'Synthetic Co', 'Synthetic', null);
  insert into arc_test_results values
    ('21 saving A leaves usage unchanged', public.arc_guest_session_usage(v_session) = 2),
    ('22 saving consumed no monthly allowance', not exists (select 1 from public.ai_monthly_usage where user_id = v_user));

  /* Concurrency: in-flight counts; limit cannot be exceeded */
  select * into r from pg_temp.arc_rf_reserve(v_b, b_hash); v_active := r.run_id;
  insert into arc_test_results values ('23 third reservation allowed, 0 left', r.reserved and r.remaining = 0);
  insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at, session_id, credential_kind, origin)
  values (repeat('e', 64), draft, 'arc.workflow.v1', now() + interval '9 hours', v_session, 'derived', 'blank') returning id into v_c;
  select * into r from pg_temp.arc_rf_reserve(v_c, repeat('e', 64));
  insert into arc_test_results values
    ('24 fourth refused while third in flight', not r.reserved and not r.attempt_limited);
  perform public.arc_mark_ai_run_failure(v_active, 'analyzing', 'api', 'api_failure', 'x');
  -- attempts so far: A, B-fail, B-retry, api, app, in-flight = 6 -> ceiling reached
  select * into r from pg_temp.arc_rf_reserve(v_b, b_hash);
  insert into arc_test_results values
    ('25 guest attempt ceiling 6 refuses with attempt_limit', not r.reserved and r.attempt_limited),
    ('26 attempt ceiling does not reduce visible allowance', r.remaining = 1 and public.arc_guest_session_usage(v_session) = 2),
    ('27 refused-by-ceiling run is recorded as attempt_limit, provider never started',
     (select failure_code = 'attempt_limit' and openai_started_at is null from public.ai_runs where id = r.run_id));

  /* Guest under the ceiling in a fresh session behaves normally */
  insert into public.guest_sessions (token_hash, expires_at)
  values (repeat('2', 64), now() + interval '9 hours') returning id into v_s2;
  insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at, session_id, credential_kind, origin)
  values (c_hash, draft, 'arc.workflow.v1', now() + interval '9 hours', v_s2, 'derived', 'blank') returning id into v_c;
  for i in 1..5 loop
    select * into r from pg_temp.arc_rf_reserve(v_c, c_hash); perform pg_temp.arc_rf_fail_response(r.run_id);
  end loop;
  select * into r from pg_temp.arc_rf_reserve(v_c, c_hash);
  insert into arc_test_results values ('28 sixth guest attempt allowed after 5 failures', r.reserved);
  perform pg_temp.arc_rf_succeed(r.run_id);
  select * into r from pg_temp.arc_rf_reserve(v_c, c_hash);
  insert into arc_test_results values ('29 seventh guest attempt refused by ceiling', not r.reserved and r.attempt_limited);

  /* Authenticated monthly: same delivered-only semantics */
  insert into public.guest_sessions (token_hash, expires_at)
  values (repeat('3', 64), now() + interval '9 hours') returning id into v_s2;
  insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at, session_id, credential_kind, origin)
  values (repeat('d', 64), draft, 'arc.workflow.v1', now() + interval '9 hours', v_s2, 'derived', 'blank') returning id into v_c;
  select * into r from pg_temp.arc_rf_reserve(v_c, repeat('d', 64), v_user); perform pg_temp.arc_rf_succeed(r.run_id);
  insert into arc_test_results values ('40 signed-in success consumes 1',
    (select runs_consumed from public.ai_monthly_usage where user_id = v_user) = 1);
  select * into r from pg_temp.arc_rf_reserve(v_c, repeat('d', 64), v_user); v_fail := r.run_id;
  insert into arc_test_results values ('41 in-flight signed-in run reserves',
    (select runs_consumed from public.ai_monthly_usage where user_id = v_user) = 2);
  perform pg_temp.arc_rf_fail_response(v_fail);
  insert into arc_test_results values
    ('42 signed-in response_invalid releases',
     (select runs_consumed from public.ai_monthly_usage where user_id = v_user) = 1),
    ('43 signed-in runs never touch the guest bucket', public.arc_guest_session_usage(v_s2) = 0);
  begin
    perform public.arc_mark_ai_run_failure(v_fail, 'validating', 'response', 'response_invalid', 'x');
    insert into arc_test_results values ('44 double failure refused (no double refund)', false);
  exception when others then
    insert into arc_test_results values ('44 double failure refused (no double refund)',
      (select runs_consumed from public.ai_monthly_usage where user_id = v_user) = 1);
  end;
  -- 2 attempts so far; 18 more failures reach 20
  for i in 1..18 loop
    select * into r from pg_temp.arc_rf_reserve(v_c, repeat('d', 64), v_user);
    perform pg_temp.arc_rf_fail_response(r.run_id);
  end loop;
  select * into r from pg_temp.arc_rf_reserve(v_c, repeat('d', 64), v_user);
  insert into arc_test_results values
    ('45 authenticated ceiling 20 refuses with attempt_limit', not r.reserved and r.attempt_limited),
    ('46 visible monthly allowance unchanged by ceiling',
     r.remaining = 9 and (select runs_consumed from public.ai_monthly_usage where user_id = v_user) = 1);
end $$;

do $$
declare failures text;
begin
  select string_agg(assertion, E'\n') into failures from arc_test_results where not passed;
  if failures is not null then
    raise exception 'Allowance refund assertions failed:%', E'\n' || failures;
  end if;
end $$;

select assertion, passed from arc_test_results order by assertion;
rollback;
