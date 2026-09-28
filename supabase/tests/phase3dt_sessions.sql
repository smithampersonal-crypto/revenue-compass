-- ARC Package 3D-T — browser sessions, the shared guest allowance, legacy
-- lineage, save non-reset, security and lifecycle. Synthetic data only; runs
-- inside a rolled-back transaction. Every row must report passed = true.
begin;

create temporary table arc_test_results (assertion text, passed boolean not null) on commit drop;

-- Helper: one guest (or authenticated) run through the real reservation RPC,
-- then completed. Returns the reservation result.
create function pg_temp.arc_3dt_run(p_ws uuid, p_hash text, p_owner uuid default null)
returns table(reserved boolean, remaining integer)
language plpgsql as $$
declare
  v_run uuid := gen_random_uuid();
  v_r record;
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
  if v_r.reserved then
    update public.ai_runs set stage = 'succeeded', completed_at = now() where id = v_run;
  else
    update public.ai_runs set stage = 'preflight_failed', completed_at = now() where id = v_run;
  end if;
  reserved := v_r.reserved; remaining := v_r.remaining_allowance;
  return next;
end $$;

-- Security: browser roles cannot touch sessions or the usage helpers.
insert into arc_test_results values
  ('01 anon has no privileges on guest_sessions',
   not (has_table_privilege('anon', 'public.guest_sessions', 'select')
        or has_table_privilege('anon', 'public.guest_sessions', 'insert'))),
  ('02 authenticated has no privileges on guest_sessions',
   not (has_table_privilege('authenticated', 'public.guest_sessions', 'select')
        or has_table_privilege('authenticated', 'public.guest_sessions', 'update'))),
  ('03 browser roles cannot execute the usage helpers',
   not (has_function_privilege('anon', 'public.arc_guest_session_usage(uuid)', 'execute')
        or has_function_privilege('authenticated', 'public.arc_guest_workspace_usage(uuid)', 'execute'))),
  ('04 service_role can execute the usage helpers',
   has_function_privilege('service_role', 'public.arc_guest_workspace_usage(uuid)', 'execute'));

do $$
declare
  draft jsonb := '{"schemaVersion":"arc.workflow.v1","draft":{}}'::jsonb;
  s_hash text := repeat('1', 64);
  a_hash text := repeat('2', 64);
  b_hash text := repeat('3', 64);
  l_hash text := repeat('4', 64);
  l2_hash text := repeat('5', 64);
  foreign_hash text := repeat('6', 64);
  v_user uuid := '00000000-0000-4000-8000-0000000003d1';
  v_session uuid; v_foreign uuid;
  v_a uuid; v_b uuid; v_l uuid; v_l2 uuid;
  r record;
  v_before integer; v_monthly integer; ok boolean;
begin
  insert into auth.users (id, aud, role, email) values (v_user, 'authenticated', 'authenticated', '3dt@example.test');

  /* ------------------------------------------------ session quota */
  insert into public.guest_sessions (token_hash, expires_at)
  values (s_hash, now() + interval '9 hours') returning id into v_session;
  insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at,
                                       session_id, credential_kind, origin)
  values (a_hash, draft, 'arc.workflow.v1', now() + interval '9 hours', v_session, 'derived', 'blank')
  returning id into v_a;
  insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at,
                                       session_id, credential_kind, origin)
  values (b_hash, draft, 'arc.workflow.v1', now() + interval '9 hours', v_session, 'derived', 'blank')
  returning id into v_b;

  perform pg_temp.arc_3dt_run(v_a, a_hash);
  perform pg_temp.arc_3dt_run(v_a, a_hash);
  insert into arc_test_results values
    ('10 runs are stamped with the session',
     (select bool_and(guest_session_id = v_session) from public.ai_runs where guest_workspace_id = v_a)),
    ('11 B sees session usage 2 before ever running', public.arc_guest_workspace_usage(v_b) = 2),
    ('12 A and B report the same usage',
     public.arc_guest_workspace_usage(v_a) = public.arc_guest_workspace_usage(v_b));

  select * into r from pg_temp.arc_3dt_run(v_b, b_hash);
  insert into arc_test_results values
    ('13 B''s run succeeds leaving remaining 0', r.reserved and r.remaining = 0),
    ('14 session usage is 3 for every analysis',
     public.arc_guest_workspace_usage(v_a) = 3 and public.arc_guest_workspace_usage(v_b) = 3);
  select * into r from pg_temp.arc_3dt_run(v_a, a_hash);
  insert into arc_test_results values ('15 fourth run from A refused', not r.reserved);
  select * into r from pg_temp.arc_3dt_run(v_b, b_hash);
  insert into arc_test_results values ('16 fourth run from B refused', not r.reserved);

  /* ------------------------------------------ save does not reset */
  v_before := public.arc_guest_session_usage(v_session);
  perform public.arc_migrate_guest_workspace_v3(v_a, v_user, null, 'Synthetic Co', 'Synthetic', null);
  insert into arc_test_results values
    ('20 saving A leaves session usage unchanged', public.arc_guest_session_usage(v_session) = v_before),
    ('21 B keeps the same allowance after A is saved', public.arc_guest_workspace_usage(v_b) = 3),
    ('22 re-homed runs keep their session stamp',
     (select count(*) from public.ai_runs where guest_session_id = v_session and revision_id is not null and openai_started_at is not null) = 2),
    ('23 saving consumed no monthly allowance',
     not exists (select 1 from public.ai_monthly_usage where user_id = v_user));

  /* ------------------------------------- mixed-deployment legacy */
  -- Legacy workspace created by the old app: credential = cookie hash, no session.
  insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at)
  values (l_hash, draft, 'arc.workflow.v1', now() + interval '9 hours') returning id into v_l;
  perform pg_temp.arc_3dt_run(v_l, l_hash);
  insert into arc_test_results values
    ('30 legacy run has no session stamp',
     (select guest_session_id is null from public.ai_runs where guest_workspace_id = v_l)),
    ('31 unattached legacy keeps per-workspace fallback', public.arc_guest_workspace_usage(v_l) = 1);

  -- The new app lazily wraps it into a session, then re-keys it.
  select session_id into v_l2 from public.arc_resolve_guest_session(l_hash);
  insert into arc_test_results values
    ('32 lazy wrap attaches the legacy workspace',
     (select session_id from public.guest_workspaces where id = v_l) = v_l2);
  insert into arc_test_results values
    ('33 re-key succeeds', public.arc_upgrade_legacy_guest_workspace(l_hash, v_l, l2_hash));
  insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at,
                                       session_id, credential_kind, origin)
  values (foreign_hash, draft, 'arc.workflow.v1', now() + interval '9 hours', v_l2, 'derived', 'blank')
  returning id into v_b;
  insert into arc_test_results values
    ('34 the old run counts for a new analysis in the session', public.arc_guest_workspace_usage(v_b) = 1),
    ('35 run provenance was not rewritten',
     (select guest_session_id is null and guest_token_hash = l_hash from public.ai_runs where guest_workspace_id = v_l));
  perform pg_temp.arc_3dt_run(v_b, foreign_hash);
  perform pg_temp.arc_3dt_run(v_b, foreign_hash);
  select * into r from pg_temp.arc_3dt_run(v_b, foreign_hash);
  insert into arc_test_results values ('36 legacy run consumed shared allowance (4th refused)', not r.reserved);

  perform public.arc_migrate_guest_workspace_v3(v_l, v_user, null, 'Legacy Co', 'Legacy', null);
  insert into arc_test_results values
    ('37 legacy run still counts after it is saved', public.arc_guest_session_usage(v_l2) = 3);

  /* --------------------------- authenticated temporary analysis */
  insert into public.guest_sessions (token_hash, expires_at)
  values (repeat('7', 64), now() + interval '9 hours') returning id into v_foreign;
  insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at,
                                       session_id, credential_kind, origin)
  values (repeat('8', 64), draft, 'arc.workflow.v1', now() + interval '9 hours', v_foreign, 'derived', 'blank')
  returning id into v_a;
  select * into r from pg_temp.arc_3dt_run(v_a, repeat('8', 64), v_user);
  select runs_consumed into v_monthly from public.ai_monthly_usage where user_id = v_user;
  insert into arc_test_results values
    ('40 signed-in temporary run consumes the monthly allowance', r.reserved and v_monthly = 1),
    ('41 and not the guest bucket', public.arc_guest_session_usage(v_foreign) = 0);

  /* ------------------------------------------ security/lifecycle */
  -- Foreign-session access: a re-key under the wrong session is refused.
  insert into arc_test_results values
    ('50 foreign session cannot claim an analysis',
     not public.arc_upgrade_legacy_guest_workspace(s_hash, v_a, repeat('9', 64)));

  -- Source document in a temporary analysis, then expiry cleanup.
  insert into public.source_documents (guest_workspace_id, storage_bucket, storage_object_path,
                                       original_filename, display_name, sha256, byte_size, page_count)
  values (v_a, 'arc-source-documents', 'guest/' || v_a || '/doc.pdf', 'doc.pdf', 'doc.pdf',
          repeat('c', 64), 10, 1);
  update public.guest_sessions set expires_at = now() - interval '1 minute' where id = v_foreign;
  update public.guest_workspaces set expires_at = now() - interval '1 minute' where session_id = v_foreign;
  perform public.arc_delete_expired_guest_workspaces();
  insert into arc_test_results values
    ('51 expiry removes the temporary analyses',
     not exists (select 1 from public.guest_workspaces where session_id = v_foreign)),
    ('52 expiry removes the session', not exists (select 1 from public.guest_sessions where id = v_foreign)),
    ('53 source object deletion is queued',
     exists (select 1 from public.storage_deletion_queue
              where storage_object_path = 'guest/' || v_a || '/doc.pdf'));

  -- Account purge handles the current browser session.
  perform public.arc_purge_user_guest_data(v_user, s_hash);
  insert into arc_test_results values
    ('54 purge removes the current session', not exists (select 1 from public.guest_sessions where token_hash = s_hash)),
    ('55 purge removes that session''s analyses',
     not exists (select 1 from public.guest_workspaces where session_id = v_session));
end $$;

do $$
declare failures text;
begin
  select string_agg(assertion, E'\n') into failures from arc_test_results where not passed;
  if failures is not null then
    raise exception 'Package 3D-T assertions failed:%', E'\n' || failures;
  end if;
end $$;

select assertion, passed from arc_test_results order by assertion;
rollback;
