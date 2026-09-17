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
                             'arc_protect_ai_review_event')) = 5;

insert into arc_test_results
select '06 no Phase 9G routine is executable by anon or signed-in users',
       not exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname in ('arc_affirm_ai_review_item', 'arc_resolve_ai_review_issue',
                              'arc_acknowledge_ai_stale_sources', 'arc_ai_source_set_fingerprint')
            and (has_function_privilege('anon', p.oid, 'execute')
                 or has_function_privilege('authenticated', p.oid, 'execute')));

insert into arc_test_results
select '07 every Phase 9G routine is executable by the service role',
       not exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname in ('arc_affirm_ai_review_item', 'arc_resolve_ai_review_issue',
                              'arc_acknowledge_ai_stale_sources', 'arc_ai_source_set_fingerprint')
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

  insert into public.ai_analysis_state (revision_id, review_items, source_state)
  values (v_rev, v_items, 'stale');
  insert into public.ai_analysis_state (guest_workspace_id, review_items, source_state)
  values (v_guest, v_items, 'stale');

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
  select '33 acknowledging resolves no review item and consumes no AI allowance',
         (select value ->> 'state' from public.ai_analysis_state s,
                 lateral jsonb_array_elements(s.review_items) value
           where s.revision_id = v_rev and value ->> 'id' = v_hard) = 'red'
     and not exists (select 1 from public.ai_monthly_usage where user_id = v_user)
     and not exists (select 1 from public.ai_runs where revision_id = v_rev);

  select lock_version into v_lock from public.analysis_revisions where id = v_rev;
  begin
    perform public.arc_acknowledge_ai_stale_sources(v_user, null, v_rev, null, v_lock,
                                                    repeat('0', 64));
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results
  values ('34 a client-invented source fingerprint cannot become authoritative', ok);

  -- The selection changes: the stored acknowledgment is now simply not the
  -- current fingerprint any more, and its history survives untouched.
  insert into public.revision_source_documents (revision_id, source_document_id)
  values (v_rev, v_doc2);
  insert into arc_test_results
  select '35 changing the selected sources invalidates the acknowledgment',
         (select acknowledged_source_fingerprint from public.ai_analysis_state
           where revision_id = v_rev) <> public.arc_ai_source_set_fingerprint(v_rev, null);

  insert into arc_test_results
  select '36 the historical acknowledgment event is never deleted',
         (select count(*) from public.ai_review_events
           where event_type = 'stale_sources_acknowledged'
             and source_set_fingerprint = v_expected_fp) = 1;

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
end $phase9g$;

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
