-- ARC Post-R2 live regression patch — autosave lock bounding (defect 4).
--
-- Proves the staged replacement of arc_save_draft_with_ai_reconciliation
-- bounds its wait on the owner row instead of blocking until the connection
-- pool is exhausted, and that a timed-out save writes NOTHING.
--
-- Contention needs a second, genuinely concurrent session, so the competing
-- holder runs over dblink. The fixture rows the holder must see are committed
-- through that same side connection and removed at the end; everything this
-- session writes stays inside the rolled-back transaction below.
--
-- The idle_in_transaction_session_timeout is asserted by reading the routine's
-- source rather than by sleeping 15s in the harness: a wall-clock idle test is
-- inherently flaky here. It is exercised by the controlled hosted verification
-- recorded in roadmap.md.
begin;

create extension if not exists dblink;

create temporary table arc_test_results (assertion text, passed boolean not null) on commit drop;

/* ---------------------------------------------------------- 01 surface */

insert into arc_test_results
select '01 the routine bounds how long it waits for the owner row',
       (select p.prosrc like '%lock_timeout%' and p.prosrc like '%3s%'
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'arc_save_draft_with_ai_reconciliation');

insert into arc_test_results
select '02 the routine bounds an abandoned in-flight save',
       (select p.prosrc like '%idle_in_transaction_session_timeout%' and p.prosrc like '%15s%'
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'arc_save_draft_with_ai_reconciliation');

insert into arc_test_results
select '03 the bounds are set before any validation or locking',
       (select strpos(p.prosrc, 'lock_timeout') < strpos(p.prosrc, 'arc_lock_ai_review_scope')
           and strpos(p.prosrc, 'lock_timeout') < strpos(p.prosrc, 'p_expected_lock_version is null')
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'arc_save_draft_with_ai_reconciliation');

insert into arc_test_results
select '04 it is still security definer with the same fixed search_path',
       (select p.prosecdef and array_to_string(p.proconfig, ',') like '%search_path=pg_catalog, public%'
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'arc_save_draft_with_ai_reconciliation');

insert into arc_test_results
select '05 only the service role may still execute it',
       (select has_function_privilege('service_role', p.oid, 'execute')
           and not has_function_privilege('anon', p.oid, 'execute')
           and not has_function_privilege('authenticated', p.oid, 'execute')
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'arc_save_draft_with_ai_reconciliation');

insert into arc_test_results
select '06 exactly one routine of this name exists',
       (select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'arc_save_draft_with_ai_reconciliation');

/* ------------------------------------------------------- 07 contention */

do $contention$
declare
  v_conn text := 'arc_lock_holder';
  v_dsn text;
  v_hash text := repeat('b', 64);
  v_guest uuid;
  v_run uuid := gen_random_uuid();
  v_lock integer;
  v_state jsonb;
  v_draft text;
  v_state_lock integer;
  v_events bigint;
  v_started timestamptz;
  v_elapsed numeric;
  v_code text;
begin
  v_dsn := format('dbname=%s port=%s host=%s user=%s',
                  current_database(), current_setting('port'),
                  split_part(current_setting('unix_socket_directories'), ',', 1),
                  current_user);
  perform dblink_connect(v_conn, v_dsn);

  -- Committed fixture: one temporary workspace with an AI sidecar, the exact
  -- production shape a guest autosave reconciles.
  perform dblink_exec(v_conn, format($f$
    insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at)
    values (%L, '{"transactionPriceInput":"120000"}'::jsonb, 'arc.workflow.v1',
            now() + interval '9 hours');
  $f$, v_hash));

  select g.id into v_guest from public.guest_workspaces g where g.token_hash = v_hash;

  perform dblink_exec(v_conn, format($f$
    insert into public.ai_runs (id, guest_workspace_id, guest_token_hash, quota_scope, stage,
                                source_set_fingerprint, pre_run_canonical_inputs, model,
                                reasoning_effort, prompt_version, output_schema_version,
                                guidance_registry_hash, openai_started_at, completed_at)
    values (%L, %L, %L, 'guest', 'succeeded', 'fp-post-r2', '{}'::jsonb,
            'm', 'high', 'p', 's', 'h', now(), now());
    insert into public.ai_analysis_state (guest_workspace_id, last_successful_run_id,
                                          source_set_fingerprint, field_provenance,
                                          object_provenance, tombstones, review_items)
    values (%L, %L, 'fp-post-r2', '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb);
  $f$, v_run, v_guest, v_hash, v_guest, v_run));

  -- A competing session holds the owner row, exactly as an abandoned
  -- in-flight autosave would.
  perform dblink_exec(v_conn, 'begin');
  perform * from dblink(v_conn, format(
    'select 1 from public.guest_workspaces where id = %L for update', v_guest)) as t(x integer);

  v_started := clock_timestamp();
  begin
    select s.lock_version into v_lock
      from public.arc_save_draft_with_ai_reconciliation(
        null, v_hash, null, v_guest, 1, '{"transactionPriceInput":"140000"}'::jsonb,
        'arc.workflow.v1',
        jsonb_build_object('reviewItems', '[]'::jsonb), '[]'::jsonb, null) s;
    v_code := 'none';
  exception when others then
    v_code := sqlstate;
  end;
  v_elapsed := extract(epoch from clock_timestamp() - v_started);

  insert into arc_test_results
  select '07 a contended save fails with 55P03 rather than waiting forever', v_code = '55P03';

  insert into arc_test_results
  select '08 it fails in bounded time', v_elapsed < 10;

  select g.draft_json ->> 'transactionPriceInput', g.lock_version
    into v_draft, v_lock
    from public.guest_workspaces g where g.id = v_guest;

  insert into arc_test_results
  select '09 the timed-out save left the canonical draft untouched', v_draft = '120000';

  insert into arc_test_results
  select '10 the timed-out save did not advance the owner lock', v_lock = 1;

  select s.review_items, s.lock_version into v_state, v_state_lock
    from public.ai_analysis_state s where s.guest_workspace_id = v_guest;

  insert into arc_test_results
  select '11 the timed-out save left the AI sidecar untouched',
         v_state = '[]'::jsonb and v_state_lock = 1;

  select count(*) into v_events
    from public.ai_review_events e where e.guest_workspace_id = v_guest;

  insert into arc_test_results
  select '12 the timed-out save appended no review event', v_events = 0;

  -- Release the competing holder; the very same save must now succeed.
  perform dblink_exec(v_conn, 'rollback');

  select s.lock_version into v_lock
    from public.arc_save_draft_with_ai_reconciliation(
      null, v_hash, null, v_guest, 1, '{"transactionPriceInput":"140000"}'::jsonb,
      'arc.workflow.v1',
      jsonb_build_object('reviewItems', '[]'::jsonb),
      jsonb_build_array(jsonb_build_object(
        'type', 'yellow_affirmed', 'reviewItemId', 'item-1',
        'targetKey', 'transactionPrice.input', 'section', 'step_3',
        'reviewFingerprint', 'fp-1')), null) s;

  insert into arc_test_results
  select '13 once the competing lock is released the same save succeeds', v_lock = 2;

  insert into arc_test_results
  select '14 the owner lock advanced exactly once',
         (select g.lock_version from public.guest_workspaces g where g.id = v_guest) = 2
     and (select g.draft_json ->> 'transactionPriceInput' from public.guest_workspaces g
           where g.id = v_guest) = '140000';

  insert into arc_test_results
  select '15 the reconciliation still appended exactly one audit event',
         (select count(*) from public.ai_review_events e
           where e.guest_workspace_id = v_guest) = 1;

  -- A stale expected lock is still an optimistic-lock conflict, not contention.
  begin
    perform s.lock_version
      from public.arc_save_draft_with_ai_reconciliation(
        null, v_hash, null, v_guest, 1, '{"transactionPriceInput":"150000"}'::jsonb,
        'arc.workflow.v1',
        jsonb_build_object('reviewItems', '[]'::jsonb), '[]'::jsonb, null) s;
    v_code := 'none';
  exception when others then
    v_code := sqlstate;
  end;

  insert into arc_test_results
  select '16 a stale expected lock still raises PT409', v_code = 'PT409';

  insert into arc_test_results
  select '17 the rejected stale save changed nothing',
         (select g.draft_json ->> 'transactionPriceInput' from public.guest_workspaces g
           where g.id = v_guest) = '140000'
     and (select g.lock_version from public.guest_workspaces g where g.id = v_guest) = 2;

  perform dblink_disconnect(v_conn);
end $contention$;

/* -------------------------------------------------------------- gate */

do $gate$
declare
  v_failed integer;
  v_names text;
begin
  select count(*), string_agg(assertion, '; ' order by assertion)
    into v_failed, v_names
  from arc_test_results where passed is not true;
  if v_failed > 0 then
    raise exception 'ARC SQL suite failed: % assertion(s) did not pass: %', v_failed, v_names;
  end if;
end $gate$;

rollback;

-- The fixture rows were committed over the side connection, so they are
-- removed here, after this session's transaction has released them.
delete from public.ai_analysis_state s
 using public.guest_workspaces g
 where g.id = s.guest_workspace_id and g.token_hash = repeat('b', 64);
delete from public.ai_review_events e
 using public.guest_workspaces g
 where g.id = e.guest_workspace_id and g.token_hash = repeat('b', 64);
delete from public.ai_runs r
 using public.guest_workspaces g
 where g.id = r.guest_workspace_id and g.token_hash = repeat('b', 64);
delete from public.guest_workspaces where token_hash = repeat('b', 64);
