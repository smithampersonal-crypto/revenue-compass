-- ARC Phase 9G — Task 4. Atomic autosave edit reconciliation.
--
-- Everything runs inside a rolled-back transaction. Every row of
-- arc_test_results must report passed = true.
begin;

create temporary table arc_test_results (assertion text, passed boolean not null) on commit drop;

/* ---------------------------------------------------------- 01 surface */

insert into arc_test_results
select '01 the autosave reconciliation routine exists',
       exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public'
                  and p.proname = 'arc_save_draft_with_ai_reconciliation');

insert into arc_test_results
select '02 it is security definer with a fixed search_path',
       (select p.prosecdef and array_to_string(p.proconfig, ',') like '%search_path=pg_catalog, public%'
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'arc_save_draft_with_ai_reconciliation');

insert into arc_test_results
select '03 no anonymous or signed-in caller may execute it',
       not exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'arc_save_draft_with_ai_reconciliation'
            and (has_function_privilege('anon', p.oid, 'execute')
                 or has_function_privilege('authenticated', p.oid, 'execute')));

insert into arc_test_results
select '04 the service role may execute it',
       (select has_function_privilege('service_role', p.oid, 'execute')
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'arc_save_draft_with_ai_reconciliation');

insert into arc_test_results
select '05 the review audit trail keeps its append-only privileges',
       has_table_privilege('service_role', 'public.ai_review_events', 'select')
   and has_table_privilege('service_role', 'public.ai_review_events', 'insert')
   and not has_table_privilege('service_role', 'public.ai_review_events', 'update')
   and not has_table_privilege('service_role', 'public.ai_review_events', 'delete')
   and not has_table_privilege('service_role', 'public.ai_review_events', 'truncate');

/* -------------------------------------------------------- 06 behaviour */

do $task4$
declare
  v_user uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_customer uuid;
  v_contract uuid;
  v_analysis uuid;
  v_rev uuid;
  v_rev2 uuid;
  v_contract2 uuid;
  v_analysis2 uuid;
  v_guest uuid;
  v_hash text := repeat('7', 64);
  v_run uuid := gen_random_uuid();
  v_run_g uuid := gen_random_uuid();
  v_lock integer;
  v_saved timestamptz;
  v_state_lock integer;
  v_items jsonb;
  v_before_state jsonb;
  v_next jsonb;
  v_events jsonb;
  n integer;
  ok boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          '9g4-a@example.test', '', now(), now(), now()),
         (v_other, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          '9g4-b@example.test', '', now(), now(), now());

  insert into public.customers (owner_user_id, name) values (v_user, 'Task 4 Customer')
    returning id into v_customer;
  insert into public.contracts (customer_id, title) values (v_customer, 'Task 4 Contract')
    returning id into v_contract;
  insert into public.analyses (contract_id) values (v_contract) returning id into v_analysis;
  insert into public.analysis_revisions (analysis_id, revision_number, canonical_inputs, schema_version)
  values (v_analysis, 1, '{"transactionPriceInput":"120000"}'::jsonb, 'arc.workflow.v1')
    returning id into v_rev;

  insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at)
  values (v_hash, '{"transactionPriceInput":"120000"}'::jsonb, 'arc.workflow.v1',
          now() + interval '9 hours')
    returning id into v_guest;

  insert into public.ai_runs (id, revision_id, quota_scope, stage, source_set_fingerprint,
                              pre_run_canonical_inputs, model, reasoning_effort, prompt_version,
                              output_schema_version, guidance_registry_hash, owner_user_id,
                              openai_started_at, completed_at)
  values (v_run, v_rev, 'authenticated', 'succeeded', 'fp-t4', '{}'::jsonb,
          'm', 'high', 'p', 's', 'h', v_user, now(), now());
  insert into public.ai_runs (id, guest_workspace_id, guest_token_hash, quota_scope, stage,
                              source_set_fingerprint, pre_run_canonical_inputs, model,
                              reasoning_effort, prompt_version, output_schema_version,
                              guidance_registry_hash, openai_started_at, completed_at)
  values (v_run_g, v_guest, v_hash, 'guest', 'succeeded', 'fp-t4', '{}'::jsonb,
          'm', 'high', 'p', 's', 'h', now(), now());

  v_items := jsonb_build_array(
    jsonb_build_object('id', 'rev-y', 'targetKey', 'transactionPrice.input', 'section', 'step_3',
                       'state', 'yellow', 'severity', 'yellow',
                       'reasonCode', 'accountant_affirmation_required', 'reason', 'Confirm.',
                       'guidanceIds', '[]'::jsonb, 'citations', '[]'::jsonb,
                       'valueFingerprint', 'vf-y', 'reviewFingerprint', 'rf-y',
                       'resolution', null, 'affirmedAt', null, 'affirmedMethod', null),
    jsonb_build_object('id', 'rev-r', 'targetKey', 'po:po-1.recognitionMethod', 'section', 'step_5',
                       'state', 'red', 'severity', 'red',
                       'reasonCode', 'engine_support_gap', 'reason', 'Decide.',
                       'guidanceIds', '[]'::jsonb, 'citations', '[]'::jsonb,
                       'valueFingerprint', 'vf-r', 'reviewFingerprint', 'rf-r',
                       'resolution', null, 'affirmedAt', null, 'affirmedMethod', null));

  insert into public.ai_analysis_state (revision_id, review_items, source_state,
                                        source_set_fingerprint, last_successful_run_id,
                                        acknowledged_source_fingerprint, source_acknowledged_at,
                                        field_provenance)
  values (v_rev, v_items, 'stale', repeat('a', 64), v_run, repeat('a', 64), now(),
          jsonb_build_object('transactionPrice.input',
            jsonb_build_object('state', 'ai_generated_untouched', 'semanticKey', 'price:total',
                               'lastAiRunId', v_run, 'valueFingerprint', 'baseline')));
  insert into public.ai_analysis_state (guest_workspace_id, review_items, source_state,
                                        last_successful_run_id)
  values (v_guest, v_items, 'current', v_run_g);

  -- The reconciled sidecar ARC computed from the authoritative pre-save draft.
  v_next := jsonb_build_array(
    (v_items -> 0) || jsonb_build_object(
      'state', 'resolved',
      'resolution', jsonb_build_object('kind', 'affirmed', 'at', '2027-03-01T00:00:00Z',
                                       'method', 'edited', 'reviewFingerprint', 'rf-y'),
      'affirmedAt', '2027-03-01T00:00:00Z', 'affirmedMethod', 'edited'),
    v_items -> 1);
  v_events := jsonb_build_array(
    jsonb_build_object('type', 'yellow_affirmed', 'reviewItemId', 'rev-y',
                       'targetKey', 'transactionPrice.input', 'section', 'step_3',
                       'severity', 'yellow', 'reviewFingerprint', 'rf-y'));

  /* ------------------------------------------- 06-11 authenticated save */

  select r.lock_version into v_lock from public.analysis_revisions r where r.id = v_rev;

  select s.lock_version, s.saved_at into v_lock, v_saved
    from public.arc_save_draft_with_ai_reconciliation(
      v_user, null, v_rev, null, 1,
      '{"transactionPriceInput":"150000"}'::jsonb, 'arc.workflow.v1',
      jsonb_build_object('fieldProvenance',
        jsonb_build_object('transactionPrice.input',
          jsonb_build_object('state', 'ai_generated_user_edited', 'semanticKey', 'price:total',
                             'lastAiRunId', v_run, 'valueFingerprint', 'baseline')),
        'objectProvenance', '{}'::jsonb, 'tombstones', '[]'::jsonb, 'reviewItems', v_next),
      v_events, v_user) s;

  insert into arc_test_results
  select '06 the canonical draft, the sidecar and the audit event commit together',
         v_lock = 2
     and (select r.canonical_inputs ->> 'transactionPriceInput' from public.analysis_revisions r
           where r.id = v_rev) = '150000'
     and (select s.review_items -> 0 ->> 'state' from public.ai_analysis_state s
           where s.revision_id = v_rev) = 'resolved'
     and exists (select 1 from public.ai_review_events e
                  where e.revision_id = v_rev and e.event_type = 'yellow_affirmed'
                    and e.review_item_id = 'rev-y' and e.review_fingerprint = 'rf-y');

  insert into arc_test_results
  select '07 the owner lock advanced exactly once',
         (select r.lock_version from public.analysis_revisions r where r.id = v_rev) = 2;

  insert into arc_test_results
  select '08 the editing accountant is the recorded actor',
         (select e.actor_kind = 'authenticated' and e.actor_user_id = v_user
            from public.ai_review_events e
           where e.revision_id = v_rev and e.event_type = 'yellow_affirmed'
           order by e.event_seq desc limit 1);

  insert into arc_test_results
  select '09 an accounting edit never changes source freshness or acknowledgment',
         (select s.source_state = 'stale'
             and s.source_set_fingerprint = repeat('a', 64)
             and s.acknowledged_source_fingerprint = repeat('a', 64)
            from public.ai_analysis_state s where s.revision_id = v_rev);

  insert into arc_test_results
  select '10 the last successful AI run is preserved',
         (select s.last_successful_run_id = v_run from public.ai_analysis_state s
           where s.revision_id = v_rev);

  insert into arc_test_results
  select '11 the red AI review issue is still open',
         (select s.review_items -> 1 ->> 'state' = 'red' from public.ai_analysis_state s
           where s.revision_id = v_rev);

  /* ------------------------------------------------ 12-14 stale caller */

  ok := false;
  begin
    perform public.arc_save_draft_with_ai_reconciliation(
      v_user, null, v_rev, null, 1, '{"transactionPriceInput":"999"}'::jsonb, 'arc.workflow.v1',
      jsonb_build_object('reviewItems', v_items), '[]'::jsonb, v_user);
  exception when others then
    ok := sqlstate = '40001';
  end;
  insert into arc_test_results select '12 a stale save is refused as a conflict', ok;

  insert into arc_test_results
  select '13 a refused save wrote nothing at all',
         (select r.canonical_inputs ->> 'transactionPriceInput' from public.analysis_revisions r
           where r.id = v_rev) = '150000'
     and (select r.lock_version from public.analysis_revisions r where r.id = v_rev) = 2
     and (select count(*) from public.ai_review_events e where e.revision_id = v_rev) = 1;

  ok := false;
  begin
    perform public.arc_save_draft_with_ai_reconciliation(
      v_other, null, v_rev, null, 2, '{"transactionPriceInput":"1"}'::jsonb, 'arc.workflow.v1',
      jsonb_build_object('reviewItems', v_items), '[]'::jsonb, v_other);
  exception when others then
    ok := sqlstate = '42501';
  end;
  insert into arc_test_results
  select '14 another account cannot autosave this analysis', ok
     and (select r.canonical_inputs ->> 'transactionPriceInput' from public.analysis_revisions r
           where r.id = v_rev) = '150000';

  /* -------------------------------------------- 15 one advance, many items */

  select s.lock_version into v_lock
    from public.arc_save_draft_with_ai_reconciliation(
      v_user, null, v_rev, null, 2, '{"transactionPriceInput":"160000"}'::jsonb, 'arc.workflow.v1',
      jsonb_build_object('reviewItems', v_items),
      jsonb_build_array(
        jsonb_build_object('type', 'review_item_reopened', 'reviewItemId', 'rev-y',
                           'targetKey', 'transactionPrice.input', 'section', 'step_3',
                           'severity', 'yellow', 'reviewFingerprint', 'rf-y'),
        jsonb_build_object('type', 'review_item_reopened', 'reviewItemId', 'rev-r',
                           'targetKey', 'po:po-1.recognitionMethod', 'section', 'step_5',
                           'severity', 'red', 'reviewFingerprint', 'rf-r')),
      v_user) s;

  select count(*) into n from public.ai_review_events e
   where e.revision_id = v_rev and e.event_type = 'review_item_reopened';
  insert into arc_test_results
  select '15 two reopened items still advance the shared lock exactly once',
         v_lock = 3 and n = 2
     and (select r.lock_version from public.analysis_revisions r where r.id = v_rev) = 3;

  insert into arc_test_results
  select '16 a reopen is attributed to the system, never to a person',
         not exists (select 1 from public.ai_review_events e
                      where e.event_type = 'review_item_reopened'
                        and (e.actor_kind <> 'system' or e.actor_user_id is not null));

  /* ----------------------------------------------- 17-18 unknown events */

  select s.review_items, s.lock_version into v_before_state, v_state_lock
    from public.ai_analysis_state s where s.revision_id = v_rev;
  select count(*) into n from public.ai_review_events e where e.revision_id = v_rev;

  ok := false;
  begin
    perform public.arc_save_draft_with_ai_reconciliation(
      v_user, null, v_rev, null, 3, '{"transactionPriceInput":"170000"}'::jsonb, 'arc.workflow.v1',
      jsonb_build_object('reviewItems', v_items),
      jsonb_build_array(jsonb_build_object('type', 'red_manually_resolved',
                                           'reviewItemId', 'rev-r')),
      v_user);
  exception when others then
    ok := sqlstate = '22023';
  end;
  insert into arc_test_results
  select '17 an unknown reconciliation event is refused', ok;

  -- The WHOLE transaction rolls back: draft, owner lock, sidecar
  -- reconciliation fields, sidecar lock and the audit trail alike.
  insert into arc_test_results
  select '18 the refused batch left the analysis untouched',
         (select r.canonical_inputs ->> 'transactionPriceInput' from public.analysis_revisions r
           where r.id = v_rev) = '160000'
     and (select r.lock_version from public.analysis_revisions r where r.id = v_rev) = 3
     and (select s.review_items from public.ai_analysis_state s
           where s.revision_id = v_rev) = v_before_state
     and (select s.lock_version from public.ai_analysis_state s
           where s.revision_id = v_rev) = v_state_lock
     and (select count(*) from public.ai_review_events e where e.revision_id = v_rev) = n;

  /* ---------------------------------------------------- 19-23 guest saves */

  ok := false;
  begin
    perform public.arc_save_draft_with_ai_reconciliation(
      null, repeat('8', 64), null, v_guest, 1, '{"transactionPriceInput":"1"}'::jsonb,
      'arc.workflow.v1', jsonb_build_object('reviewItems', v_items), '[]'::jsonb, null);
  exception when others then
    ok := sqlstate = '42501';
  end;
  insert into arc_test_results
  select '19 the wrong temporary credential writes nothing', ok
     and (select g.draft_json ->> 'transactionPriceInput' from public.guest_workspaces g
           where g.id = v_guest) = '120000';

  select s.lock_version into v_lock
    from public.arc_save_draft_with_ai_reconciliation(
      null, v_hash, null, v_guest, 1, '{"transactionPriceInput":"140000"}'::jsonb,
      'arc.workflow.v1', jsonb_build_object('reviewItems', v_next), v_events, null) s;

  insert into arc_test_results
  select '20 a valid temporary credential reconciles and advances its lock once',
         v_lock = 2
     and (select g.draft_json ->> 'transactionPriceInput' from public.guest_workspaces g
           where g.id = v_guest) = '140000'
     and (select g.lock_version from public.guest_workspaces g where g.id = v_guest) = 2;

  insert into arc_test_results
  select '21 an anonymous visitor is recorded as a temporary-workspace actor',
         (select e.actor_kind = 'guest' and e.actor_user_id is null
            from public.ai_review_events e
           where e.guest_workspace_id = v_guest order by e.event_seq desc limit 1);

  select s.lock_version into v_lock
    from public.arc_save_draft_with_ai_reconciliation(
      null, v_hash, null, v_guest, 2, '{"transactionPriceInput":"145000"}'::jsonb,
      'arc.workflow.v1', jsonb_build_object('reviewItems', v_next), v_events, v_user) s;

  insert into arc_test_results
  select '22 a signed-in accountant inside a temporary workspace is the named actor',
         (select e.actor_kind = 'authenticated' and e.actor_user_id = v_user
            from public.ai_review_events e
           where e.guest_workspace_id = v_guest order by e.event_seq desc limit 1);

  update public.guest_workspaces set expires_at = now() - interval '1 minute' where id = v_guest;
  ok := false;
  begin
    perform public.arc_save_draft_with_ai_reconciliation(
      null, v_hash, null, v_guest, 3, '{"transactionPriceInput":"1"}'::jsonb, 'arc.workflow.v1',
      jsonb_build_object('reviewItems', v_items), '[]'::jsonb, null);
  exception when others then
    ok := sqlstate = '42501';
  end;
  insert into arc_test_results
  select '23 an expired temporary workspace writes nothing', ok
     and (select g.draft_json ->> 'transactionPriceInput' from public.guest_workspaces g
           where g.id = v_guest) = '145000';

  /* ----------------------------------- 25 an analysis with no AI sidecar */

  insert into public.contracts (customer_id, title) values (v_customer, 'Task 4 Manual Contract')
    returning id into v_contract2;
  insert into public.analyses (contract_id) values (v_contract2) returning id into v_analysis2;
  insert into public.analysis_revisions (analysis_id, revision_number, canonical_inputs, schema_version)
  values (v_analysis2, 1, '{"transactionPriceInput":"10"}'::jsonb, 'arc.workflow.v1')
    returning id into v_rev2;

  select s.lock_version into v_lock
    from public.arc_save_draft_with_ai_reconciliation(
      v_user, null, v_rev2, null, 1, '{"transactionPriceInput":"180000"}'::jsonb, 'arc.workflow.v1',
      jsonb_build_object('reviewItems', v_items), v_events, v_user) s;

  insert into arc_test_results
  select '25 an analysis with no AI sidecar saves its draft and appends no event',
         v_lock = 2
     and (select r.canonical_inputs ->> 'transactionPriceInput' from public.analysis_revisions r
           where r.id = v_rev2) = '180000'
     and not exists (select 1 from public.ai_review_events where revision_id = v_rev2);

  /* ------------------------------------------------- 26 finalized safety */

  update public.analysis_revisions
     set status = 'finalized', finalized_at = now(), engine_outputs = '{}'::jsonb,
         reconciliation_snapshot = '{}'::jsonb, engine_version = 'arc.engine.test',
         lock_version = lock_version + 1
   where id = v_rev;
  ok := false;
  begin
    perform public.arc_save_draft_with_ai_reconciliation(
      v_user, null, v_rev, null, 4, '{"transactionPriceInput":"1"}'::jsonb, 'arc.workflow.v1',
      jsonb_build_object('reviewItems', v_items), '[]'::jsonb, v_user);
  exception when others then
    ok := sqlstate = '42501';
  end;
  insert into arc_test_results
  select '26 a finalized revision can never be autosaved', ok
     and (select r.canonical_inputs ->> 'transactionPriceInput' from public.analysis_revisions r
           where r.id = v_rev) = '160000';
end $task4$;

select assertion, passed from arc_test_results order by assertion;
select count(*) filter (where passed is not true) as failures, count(*) as total from arc_test_results;

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
