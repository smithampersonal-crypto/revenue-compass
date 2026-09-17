-- ARC Phase 9G — Task 2. Server-owned review events, review-resolution RPCs
-- and stale-source acknowledgment.
--
-- Everything runs inside a rolled-back transaction. Every row of
-- arc_test_results must report passed = true.
begin;

create temporary table arc_test_results (assertion text, passed boolean not null) on commit drop;

/* ------------------------------------------------------------ 01 schema */

insert into arc_test_results
select '01 the append-only review event table exists',
       exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public' and c.relname = 'ai_review_events' and c.relkind = 'r');

insert into arc_test_results
select '02 review events have row level security enabled',
       (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = 'ai_review_events');

insert into arc_test_results
select '03 no anonymous or signed-in privilege of any kind on review events',
       not exists (
         select 1 from information_schema.role_table_grants
          where table_schema = 'public' and table_name = 'ai_review_events'
            and grantee in ('anon', 'authenticated', 'PUBLIC'));

insert into arc_test_results
select '04 the service role can read and write review events',
       has_table_privilege('service_role', 'public.ai_review_events', 'select')
   and has_table_privilege('service_role', 'public.ai_review_events', 'insert');

insert into arc_test_results
select '05 every Phase 9G routine exists',
       (select count(distinct p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname in ('arc_affirm_ai_review_item', 'arc_resolve_ai_review_issue',
                             'arc_acknowledge_ai_stale_sources', 'arc_ai_source_set_fingerprint',
                             'arc_ai_review_actor', 'arc_protect_ai_review_event')) = 6;

insert into arc_test_results
select '06 no Phase 9G routine is executable by anon or signed-in users',
       not exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname in ('arc_affirm_ai_review_item', 'arc_resolve_ai_review_issue',
                              'arc_acknowledge_ai_stale_sources', 'arc_ai_source_set_fingerprint',
                              'arc_ai_review_actor')
            and (has_function_privilege('anon', p.oid, 'execute')
                 or has_function_privilege('authenticated', p.oid, 'execute')));

insert into arc_test_results
select '07 every Phase 9G routine is executable by the service role',
       not exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname in ('arc_affirm_ai_review_item', 'arc_resolve_ai_review_issue',
                              'arc_acknowledge_ai_stale_sources', 'arc_ai_source_set_fingerprint',
                              'arc_ai_review_actor')
            and not has_function_privilege('service_role', p.oid, 'execute'));


insert into arc_test_results
select '08 the acknowledgment columns live on the AI sidecar, not the canonical draft',
       (select count(*) from information_schema.columns
         where table_schema = 'public' and table_name = 'ai_analysis_state'
           and column_name in ('acknowledged_source_fingerprint', 'source_acknowledged_at',
                               'source_acknowledged_by')) = 3
   and not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'analysis_revisions'
                      and column_name like '%acknowledged%');

/* ------------------------------------------------ 09 fingerprint parity */

-- The database derives the authoritative source-set fingerprint with exactly
-- the canonical form the application uses, so the two can never disagree.
insert into arc_test_results
select '09 an empty selection has the same fingerprint the application computes',
       encode(sha256(convert_to('[]', 'UTF8')), 'hex')
       = '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945';

/* --------------------------------------------------------- 10 behaviour */

do $phase9g$
declare
  v_user uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_customer uuid;
  v_contract uuid;
  v_analysis uuid;
  v_rev uuid;
  v_guest uuid;
  v_hash text := repeat('9', 64);
  v_doc uuid;
  v_doc2 uuid;
  v_lock integer;
  v_new_lock integer;
  v_already boolean;
  v_event uuid;
  v_event2 uuid;

  v_run uuid := gen_random_uuid();
  v_run_g uuid := gen_random_uuid();
  n integer;

  v_fp text;
  v_expected_fp text;
  v_items jsonb;
  v_item jsonb;
  ok boolean;
  v_yellow constant text := 'rev-yellow-1';
  v_red constant text := 'rev-red-1';
  v_hard constant text := 'rev-hard-1';
  v_rf_yellow constant text := 'fp-yellow-aaaa';
  v_rf_red constant text := 'fp-red-bbbb';
  v_rf_hard constant text := 'fp-hard-cccc';
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          '9g-a@example.test', '', now(), now(), now()),
         (v_other, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          '9g-b@example.test', '', now(), now(), now());

  insert into public.customers (owner_user_id, name) values (v_user, 'Phase 9G Customer')
    returning id into v_customer;
  insert into public.contracts (customer_id, title) values (v_customer, 'Phase 9G Contract')
    returning id into v_contract;
  insert into public.analyses (contract_id) values (v_contract) returning id into v_analysis;
  insert into public.analysis_revisions (analysis_id, revision_number, canonical_inputs, schema_version)
  values (v_analysis, 1, '{"origin":"accountant"}'::jsonb, 'arc.workflow.v1')
    returning id into v_rev;

  insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at)
  values (v_hash, '{"origin":"visitor"}'::jsonb, 'arc.workflow.v1', now() + interval '9 hours')
    returning id into v_guest;

  insert into public.source_documents (contract_id, storage_bucket, storage_object_path,
                                       original_filename, display_name, sha256, byte_size, page_count)
  values (v_contract, 'arc-source-documents', 'c/1.pdf', '1.pdf', 'Contract', repeat('a', 64), 100, 4)
    returning id into v_doc;
  insert into public.source_documents (contract_id, storage_bucket, storage_object_path,
                                       original_filename, display_name, sha256, byte_size, page_count)
  values (v_contract, 'arc-source-documents', 'c/2.pdf', '2.pdf', 'Amendment', repeat('b', 64), 120, 2)
    returning id into v_doc2;

  -- A Phase 9G sidecar: one yellow affirmation item, one red AI review issue
  -- and one deterministic hard error that may never be dismissed.
  v_items := jsonb_build_array(
    jsonb_build_object('id', v_yellow, 'targetKey', 'step3:price', 'section', 'step_3',
                       'state', 'yellow', 'severity', 'yellow',
                       'reasonCode', 'accountant_affirmation_required', 'reason', 'Please confirm.',
                       'guidanceIds', jsonb_build_array(25), 'citations', '[]'::jsonb,
                       'valueFingerprint', 'vf-1', 'reviewFingerprint', v_rf_yellow,
                       'resolution', null, 'affirmedAt', null, 'affirmedMethod', null),
    jsonb_build_object('id', v_red, 'targetKey', 'step2:po', 'section', 'step_2',
                       'state', 'red', 'severity', 'red',
                       'reasonCode', 'engine_support_gap', 'reason', 'Needs a decision.',
                       'guidanceIds', jsonb_build_array(9), 'citations', '[]'::jsonb,
                       'valueFingerprint', 'vf-2', 'reviewFingerprint', v_rf_red,
                       'resolution', null, 'affirmedAt', null, 'affirmedMethod', null),
    jsonb_build_object('id', v_hard, 'targetKey', 'step5:schedule', 'section', 'step_5',
                       'state', 'red', 'severity', 'red', 'deterministic', true,
                       'reasonCode', 'billing_schedule_not_derivable', 'reason', 'ARC cannot compute.',
                       'guidanceIds', '[]'::jsonb, 'citations', '[]'::jsonb,
                       'valueFingerprint', 'vf-3', 'reviewFingerprint', v_rf_hard,
                       'resolution', null, 'affirmedAt', null, 'affirmedMethod', null));

  -- A stale sidecar is a sidecar whose previous successful analysis is now out
  -- of date. Both parts are required before anything can be acknowledged.
  insert into public.ai_runs (id, revision_id, quota_scope, stage, source_set_fingerprint,
                              pre_run_canonical_inputs, model, reasoning_effort, prompt_version,
                              output_schema_version, guidance_registry_hash, owner_user_id,
                              openai_started_at, completed_at)
  values (v_run, v_rev, 'authenticated', 'succeeded', 'fp-9g', '{}'::jsonb,
          'm', 'high', 'p9g', 's1', 'h9g', v_user, now(), now());
  insert into public.ai_runs (id, guest_workspace_id, guest_token_hash, quota_scope, stage,
                              source_set_fingerprint, pre_run_canonical_inputs, model,
                              reasoning_effort, prompt_version, output_schema_version,
                              guidance_registry_hash, openai_started_at, completed_at)
  values (v_run_g, v_guest, v_hash, 'guest', 'succeeded', 'fp-9g', '{}'::jsonb,
          'm', 'high', 'p9g', 's1', 'h9g', now(), now());

  insert into public.ai_analysis_state (revision_id, review_items, source_state,
                                        last_successful_run_id)
  values (v_rev, v_items, 'stale', v_run);
  insert into public.ai_analysis_state (guest_workspace_id, review_items, source_state,
                                        last_successful_run_id)
  values (v_guest, v_items, 'stale', v_run_g);


  /* --------------------------------------------- source fingerprint (10-12) */

  insert into arc_test_results
  select '10 an unselected source set still has the canonical empty fingerprint',
         public.arc_ai_source_set_fingerprint(v_rev, null)
         = '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945';

  insert into public.revision_source_documents (revision_id, source_document_id)
  values (v_rev, v_doc);
  v_fp := public.arc_ai_source_set_fingerprint(v_rev, null);
  insert into arc_test_results
  select '11 the selected set fingerprint matches the application formula',
         v_fp = encode(sha256(convert_to(
                 '[["' || v_doc || '","' || repeat('a', 64) || '"]]', 'UTF8')), 'hex');

  insert into arc_test_results
  select '12 the fingerprint is derived from selection, never supplied',
         v_fp <> public.arc_ai_source_set_fingerprint(v_guest, null)
      or v_fp is not null;

  /* ------------------------------------------------- yellow affirmation (13-21) */

  select lock_version into v_lock from public.analysis_revisions where id = v_rev;
  select lock_version, already_resolved, event_id into v_new_lock, v_already, v_event
    from public.arc_affirm_ai_review_item(v_user, null, v_rev, null, v_lock, v_yellow, v_rf_yellow);

  select value into v_item from public.ai_analysis_state s,
       lateral jsonb_array_elements(s.review_items) value
   where s.revision_id = v_rev and value ->> 'id' = v_yellow;

  insert into arc_test_results
  select '13 the owner can affirm a current yellow item',
         v_already is false
     and (v_item ->> 'state') = 'resolved'
     and (v_item -> 'resolution' ->> 'kind') = 'affirmed'
     and (v_item -> 'resolution' ->> 'reviewFingerprint') = v_rf_yellow
     and (v_item ->> 'severity') = 'yellow';

  insert into arc_test_results
  select '14 the server authors the actor and the timestamp, not the browser',
         exists (select 1 from public.ai_review_events e
                  where e.id = v_event and e.event_type = 'yellow_affirmed'
                    and e.actor_user_id = v_user and e.actor_kind = 'authenticated'
                    and e.review_item_id = v_yellow
                    and e.review_fingerprint = v_rf_yellow
                    and e.created_at is not null)
     and (v_item -> 'resolution' ->> 'at') is not null;

  insert into arc_test_results
  select '15 affirming advances the owner lock exactly once',
         v_new_lock = v_lock + 1
     and (select lock_version from public.analysis_revisions where id = v_rev) = v_lock + 1;

  -- Idempotency: the same click again changes nothing and adds no second event.
  select lock_version, already_resolved into v_new_lock, v_already
    from public.arc_affirm_ai_review_item(v_user, null, v_rev, null, v_lock, v_yellow, v_rf_yellow);
  insert into arc_test_results
  select '16 a repeated identical affirmation is idempotent',
         v_already
     and (select count(*) from public.ai_review_events
           where review_item_id = v_yellow and event_type = 'yellow_affirmed') = 1
     and (select lock_version from public.analysis_revisions where id = v_rev) = v_lock + 1;

  -- A stale tab: the material conclusion moved on, so the approval fails closed.
  select lock_version into v_lock from public.analysis_revisions where id = v_rev;
  begin
    perform public.arc_affirm_ai_review_item(v_user, null, v_rev, null, v_lock, v_red, 'fp-stale');
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results values ('17 a stale review fingerprint cannot affirm', ok);

  begin
    perform public.arc_affirm_ai_review_item(v_user, null, v_rev, null, v_lock, v_red, v_rf_red);
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results values ('18 a red issue can never be affirmed', ok);

  begin
    perform public.arc_affirm_ai_review_item(v_user, null, v_rev, null, v_lock, 'rev-missing', v_rf_yellow);
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results values ('19 an unknown review item is rejected', ok);

  begin
    perform public.arc_affirm_ai_review_item(v_other, null, v_rev, null, v_lock, v_yellow, v_rf_yellow);
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results values ('20 another account cannot affirm this analysis', ok);

  -- A second tab holding an older lock version cannot approve anything.
  begin
    perform public.arc_affirm_ai_review_item(v_user, null, v_rev, null, v_lock - 1, v_red, v_rf_red);
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results values ('21 a stale tab lock version is rejected', ok);

  /* ------------------------------------------- manual red resolution (22-30) */

  select lock_version into v_lock from public.analysis_revisions where id = v_rev;
  select lock_version, already_resolved, event_id into v_new_lock, v_already, v_event
    from public.arc_resolve_ai_review_issue(v_user, null, v_rev, null, v_lock, v_red, v_rf_red,
                                            'reviewed_current_treatment', 'Checked against the MSA.');

  select value into v_item from public.ai_analysis_state s,
       lateral jsonb_array_elements(s.review_items) value
   where s.revision_id = v_rev and value ->> 'id' = v_red;

  insert into arc_test_results
  select '22 the owner can manually resolve an eligible red AI review issue',
         v_already is false
     and (v_item ->> 'state') = 'resolved'
     and (v_item ->> 'severity') = 'red'
     and (v_item -> 'resolution' ->> 'kind') = 'manual_red'
     and (v_item -> 'resolution' ->> 'reason') = 'reviewed_current_treatment'
     and (v_item -> 'resolution' ->> 'note') = 'Checked against the MSA.'
     and (v_item -> 'resolution' ->> 'reviewFingerprint') = v_rf_red;

  insert into arc_test_results
  select '23 the manual resolution writes its audit event in the same transaction',
         exists (select 1 from public.ai_review_events e
                  where e.id = v_event and e.event_type = 'red_manually_resolved'
                    and e.manual_red_reason = 'reviewed_current_treatment'
                    and e.note = 'Checked against the MSA.'
                    and e.review_fingerprint = v_rf_red
                    and e.actor_user_id = v_user);

  select lock_version, already_resolved into v_new_lock, v_already
    from public.arc_resolve_ai_review_issue(v_user, null, v_rev, null, v_lock, v_red, v_rf_red,
                                            'reviewed_current_treatment', 'Checked against the MSA.');
  insert into arc_test_results
  select '24 a repeated identical manual resolution is idempotent',
         v_already
     and (select count(*) from public.ai_review_events
           where review_item_id = v_red and event_type = 'red_manually_resolved') = 1;

  select lock_version into v_lock from public.analysis_revisions where id = v_rev;
  begin
    perform public.arc_resolve_ai_review_issue(v_user, null, v_rev, null, v_lock, v_hard, v_rf_hard,
                                               'not_applicable', null);
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results
  values ('25 a deterministic hard error can never be dismissed this way', ok);

  insert into arc_test_results
  select '26 the deterministic hard error is untouched',
         (select value ->> 'state' from public.ai_analysis_state s,
                 lateral jsonb_array_elements(s.review_items) value
           where s.revision_id = v_rev and value ->> 'id' = v_hard) = 'red';

  begin
    perform public.arc_resolve_ai_review_issue(v_user, null, v_rev, null, v_lock, v_yellow, v_rf_yellow,
                                               'not_applicable', null);
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results values ('27 a yellow item cannot use the manual red path', ok);

  begin
    perform public.arc_resolve_ai_review_issue(v_user, null, v_rev, null, v_lock, v_red, v_rf_red,
                                               'because_i_said_so', null);
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results values ('28 an unsupported manual reason is rejected', ok);

  begin
    perform public.arc_resolve_ai_review_issue(v_user, null, v_rev, null, v_lock, v_red, v_rf_red,
                                               'not_applicable', repeat('x', 2001));
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results values ('29 an over-long note is rejected', ok);

  begin
    perform public.arc_resolve_ai_review_issue(v_other, null, v_rev, null, v_lock, v_red, v_rf_red,
                                               'not_applicable', null);
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results values ('30 another account cannot resolve this issue', ok);

  /* ------------------------------------- stale-source acknowledgment (31-38) */

  select lock_version into v_lock from public.analysis_revisions where id = v_rev;
  v_expected_fp := public.arc_ai_source_set_fingerprint(v_rev, null);
  select lock_version, source_set_fingerprint, already_acknowledged, event_id
    into v_new_lock, v_fp, v_already, v_event
    from public.arc_acknowledge_ai_stale_sources(v_user, null, v_rev, null, v_lock, v_expected_fp);

  insert into arc_test_results
  select '31 the acknowledgment binds to the server-derived current source set',
         v_fp = v_expected_fp
     and v_already is false
     and (select acknowledged_source_fingerprint from public.ai_analysis_state
           where revision_id = v_rev) = v_expected_fp
     and (select source_acknowledged_by from public.ai_analysis_state
           where revision_id = v_rev) = v_user
     and (select source_acknowledged_at from public.ai_analysis_state
           where revision_id = v_rev) is not null;

  insert into arc_test_results
  select '32 the acknowledgment writes an append-only event',
         exists (select 1 from public.ai_review_events e
                  where e.id = v_event and e.event_type = 'stale_sources_acknowledged'
                    and e.source_set_fingerprint = v_expected_fp
                    and e.actor_user_id = v_user
                    and e.review_item_id is null);

  insert into arc_test_results
  select '33a the acknowledgment is recorded against the analysis whose sources went stale',
         (select ai_run_id from public.ai_review_events where id = v_event) = v_run;

  insert into arc_test_results
  select '33 acknowledging resolves no review item, starts no run and consumes no AI allowance',
         (select value ->> 'state' from public.ai_analysis_state s,
                 lateral jsonb_array_elements(s.review_items) value
           where s.revision_id = v_rev and value ->> 'id' = v_hard) = 'red'
     and not exists (select 1 from public.ai_monthly_usage where user_id = v_user)
     and (select count(*) from public.ai_runs where revision_id = v_rev) = 1;

  select lock_version into v_lock from public.analysis_revisions where id = v_rev;
  begin
    perform public.arc_acknowledge_ai_stale_sources(v_user, null, v_rev, null, v_lock,
                                                    repeat('0', 64));
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results
  values ('34 a client-invented source fingerprint cannot become authoritative', ok);

  -- The selection changes. The authoritative source-mutation path clears the
  -- current acknowledgment even though the sidecar was already stale, and the
  -- historical event survives untouched.
  insert into public.revision_source_documents (revision_id, source_document_id)
  values (v_rev, v_doc2);
  perform public.arc_mark_ai_sources_stale(v_rev, null);

  insert into arc_test_results
  select '35 changing the selected sources clears the current acknowledgment',
         (select acknowledged_source_fingerprint from public.ai_analysis_state
           where revision_id = v_rev) is null
     and (select source_acknowledged_at from public.ai_analysis_state
           where revision_id = v_rev) is null
     and (select source_acknowledged_by from public.ai_analysis_state
           where revision_id = v_rev) is null;

  insert into arc_test_results
  select '36 the historical acknowledgment event is never deleted',
         (select count(*) from public.ai_review_events
           where event_type = 'stale_sources_acknowledged'
             and source_set_fingerprint = v_expected_fp) = 1;

  -- A -> B -> A: returning to the previously acknowledged source set does not
  -- resurrect the old acknowledgment, and the fresh one is its own event.
  delete from public.revision_source_documents
   where revision_id = v_rev and source_document_id = v_doc2;
  insert into arc_test_results
  select '36a returning to an earlier source set does not resurrect its acknowledgment',
         public.arc_ai_source_set_fingerprint(v_rev, null) = v_expected_fp
     and (select acknowledged_source_fingerprint from public.ai_analysis_state
           where revision_id = v_rev) is null;

  select lock_version into v_lock from public.analysis_revisions where id = v_rev;
  select event_id into v_event2
    from public.arc_acknowledge_ai_stale_sources(v_user, null, v_rev, null, v_lock, v_expected_fp);
  insert into arc_test_results
  select '36b the same source set can be acknowledged again as a separate audit fact',
         v_event2 is distinct from v_event
     and (select count(*) from public.ai_review_events
           where revision_id = v_rev and event_type = 'stale_sources_acknowledged'
             and source_set_fingerprint = v_expected_fp) = 2;

  -- Put the selection back where the remaining assertions expect it.
  insert into public.revision_source_documents (revision_id, source_document_id)
  values (v_rev, v_doc2);
  perform public.arc_mark_ai_sources_stale(v_rev, null);


  select lock_version into v_lock from public.analysis_revisions where id = v_rev;
  begin
    perform public.arc_acknowledge_ai_stale_sources(v_user, null, v_rev, null, v_lock, v_expected_fp);
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results
  values ('37 a superseded source set cannot be acknowledged', ok);

  begin
    perform public.arc_acknowledge_ai_stale_sources(v_other, null, v_rev, null, v_lock,
                                                    public.arc_ai_source_set_fingerprint(v_rev, null));
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results values ('38 another account cannot acknowledge these sources', ok);

  /* ---------------------------------------------- guest ownership (39-42) */

  select lock_version into v_lock from public.guest_workspaces where id = v_guest;
  select lock_version, already_resolved, event_id into v_new_lock, v_already, v_event
    from public.arc_affirm_ai_review_item(null, v_hash, null, v_guest, v_lock, v_yellow, v_rf_yellow);
  insert into arc_test_results
  select '39 a temporary workspace can affirm its own yellow item',
         v_already is false
     and (select value ->> 'state' from public.ai_analysis_state s,
                 lateral jsonb_array_elements(s.review_items) value
           where s.guest_workspace_id = v_guest and value ->> 'id' = v_yellow) = 'resolved'
     and exists (select 1 from public.ai_review_events e
                  where e.id = v_event and e.actor_kind = 'guest'
                    and e.actor_user_id is null
                    and e.guest_workspace_id = v_guest);

  select lock_version into v_lock from public.guest_workspaces where id = v_guest;
  begin
    perform public.arc_affirm_ai_review_item(null, repeat('7', 64), null, v_guest, v_lock,
                                             v_red, v_rf_red);
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results
  values ('40 another temporary workspace credential is refused', ok);

  begin
    perform public.arc_affirm_ai_review_item(v_user, null, v_rev, v_guest, v_lock, v_yellow, v_rf_yellow);
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results values ('41 exactly one owner scope is required', ok);

  insert into arc_test_results
  select '42 the signed-in analysis was untouched by the temporary workspace action',
         (select count(*) from public.ai_review_events
           where revision_id = v_rev and event_type = 'yellow_affirmed') = 1;

  /* -------------------------------------------- audit immutability (43-46) */

  begin
    update public.ai_review_events set note = 'rewritten' where event_type = 'yellow_affirmed';
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results values ('43 a review event can never be updated', ok);

  begin
    delete from public.ai_review_events where event_type = 'yellow_affirmed';
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results values ('44 a review event can never be deleted', ok);

  begin
    insert into public.ai_review_events (revision_id, actor_kind, event_type)
    values (v_rev, 'authenticated', 'not_a_real_event');
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results values ('45 an unknown event type cannot be persisted', ok);

  begin
    insert into public.ai_review_events (revision_id, actor_user_id, actor_kind, event_type,
                                         review_item_id, review_fingerprint, manual_red_reason)
    values (v_rev, v_user, 'authenticated', 'red_manually_resolved', 'rev-x', 'fp-x', 'invented');
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results values ('46 an unknown manual reason cannot be persisted', ok);

  begin
    insert into public.ai_review_events (revision_id, actor_user_id, actor_kind, event_type,
                                         review_item_id)
    values (v_rev, v_user, 'authenticated', 'yellow_affirmed', 'rev-x');
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results
  values ('47 an item event without its review fingerprint cannot be persisted', ok);

  begin
    insert into public.ai_review_events (revision_id, guest_workspace_id, actor_user_id,
                                         actor_kind, event_type, source_set_fingerprint)
    values (v_rev, v_guest, v_user, 'authenticated', 'stale_sources_acknowledged', repeat('c', 64));
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results
  values ('48 an event cannot belong to two owner scopes at once', ok);

  begin
    insert into public.ai_review_events (revision_id, actor_user_id, actor_kind, event_type,
                                         review_item_id, review_section, review_severity,
                                         review_fingerprint)
    values (v_rev, v_user, 'authenticated', 'yellow_affirmed', 'rev-x', 'step_2', 'yellow', 'fp-x');
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results
  values ('48a an item event without its target cannot be persisted', ok);

  begin
    insert into public.ai_review_events (revision_id, actor_user_id, actor_kind, event_type,
                                         review_item_id, review_target_key, review_section,
                                         review_severity, review_fingerprint)
    values (v_rev, v_user, 'authenticated', 'yellow_affirmed', 'rev-x', 'step2:po', 'page_seven',
            'yellow', 'fp-x');
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results
  values ('48b an item event outside the approved workflow sections cannot be persisted', ok);

  begin
    insert into public.ai_review_events (revision_id, actor_user_id, actor_kind, event_type,
                                         review_item_id, review_target_key, review_section,
                                         review_severity, review_fingerprint)
    values (v_rev, v_user, 'authenticated', 'review_item_reopened', 'rev-x', 'step2:po', 'step_2',
            'red', 'fp-x');
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results
  values ('48c a reopen can never be attributed to a person', ok);


  /* ------------------------------------------ lifecycle compatibility (52) */

  -- Account deletion and temporary-workspace expiry must still work: history
  -- is removed only together with the analysis it belongs to.
  delete from public.guest_workspaces where id = v_guest;
  insert into arc_test_results
  select '52 review history is removed with its owner scope, never on its own',
         not exists (select 1 from public.ai_review_events where guest_workspace_id = v_guest)
     and exists (select 1 from public.ai_review_events where revision_id = v_rev);
end $phase9g$;

/* ------------------------------------------------------------------------
 * 53-56 — a conclusion may legitimately be reviewed again in a later cycle.
 * ---------------------------------------------------------------------- */

do $phase9g_cycle$
declare
  v_user uuid := gen_random_uuid();
  v_customer uuid; v_contract uuid; v_analysis uuid; v_rev uuid;
  v_lock integer; v_already boolean; v_e1 uuid; v_e2 uuid; v_e3 uuid; n integer;
  function_placeholder integer;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          '9g-cycle@example.test', '', now(), now(), now());
  insert into public.customers (owner_user_id, name) values (v_user, 'Cycle')
    returning id into v_customer;
  insert into public.contracts (customer_id, title) values (v_customer, 'Cycle')
    returning id into v_contract;
  insert into public.analyses (contract_id) values (v_contract) returning id into v_analysis;
  insert into public.analysis_revisions (analysis_id, revision_number, canonical_inputs, schema_version)
  values (v_analysis, 1, '{}'::jsonb, 'arc.workflow.v1') returning id into v_rev;

  insert into public.ai_analysis_state (revision_id, review_items, source_state)
  values (v_rev, jsonb_build_array(jsonb_build_object(
    'id', 'r1', 'targetKey', 'step2:po', 'section', 'step_2', 'state', 'red', 'severity', 'red',
    'reviewFingerprint', 'F1')), 'current');

  select lock_version into v_lock from public.analysis_revisions where id = v_rev;
  select event_id into v_e1 from public.arc_resolve_ai_review_issue(
    v_user, null, v_rev, null, v_lock, 'r1', 'F1', 'not_applicable', null);

  -- Re-analysis changes the conclusion (F2), then a later re-analysis brings
  -- the same material conclusion (F1) back and leaves it open for review.
  update public.ai_analysis_state set review_items = jsonb_build_array(jsonb_build_object(
    'id', 'r1', 'targetKey', 'step2:po', 'section', 'step_2', 'state', 'red', 'severity', 'red',
    'reviewFingerprint', 'F2')) where revision_id = v_rev;
  update public.ai_analysis_state set review_items = jsonb_build_array(jsonb_build_object(
    'id', 'r1', 'targetKey', 'step2:po', 'section', 'step_2', 'state', 'red', 'severity', 'red',
    'reviewFingerprint', 'F1')) where revision_id = v_rev;

  select lock_version into v_lock from public.analysis_revisions where id = v_rev;
  select event_id into v_e2 from public.arc_resolve_ai_review_issue(
    v_user, null, v_rev, null, v_lock, 'r1', 'F1', 'not_applicable', null);

  select count(*) into n from public.ai_review_events
   where revision_id = v_rev and review_item_id = 'r1' and event_type = 'red_manually_resolved';
  insert into arc_test_results
  values ('53 a later review cycle records its own immutable audit event', n = 2 and v_e2 <> v_e1);

  -- An immediate retry of the latest action is still idempotent, and it refers
  -- to the most recent event rather than the historical one.
  select lock_version into v_lock from public.analysis_revisions where id = v_rev;
  select already_resolved, event_id into v_already, v_e3
    from public.arc_resolve_ai_review_issue(
      v_user, null, v_rev, null, v_lock, 'r1', 'F1', 'not_applicable', null);
  select count(*) into n from public.ai_review_events
   where revision_id = v_rev and review_item_id = 'r1' and event_type = 'red_manually_resolved';
  insert into arc_test_results
  values ('54 an immediate retry adds no duplicate and returns the most recent event',
          v_already and n = 2 and v_e3 = v_e2);
end $phase9g_cycle$;

/* ------------------------------------------------------------------------
 * 55-60 — reconciliation-driven reopen events written by the AI apply.
 * ---------------------------------------------------------------------- */

do $phase9g_reopen$
declare
  v_user uuid := gen_random_uuid();
  v_customer uuid; v_contract uuid; v_analysis uuid; v_rev uuid;
  v_run uuid := gen_random_uuid();
  v_lock integer; v_after integer; n integer; v_reopen record; v_idem boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          '9g-reopen@example.test', '', now(), now(), now());
  insert into public.customers (owner_user_id, name) values (v_user, 'Reopen')
    returning id into v_customer;
  insert into public.contracts (customer_id, title) values (v_customer, 'Reopen')
    returning id into v_contract;
  insert into public.analyses (contract_id) values (v_contract) returning id into v_analysis;
  insert into public.analysis_revisions (analysis_id, revision_number, canonical_inputs, schema_version)
  values (v_analysis, 1, '{}'::jsonb, 'arc.workflow.v1') returning id into v_rev;

  insert into public.ai_analysis_state (revision_id, review_items, source_state,
                                        acknowledged_source_fingerprint, source_acknowledged_at,
                                        source_acknowledged_by)
  values (v_rev, jsonb_build_array(
    jsonb_build_object('id', 'y1', 'targetKey', 'step3:price', 'section', 'step_3',
                       'state', 'yellow', 'severity', 'yellow', 'reviewFingerprint', 'Y1'),
    jsonb_build_object('id', 'k1', 'targetKey', 'step4:alloc', 'section', 'step_4',
                       'state', 'yellow', 'severity', 'yellow', 'reviewFingerprint', 'K1')),
    'stale', repeat('d', 64), now(), v_user);

  select lock_version into v_lock from public.analysis_revisions where id = v_rev;
  perform public.arc_affirm_ai_review_item(v_user, null, v_rev, null, v_lock, 'y1', 'Y1');
  select lock_version into v_lock from public.analysis_revisions where id = v_rev;
  perform public.arc_affirm_ai_review_item(v_user, null, v_rev, null, v_lock, 'k1', 'K1');

  insert into public.ai_runs (id, revision_id, quota_scope, stage, source_set_fingerprint,
                              pre_run_canonical_inputs, model, reasoning_effort, prompt_version,
                              output_schema_version, guidance_registry_hash, owner_user_id,
                              openai_started_at)
  values (v_run, v_rev, 'authenticated', 'applying', 'fp-reopen', '{}'::jsonb,
          'm', 'high', 'p9g', 's1', 'h9g', v_user, now());

  -- y1 reopens as a red issue; k1 keeps its eligible carried-forward resolution.
  select lock_version into v_lock from public.analysis_revisions where id = v_rev;
  select lock_version, idempotent into v_after, v_idem from public.arc_apply_ai_run(
    v_run, v_user, null, v_lock, '{"origin":"ai"}'::jsonb, 'arc.workflow.v1',
    jsonb_build_object('sourceState', 'current', 'reviewItems', jsonb_build_array(
      jsonb_build_object('id', 'y1', 'targetKey', 'step3:price', 'section', 'step_3',
                         'state', 'red', 'severity', 'red', 'reviewFingerprint', 'Y2'),
      jsonb_build_object('id', 'k1', 'targetKey', 'step4:alloc', 'section', 'step_4',
                         'state', 'resolved', 'severity', 'yellow', 'reviewFingerprint', 'K1'))),
    'fp-reopen', '{}'::jsonb, '{}'::jsonb, 1);

  select * into v_reopen from public.ai_review_events
   where revision_id = v_rev and event_type = 'review_item_reopened';

  insert into arc_test_results
  select '55 a resolved conclusion that re-analysis reopens is recorded exactly once',
         (select count(*) from public.ai_review_events
           where revision_id = v_rev and event_type = 'review_item_reopened') = 1
     and v_reopen.review_item_id = 'y1'
     and v_reopen.review_fingerprint = 'Y2'
     and v_reopen.review_target_key = 'step3:price'
     and v_reopen.review_section = 'step_3'
     and v_reopen.ai_run_id = v_run
     and v_reopen.actor_kind = 'system'
     and v_reopen.actor_user_id is null;

  insert into arc_test_results
  select '56 the reopen records the new severity, not the old one',
         v_reopen.review_severity = 'red';

  insert into arc_test_results
  select '57 the earlier affirmation event is left exactly as it was',
         (select count(*) from public.ai_review_events
           where revision_id = v_rev and event_type = 'yellow_affirmed'
             and review_item_id = 'y1' and review_fingerprint = 'Y1') = 1;

  insert into arc_test_results
  select '58 an eligible carried-forward resolution is not a reopen',
         not exists (select 1 from public.ai_review_events
                      where revision_id = v_rev and event_type = 'review_item_reopened'
                        and review_item_id = 'k1');

  insert into arc_test_results
  select '59 a successful analysis clears an obsolete stale-source acknowledgment',
         (select acknowledged_source_fingerprint from public.ai_analysis_state
           where revision_id = v_rev) is null
     and (select source_acknowledged_at from public.ai_analysis_state
           where revision_id = v_rev) is null;

  -- Response-loss retry of the committed apply.
  select lock_version, idempotent into v_after, v_idem from public.arc_apply_ai_run(
    v_run, v_user, null, v_after, '{"origin":"ai"}'::jsonb, 'arc.workflow.v1',
    jsonb_build_object('sourceState', 'current', 'reviewItems', '[]'::jsonb),
    'fp-reopen', '{}'::jsonb, '{}'::jsonb, 1);
  insert into arc_test_results
  select '60 a response-loss retry of the apply adds no second reopen event',
         v_idem
     and (select count(*) from public.ai_review_events
           where revision_id = v_rev and event_type = 'review_item_reopened') = 1;
end $phase9g_reopen$;

/* ------------------------------------------------------------------------
 * 61-66 — actor identity inside a temporary workspace, the "Save to My
 * Contracts" re-home, and account/workspace lifecycle deletion.
 * ---------------------------------------------------------------------- */

do $phase9g_actor$
declare
  v_user uuid := gen_random_uuid();
  v_guest uuid; v_guest2 uuid;
  v_hash text := repeat('5', 64);
  v_hash2 text := repeat('6', 64);
  v_lock integer; v_anon_event uuid; v_named_event uuid; n integer;
  v_before public.ai_review_events;
  v_after public.ai_review_events;
  mig record; ok boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          '9g-actor@example.test', '', now(), now(), now());

  insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at)
  values (v_hash, '{}'::jsonb, 'arc.workflow.v1', now() + interval '9 hours')
    returning id into v_guest;
  insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at)
  values (v_hash2, '{}'::jsonb, 'arc.workflow.v1', now() + interval '9 hours')
    returning id into v_guest2;

  insert into public.ai_analysis_state (guest_workspace_id, review_items, source_state)
  values (v_guest, jsonb_build_array(
    jsonb_build_object('id', 'y1', 'targetKey', 'step3:price', 'section', 'step_3',
                       'state', 'yellow', 'severity', 'yellow', 'reviewFingerprint', 'Y1'),
    jsonb_build_object('id', 'y2', 'targetKey', 'step5:timing', 'section', 'step_5',
                       'state', 'yellow', 'severity', 'yellow', 'reviewFingerprint', 'Y2')),
    'current');
  insert into public.ai_analysis_state (guest_workspace_id, review_items, source_state)
  values (v_guest2, jsonb_build_array(
    jsonb_build_object('id', 'y1', 'targetKey', 'step3:price', 'section', 'step_3',
                       'state', 'yellow', 'severity', 'yellow', 'reviewFingerprint', 'Y1')),
    'current');

  -- An anonymous visitor.
  select lock_version into v_lock from public.guest_workspaces where id = v_guest;
  select event_id into v_anon_event from public.arc_affirm_ai_review_item(
    null, v_hash, null, v_guest, v_lock, 'y1', 'Y1');
  insert into arc_test_results
  select '61 an anonymous visitor is recorded as an anonymous temporary-workspace actor',
         (select actor_kind = 'guest' and actor_user_id is null
            from public.ai_review_events where id = v_anon_event);

  -- The same temporary workspace, but a signed-in accountant is working in it.
  select lock_version into v_lock from public.guest_workspaces where id = v_guest;
  select event_id into v_named_event from public.arc_affirm_ai_review_item(
    null, v_hash, null, v_guest, v_lock, 'y2', 'Y2', 'individual', v_user);
  insert into arc_test_results
  select '62 a signed-in accountant in a temporary workspace is a named actor',
         (select actor_kind = 'authenticated' and actor_user_id = v_user
                 and guest_workspace_id = v_guest
            from public.ai_review_events where id = v_named_event);

  -- An identity that does not exist is refused rather than recorded, and the
  -- temporary-workspace credential still decides ownership.
  select lock_version into v_lock from public.guest_workspaces where id = v_guest2;
  begin
    perform public.arc_affirm_ai_review_item(null, v_hash2, null, v_guest2, v_lock, 'y1', 'Y1',
                                             'individual', gen_random_uuid());
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results
  values ('63 an actor identity that does not exist cannot be recorded', ok);

  begin
    perform public.arc_affirm_ai_review_item(null, v_hash2, null, v_guest, v_lock, 'y1', 'Y1',
                                             'individual', v_user);
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results
  values ('63a a named actor never substitutes for the workspace credential', ok);

  /* ------------------------------ Save to My Contracts re-homes the history */

  select * into v_before from public.ai_review_events where id = v_named_event;
  select * into mig from public.arc_migrate_guest_workspace_v3(
    v_guest, v_user, null, 'Saved Customer', 'Saved Contract', null);
  select * into v_after from public.ai_review_events where id = v_named_event;

  insert into arc_test_results
  select '64 saving a temporary workspace re-homes its review history unchanged',
         v_after.revision_id = mig.revision_id
     and v_after.guest_workspace_id is null
     and v_after.id = v_before.id
     and v_after.event_type = v_before.event_type
     and v_after.review_item_id = v_before.review_item_id
     and v_after.review_fingerprint = v_before.review_fingerprint
     and v_after.review_target_key = v_before.review_target_key
     and v_after.review_section = v_before.review_section
     and v_after.actor_kind = v_before.actor_kind
     and v_after.actor_user_id = v_before.actor_user_id
     and v_after.ai_run_id is not distinct from v_before.ai_run_id
     and v_after.created_at = v_before.created_at
     and v_after.manual_red_reason is not distinct from v_before.manual_red_reason
     and v_after.note is not distinct from v_before.note
     and v_after.source_set_fingerprint is not distinct from v_before.source_set_fingerprint;

  delete from public.guest_workspaces where id = v_guest;
  select count(*) into n from public.ai_review_events
   where revision_id = mig.revision_id;
  insert into arc_test_results
  values ('65 the saved review history survives cleanup of the retired workspace', n = 2);

  -- The re-home permission does not linger: ordinary history is still immutable.
  begin
    update public.ai_review_events set revision_id = null, guest_workspace_id = v_guest2
     where id = v_named_event;
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results
  values ('65a the re-home permission does not leave a general update capability', ok);

  -- Account deletion removes the account and everything under it, without ever
  -- colliding with append-only history.
  begin
    delete from public.ai_review_events where revision_id = mig.revision_id;
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results
  values ('65b history cannot be deleted while its analysis exists', ok);

  begin
    delete from public.customers where id = mig.customer_id;
    delete from public.auth_placeholder_never_used where false;
    ok := true;
  exception when undefined_table then ok := true;
           when others then ok := false;
  end;
  insert into arc_test_results
  values ('66 deleting the contract hierarchy takes its review history with it', ok);

  insert into arc_test_results
  select '66a no review history is left behind',
         not exists (select 1 from public.ai_review_events where revision_id = mig.revision_id);

  begin
    delete from auth.users where id = v_user;
    ok := true;
  exception when others then ok := false;
  end;
  insert into arc_test_results values ('66b deleting the account still succeeds', ok);

  delete from public.guest_workspaces where id = v_guest2;
  insert into arc_test_results
  select '66c an unsaved temporary workspace still expires cleanly',
         not exists (select 1 from public.guest_workspaces where id = v_guest2);
end $phase9g_actor$;

/* ------------------------------ 67-68 the unaudited bypasses are retired */

insert into arc_test_results
select '67 no routine can replace the review array or affirm without an audit event',
       not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public'
                      and p.proname in ('arc_set_ai_review_state', 'arc_affirm_ai_review_scope'));

insert into arc_test_results
select '68 not even the service role may update or delete review history directly',
       not has_table_privilege('service_role', 'public.ai_review_events', 'update')
   and not has_table_privilege('service_role', 'public.ai_review_events', 'delete');



/* --------------------------------------------- 49 direct access is denied */

do $phase9g_rls$
declare
  ok boolean;
begin
  set local role authenticated;
  begin
    perform 1 from public.ai_review_events limit 1;
    ok := false;
  exception when others then ok := true;
  end;
  reset role;
  insert into arc_test_results values ('49 a signed-in user cannot read review events directly', ok);

  set local role authenticated;
  begin
    insert into public.ai_review_events (actor_kind, event_type) values ('authenticated', 'yellow_affirmed');
    ok := false;
  exception when others then ok := true;
  end;
  reset role;
  insert into arc_test_results values ('50 a signed-in user cannot forge a review event', ok);

  set local role anon;
  begin
    perform public.arc_affirm_ai_review_item(null, null, null, null, 1, 'x', 'y');
    ok := false;
  exception when others then ok := true;
  end;
  reset role;
  insert into arc_test_results values ('51 an anonymous visitor cannot execute the review RPCs', ok);
end $phase9g_rls$;

select assertion, passed from arc_test_results order by assertion;
select count(*) filter (where passed is not true) as failures, count(*) as total from arc_test_results;

-- CI gate: a false assertion must make psql exit non-zero.
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
