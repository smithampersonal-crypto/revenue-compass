-- ARC Phase 9F — atomic orchestration, apply/restore, review state and the
-- source-state lifecycle.
--
-- Everything runs inside a rolled-back transaction, in ONE session, so the
-- stage claim is proven structurally (a second claim returns false) rather
-- than as a genuine two-session race.
--
-- Every row of arc_test_results must report passed = true.
begin;

create temporary table arc_test_results (assertion text, passed boolean not null) on commit drop;

/* ------------------------------------------------------------ 01 schema */

insert into arc_test_results
select '01 source_state is stored as TEXT, not jsonb',
       (select c.data_type from information_schema.columns c
         where c.table_schema = 'public' and c.table_name = 'ai_analysis_state'
           and c.column_name = 'source_state') = 'text';

insert into arc_test_results
select '02 source_state still only accepts none, current or stale',
       exists (select 1 from pg_constraint
                where conname = 'ai_analysis_state_source_state_known');

insert into arc_test_results
select '03 every Phase 9F routine exists',
       (select count(distinct p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname in ('arc_advance_ai_run_stage', 'arc_record_ai_preflight',
                             'arc_apply_ai_run', 'arc_restore_pre_ai_run',
                             'arc_set_ai_review_state', 'arc_affirm_ai_review_scope',
                             'arc_mark_ai_sources_stale', 'arc_ai_scope_has_active_run')) = 8;

insert into arc_test_results
select '04 no Phase 9F routine is executable by anon or signed-in users',
       not exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname in ('arc_advance_ai_run_stage', 'arc_record_ai_preflight',
                              'arc_apply_ai_run', 'arc_restore_pre_ai_run',
                              'arc_set_ai_review_state', 'arc_affirm_ai_review_scope')
            and (has_function_privilege('anon', p.oid, 'execute')
                 or has_function_privilege('authenticated', p.oid, 'execute')));

/* --------------------------------------------------------- 05 behaviour */

do $phase9f$
declare
  v_user uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_customer uuid;
  v_contract uuid;
  v_analysis uuid;
  v_rev uuid;
  v_final_rev uuid;
  v_guest uuid;
  v_hash text := repeat('f', 64);
  v_doc uuid;
  v_doc2 uuid;
  v_run uuid;
  v_run2 uuid;
  v_old uuid;
  v_lock integer;
  v_lock_after integer;
  v_claimed boolean;
  v_recorded boolean;
  v_reserved boolean;
  v_already boolean;
  v_idem boolean;
  v_state text;
  v_canon jsonb;
  v_items jsonb;
  v_affirmed integer;
  v_value text;
  v_month date := date_trunc('month', now() at time zone 'utc')::date;
  v_sources jsonb;
  v_guidance jsonb;
  ok boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          '9f-a@example.test', '', now(), now(), now()),
         (v_other, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          '9f-b@example.test', '', now(), now(), now());

  insert into public.customers (owner_user_id, name) values (v_user, 'Phase 9F Customer')
    returning id into v_customer;
  insert into public.contracts (customer_id, title) values (v_customer, 'Phase 9F Contract')
    returning id into v_contract;
  insert into public.analyses (contract_id) values (v_contract) returning id into v_analysis;
  -- Revision 1 is finalized through the trusted routine; revision 2 is the
  -- editable draft every Phase 9F assertion below works against.
  insert into public.analysis_revisions (analysis_id, revision_number, canonical_inputs, schema_version)
  values (v_analysis, 1, '{"origin":"finalized"}'::jsonb, 'arc.workflow.v1')
    returning id into v_final_rev;
  perform public.arc_finalize_revision(v_user, v_final_rev, 1, '{"engine":true}'::jsonb,
                                       '{"reconciled":true}'::jsonb, 'arc.workflow.v1', 'engine-9f');
  insert into public.analysis_revisions (analysis_id, revision_number, canonical_inputs,
                                         schema_version, supersedes_revision_id)
  values (v_analysis, 2, '{"origin":"accountant"}'::jsonb, 'arc.workflow.v1', v_final_rev)
    returning id into v_rev;


  insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at)
  values (v_hash, '{"origin":"visitor"}'::jsonb, 'arc.workflow.v1', now() + interval '9 hours')
    returning id into v_guest;

  insert into public.source_documents (contract_id, storage_bucket, storage_object_path,
                                       original_filename, display_name, sha256, byte_size, page_count)
  values (v_contract, 'arc-source-documents', 'c/1.pdf', '1.pdf', 'Contract', repeat('1', 64), 100, 4)
    returning id into v_doc;
  insert into public.source_documents (contract_id, storage_bucket, storage_object_path,
                                       original_filename, display_name, sha256, byte_size, page_count)
  values (v_contract, 'arc-source-documents', 'c/2.pdf', '2.pdf', 'Amendment', repeat('2', 64), 120, 2)
    returning id into v_doc2;

  v_sources := jsonb_build_array(jsonb_build_object(
    'source_document_id', v_doc, 'position', 0, 'sha256', repeat('1', 64),
    'byte_size', 100, 'page_count', 4));
  v_guidance := jsonb_build_array(
    jsonb_build_object('card_id', 1, 'inclusion_reason', 'core',
                       'matched_signals', jsonb_build_array('always'), 'registry_hash', 'h9f'),
    jsonb_build_object('card_id', 2, 'inclusion_reason', 'retrieved',
                       'matched_signals', jsonb_build_array('usage'), 'registry_hash', 'h9f'));

  /* ------------------------------------------------- stage claim (05-08) */

  select lock_version into v_lock from public.analysis_revisions where id = v_rev;
  v_run := gen_random_uuid();
  perform public.arc_create_ai_run(v_run, v_user, null, v_rev, null, v_lock, 'authenticated',
                                   'fp-9f', '{"origin":"accountant"}'::jsonb, null,
                                   'gpt-5.6-terra', 'high', 'p9f', 's1', 'h9f');

  v_claimed := public.arc_advance_ai_run_stage(v_run, 'created', 'extracting');
  insert into arc_test_results
  select '05 the first caller claims created -> extracting',
         v_claimed and (select stage from public.ai_runs where id = v_run) = 'extracting';

  v_claimed := public.arc_advance_ai_run_stage(v_run, 'created', 'extracting');
  insert into arc_test_results
  select '06 a second caller does not claim the same transition and nothing changes',
         v_claimed is false and (select stage from public.ai_runs where id = v_run) = 'extracting';

  begin
    perform public.arc_advance_ai_run_stage(v_run, 'extracting', 'applying');
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results values ('07 a skipped stage transition is rejected', ok);

  begin
    perform public.arc_advance_ai_run_stage(v_run, 'extracting', 'created');
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results values ('08 a backward stage transition is rejected', ok);

  /* ------------------------------------------------ preflight (09-11) */

  v_recorded := public.arc_record_ai_preflight(v_run, 'fp-9f', v_sources, v_guidance, 1, 4, 4321);
  insert into arc_test_results
  select '09 preflight records source and Guidance provenance atomically',
         v_recorded
     and (select stage from public.ai_runs where id = v_run) = 'preflight_ready'
     and (select input_tokens from public.ai_runs where id = v_run) = 4321
     and (select count(*) from public.ai_run_sources where run_id = v_run) = 1
     and (select count(*) from public.ai_run_guidance where run_id = v_run) = 2;

  v_recorded := public.arc_record_ai_preflight(v_run, 'fp-9f', v_sources, v_guidance, 1, 4, 4321);
  insert into arc_test_results
  select '10 an identical preflight retry duplicates nothing',
         v_recorded is false
     and (select count(*) from public.ai_run_sources where run_id = v_run) = 1
     and (select count(*) from public.ai_run_guidance where run_id = v_run) = 2;

  begin
    perform public.arc_record_ai_preflight(v_run, 'fp-9f', v_sources, v_guidance, 1, 4, 9999);
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results values ('11 a changed preflight retry is rejected', ok);

  /* ------------------------------------------------- allowance (12-13) */

  select reserved, already_reserved into v_reserved, v_already
  from public.arc_reserve_ai_allowance(v_run, v_user, null, v_month, 10, 3);
  insert into arc_test_results
  select '12 reserving the allowance itself enters analyzing and stamps the start',
         v_reserved and not v_already
     and (select stage from public.ai_runs where id = v_run) = 'analyzing'
     and (select openai_started_at from public.ai_runs where id = v_run) is not null
     and (select runs_consumed from public.ai_monthly_usage
           where user_id = v_user and usage_month = v_month) = 1;

  select reserved, already_reserved into v_reserved, v_already
  from public.arc_reserve_ai_allowance(v_run, v_user, null, v_month, 10, 3);
  insert into arc_test_results
  select '13 a duplicate reservation does not charge twice',
         v_reserved and v_already
     and (select runs_consumed from public.ai_monthly_usage
           where user_id = v_user and usage_month = v_month) = 1;

  /* ----------------------------------------------------- apply (14-19) */

  perform public.arc_advance_ai_run_stage(v_run, 'analyzing', 'validating');
  perform public.arc_advance_ai_run_stage(v_run, 'validating', 'applying');

  select lock_version into v_lock from public.analysis_revisions where id = v_rev;
  select lock_version, idempotent into v_lock_after, v_idem
  from public.arc_apply_ai_run(v_run, v_user, null, v_lock,
                               '{"origin":"ai"}'::jsonb, 'arc.workflow.v1',
                               jsonb_build_object('sourceState', 'current',
                                                  'fieldProvenance', '{}'::jsonb,
                                                  'objectProvenance', '{}'::jsonb,
                                                  'tombstones', '[]'::jsonb,
                                                  'reviewItems', '[]'::jsonb),
                               'fp-9f', '{"analysis":true}'::jsonb, '{"tokens":1}'::jsonb, 2);

  insert into arc_test_results
  select '14 an apply with sourceState current writes TEXT source state',
         (select source_state from public.ai_analysis_state where revision_id = v_rev) = 'current';

  insert into arc_test_results
  select '15 canonical inputs, the AI sidecar and run success commit together',
         not v_idem
     and (select canonical_inputs from public.analysis_revisions where id = v_rev) = '{"origin":"ai"}'::jsonb
     and (select last_successful_run_id from public.ai_analysis_state where revision_id = v_rev) = v_run
     and (select stage from public.ai_runs where id = v_run) = 'succeeded'
     and (select review_issue_count from public.ai_runs where id = v_run) = 2;

  insert into arc_test_results
  select '16 the shared optimistic lock advances exactly once',
         v_lock_after = v_lock + 1
     and (select lock_version from public.analysis_revisions where id = v_rev) = v_lock + 1;

  select lock_version, idempotent into v_lock_after, v_idem
  from public.arc_apply_ai_run(v_run, v_user, null, v_lock,
                               '{"origin":"ai-again"}'::jsonb, 'arc.workflow.v1',
                               jsonb_build_object('sourceState', 'current'),
                               'fp-9f', '{"analysis":true}'::jsonb, '{"tokens":1}'::jsonb, 2);
  insert into arc_test_results
  select '17 a response-loss apply retry reports the committed outcome without reapplying',
         v_idem
     and (select canonical_inputs from public.analysis_revisions where id = v_rev) = '{"origin":"ai"}'::jsonb
     and (select lock_version from public.analysis_revisions where id = v_rev) = v_lock + 1;

  -- A stale lock is a serialization failure, never a silent overwrite.
  v_run2 := gen_random_uuid();
  insert into public.ai_runs (id, revision_id, quota_scope, stage, source_set_fingerprint,
                              pre_run_canonical_inputs, model, reasoning_effort, prompt_version,
                              output_schema_version, guidance_registry_hash, owner_user_id)
  values (v_run2, v_rev, 'authenticated', 'applying', 'fp-9f', '{"origin":"ai"}'::jsonb,
          'm', 'high', 'p9f', 's1', 'h9f', v_user);
  begin
    perform public.arc_apply_ai_run(v_run2, v_user, null, 0, '{"origin":"stale"}'::jsonb,
                                    'arc.workflow.v1', jsonb_build_object('sourceState', 'current'),
                                    'fp-9f', '{}'::jsonb, '{}'::jsonb, 0);
    ok := false;
  exception when others then ok := (sqlstate = '40001');
  end;
  insert into arc_test_results
  select '18 an out-of-date optimistic lock fails the apply with 40001',
         ok and (select canonical_inputs from public.analysis_revisions where id = v_rev)
                  = '{"origin":"ai"}'::jsonb;

  begin
    perform public.arc_apply_ai_run(v_run2, v_other, null,
                                    (select lock_version from public.analysis_revisions where id = v_rev),
                                    '{"origin":"thief"}'::jsonb, 'arc.workflow.v1',
                                    jsonb_build_object('sourceState', 'current'),
                                    'fp-9f', '{}'::jsonb, '{}'::jsonb, 0);
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results values (
    '19 another signed-in user cannot apply against this analysis', ok);
  update public.ai_runs set stage = 'application_failed', completed_at = now(),
                            failure_stage = 'applying', failure_category = 'application',
                            failure_code = 'test', safe_message = 'test'
   where id = v_run2;

  /* ------------------------------------------------- source state (20-21) */

  perform public.arc_mark_ai_sources_stale(v_rev, null);
  insert into arc_test_results
  select '20 a source-set change after a successful run marks the sidecar stale',
         (select source_state from public.ai_analysis_state where revision_id = v_rev) = 'stale';

  perform public.arc_mark_ai_sources_stale(v_rev, null);
  insert into arc_test_results
  select '21 marking an already stale sidecar stale again is idempotent',
         (select source_state from public.ai_analysis_state where revision_id = v_rev) = 'stale';

  /* ---------------------------------------------------- restore (22-26) */

  update public.ai_analysis_state set source_state = 'current' where revision_id = v_rev;
  select lock_version into v_lock from public.analysis_revisions where id = v_rev;
  select lock_version into v_lock_after
  from public.arc_restore_pre_ai_run(v_run, v_user, null, v_lock);

  insert into arc_test_results
  select '22 restore returns the exact pre-run canonical snapshot',
         (select canonical_inputs from public.analysis_revisions where id = v_rev)
           = '{"origin":"accountant"}'::jsonb;

  insert into arc_test_results
  select '23 a null pre-run sidecar is restored as no AI state row at all',
         not exists (select 1 from public.ai_analysis_state where revision_id = v_rev);

  insert into arc_test_results
  select '24 restore advances the shared lock exactly once',
         v_lock_after = v_lock + 1
     and (select lock_version from public.analysis_revisions where id = v_rev) = v_lock + 1;

  -- Every prior source state value must restore as TEXT.
  foreach v_value in array array['none', 'current', 'stale'] loop
    v_run2 := gen_random_uuid();
    insert into public.ai_runs (id, revision_id, quota_scope, stage, source_set_fingerprint,
                                pre_run_canonical_inputs, pre_run_ai_state, model, reasoning_effort,
                                prompt_version, output_schema_version, guidance_registry_hash,
                                owner_user_id, openai_started_at, completed_at)
    values (v_run2, v_rev, 'authenticated', 'succeeded', 'fp-9f', '{"origin":"accountant"}'::jsonb,
            jsonb_build_object('sourceState', v_value, 'sourceSetFingerprint', 'fp-prior',
                               'fieldProvenance', '{}'::jsonb, 'objectProvenance', '{}'::jsonb,
                               'tombstones', '[]'::jsonb, 'reviewItems', '[]'::jsonb),
            'm', 'high', 'p9f', 's1', 'h9f', v_user, now(), now());

    update public.ai_analysis_state
       set last_successful_run_id = v_run2, source_state = 'current'
     where revision_id = v_rev;
    if not found then
      insert into public.ai_analysis_state (revision_id, last_successful_run_id, source_state)
      values (v_rev, v_run2, 'current');
    end if;

    select lock_version into v_lock from public.analysis_revisions where id = v_rev;
    perform public.arc_restore_pre_ai_run(v_run2, v_user, null, v_lock);
    select source_state into v_state from public.ai_analysis_state where revision_id = v_rev;

    insert into arc_test_results
    select format('25%s restore rewrites the prior source state %L as TEXT',
                  case v_value when 'none' then 'a' when 'current' then 'b' else 'c' end, v_value),
           v_state = v_value;
    v_old := v_run2;
  end loop;

  -- An older successful run that was never the current one is refused outright
  -- (a re-restore of an already restored run is a response-loss retry instead).
  v_old := gen_random_uuid();
  insert into public.ai_runs (id, revision_id, quota_scope, stage, source_set_fingerprint,
                              pre_run_canonical_inputs, model, reasoning_effort, prompt_version,
                              output_schema_version, guidance_registry_hash, owner_user_id,
                              openai_started_at, completed_at)
  values (v_old, v_rev, 'authenticated', 'succeeded', 'fp-old', '{"origin":"older"}'::jsonb,
          'm', 'high', 'p9f', 's1', 'h9f', v_user, now(), now());
  begin
    perform public.arc_restore_pre_ai_run(v_old, v_user, null,
      (select lock_version from public.analysis_revisions where id = v_rev));
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results values (
    '26 only the current latest successful run can be restored', ok);


  -- A finalized revision is out of reach of restore entirely.
  v_run2 := gen_random_uuid();
  insert into public.ai_runs (id, revision_id, quota_scope, stage, source_set_fingerprint,
                              pre_run_canonical_inputs, model, reasoning_effort, prompt_version,
                              output_schema_version, guidance_registry_hash, owner_user_id,
                              openai_started_at, completed_at)
  values (v_run2, v_final_rev, 'authenticated', 'succeeded', 'fp-final', '{}'::jsonb,
          'm', 'high', 'p9f', 's1', 'h9f', v_user, now(), now());
  begin
    perform public.arc_restore_pre_ai_run(v_run2, v_user, null, 1);
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results values ('27 a finalized revision cannot be restored', ok);

  /* ---------------------------------------------------- review (28-30) */

  delete from public.ai_analysis_state where revision_id = v_rev;
  insert into public.ai_analysis_state (revision_id, source_state, review_items)
  values (v_rev, 'current', jsonb_build_array(
    jsonb_build_object('id', 'y1', 'section', 'step_2', 'state', 'yellow'),
    jsonb_build_object('id', 'r1', 'section', 'step_2', 'state', 'red')));

  select lock_version into v_lock from public.analysis_revisions where id = v_rev;
  select lock_version, affirmed_count into v_lock_after, v_affirmed
  from public.arc_affirm_ai_review_scope(v_user, null, v_rev, null, v_lock, 'step_2');
  select review_items into v_items from public.ai_analysis_state where revision_id = v_rev;

  insert into arc_test_results
  select '28 affirmation resolves yellow items only',
         v_affirmed = 1
     and (v_items -> 0 ->> 'state') = 'resolved'
     and (v_items -> 0 ->> 'affirmedAt') is not null;

  insert into arc_test_results
  select '29 a red issue is never resolved by affirmation',
         (v_items -> 1 ->> 'state') = 'red';

  begin
    perform public.arc_set_ai_review_state(v_user, null, v_final_rev, null, 1, '[]'::jsonb);
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results values (
    '30 finalized review history cannot be changed', ok);

  /* -------------------------------------------- source lifecycle (31-33) */

  select lock_version into v_lock from public.analysis_revisions where id = v_rev;
  v_run2 := gen_random_uuid();
  perform public.arc_create_ai_run(v_run2, v_user, null, v_rev, null, v_lock, 'authenticated',
                                   'fp-live', '{}'::jsonb, null, 'm', 'high', 'p9f', 's1', 'h9f');
  begin
    perform public.arc_attach_source_document(v_user, v_rev, v_doc, v_lock);
    ok := false;
  exception when others then ok := (sqlstate = '55006');
  end;
  insert into arc_test_results values (
    '31 a running AI analysis freezes the selected source set', ok);

  update public.ai_runs set stage = 'succeeded', openai_started_at = now(), completed_at = now()
   where id = v_run2;
  update public.ai_analysis_state
     set last_successful_run_id = v_run2, source_state = 'current'
   where revision_id = v_rev;

  select lock_version into v_lock from public.analysis_revisions where id = v_rev;
  perform public.arc_attach_source_document(v_user, v_rev, v_doc, v_lock);
  insert into arc_test_results
  select '32 changing the source set after a successful run marks the sidecar stale',
         (select source_state from public.ai_analysis_state where revision_id = v_rev) = 'stale';

  select lock_version into v_lock from public.analysis_revisions where id = v_rev;
  perform public.arc_remove_source_document(v_user, v_rev, v_doc, v_lock);
  insert into arc_test_results
  select '33 removing a source document keeps the sidecar stale, never jsonb',
         (select source_state from public.ai_analysis_state where revision_id = v_rev) = 'stale';

  /* -------------------------------------------- guest apply (34-35) */

  v_run2 := gen_random_uuid();
  insert into public.ai_runs (id, guest_workspace_id, guest_token_hash, quota_scope, stage,
                              source_set_fingerprint, pre_run_canonical_inputs, model,
                              reasoning_effort, prompt_version, output_schema_version,
                              guidance_registry_hash)
  values (v_run2, v_guest, v_hash, 'guest', 'applying', 'fp-guest',
          '{"origin":"visitor"}'::jsonb, 'm', 'high', 'p9f', 's1', 'h9f');

  select lock_version into v_lock from public.guest_workspaces where id = v_guest;
  select lock_version into v_lock_after
  from public.arc_apply_ai_run(v_run2, null, v_hash, v_lock, '{"origin":"visitor-ai"}'::jsonb,
                               'arc.workflow.v1', jsonb_build_object('sourceState', 'current'),
                               'fp-guest', '{}'::jsonb, '{}'::jsonb, 1);

  insert into arc_test_results
  select '34 a temporary-workspace apply commits the draft and its TEXT source state',
         (select draft_json from public.guest_workspaces where id = v_guest)
           = '{"origin":"visitor-ai"}'::jsonb
     and (select source_state from public.ai_analysis_state where guest_workspace_id = v_guest) = 'current'
     and v_lock_after = v_lock + 1;

  perform public.arc_mark_ai_sources_stale(null, v_guest);
  insert into arc_test_results
  select '35 a temporary workspace sidecar also goes stale as TEXT',
         (select source_state from public.ai_analysis_state where guest_workspace_id = v_guest) = 'stale';
end $phase9f$;

/* ----------------------------------------------------------------------------
 * 36-47 — Phase 8B upload compatibility for temporary workspaces, and the v3
 * "Save to My Contracts" re-home of AI run history.
 * ------------------------------------------------------------------------- */

do $phase9f_v3$
declare
  v_user uuid := gen_random_uuid();
  v_guest uuid;
  v_hash text := repeat('a', 64);
  v_sha text := repeat('b', 64);
  v_intent uuid;
  v_doc uuid;
  v_run uuid := gen_random_uuid();
  v_run_b uuid := gen_random_uuid();
  v_lock integer;
  c record;
  res record;
  mig record;
  mig2 record;
  v_rev uuid;
  ok boolean;
  n integer;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at)
  values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'phase9f-v3@example.test', '', now(), now());

  insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at)
  values (v_hash, '{"origin":"visitor"}'::jsonb, 'arc.workflow.v1', now() + interval '9 hours')
  returning id into v_guest;

  /* ------------------------------------------- 36-38 guest upload commit */

  insert into public.document_upload_intents
    (guest_workspace_id, pending_object_path, original_filename, display_name, expires_at)
  values (v_guest, 'pending/9f-guest.pdf', 'msa.pdf', 'Master Agreement', now() + interval '1 hour')
  returning id into v_intent;

  perform public.arc_prepare_source_document_upload(v_intent, null, v_hash, v_sha, 2048, 5);

  select lock_version into v_lock from public.guest_workspaces where id = v_guest;
  select * into c from public.arc_commit_source_document_upload(v_intent, null, v_hash, v_lock);
  v_doc := c.source_document_id;

  insert into arc_test_results
  select '36 a temporary-workspace first commit succeeds and selects the document',
         c.associated is true and c.association_conflict is false
     and c.lock_version = v_lock + 1
     and exists (select 1 from public.guest_source_document_selections s
                  where s.guest_workspace_id = v_guest and s.source_document_id = v_doc);

  select * into res from public.arc_commit_source_document_upload(v_intent, null, v_hash, v_lock);
  select count(*) into n from public.source_documents
   where guest_workspace_id = v_guest and sha256 = v_sha;

  insert into arc_test_results
  select '37 the finalized guest intent retry reports associated with no second lock bump',
         res.source_document_id = v_doc
     and res.associated is true
     and res.association_conflict is false
     and res.lock_version = c.lock_version
     and (select lock_version from public.guest_workspaces where id = v_guest) = c.lock_version
     and n = 1;

  insert into arc_test_results
  select '38 no stale mark is written when no new association was inserted',
         coalesce((select source_state from public.ai_analysis_state
                    where guest_workspace_id = v_guest), 'none') <> 'stale';

  /* ------------------------------------- 39-45 v3 re-home of the AI history */

  insert into public.ai_runs (id, guest_workspace_id, guest_token_hash, quota_scope, stage,
                              source_set_fingerprint, source_count, page_count,
                              pre_run_canonical_inputs, model, reasoning_effort, prompt_version,
                              output_schema_version, guidance_registry_hash, completed_at)
  values (v_run, v_guest, v_hash, 'guest', 'succeeded', 'fp-v3', 1, 5,
          '{"origin":"visitor"}'::jsonb, 'm', 'high', 'p9f', 's1', 'h9f', now());

  insert into public.ai_run_sources (run_id, source_document_id, position, sha256, byte_size, page_count)
  values (v_run, v_doc, 0, v_sha, 2048, 5);
  insert into public.ai_run_guidance (run_id, card_id, inclusion_reason, matched_signals, registry_hash)
  values (v_run, 12, 'signal', array['licence'], 'h9f');

  insert into public.ai_analysis_state (guest_workspace_id, source_state, last_successful_run_id,
                                        field_provenance, review_items)
  values (v_guest, 'current', v_run, '{"contract.transactionPriceInput":"ai"}'::jsonb,
          jsonb_build_array(jsonb_build_object('id', 'y1', 'section', 'step_2', 'state', 'resolved')));

  -- An executing run must block the save outright.
  insert into public.ai_runs (id, guest_workspace_id, guest_token_hash, quota_scope, stage,
                              source_set_fingerprint, pre_run_canonical_inputs, model,
                              reasoning_effort, prompt_version, output_schema_version,
                              guidance_registry_hash)
  values (v_run_b, v_guest, v_hash, 'guest', 'analyzing', 'fp-v3b',
          '{"origin":"visitor"}'::jsonb, 'm', 'high', 'p9f', 's1', 'h9f');

  select lock_version into v_lock from public.guest_workspaces where id = v_guest;
  ok := false;
  begin
    perform public.arc_migrate_guest_workspace_by_token_v3(
      v_hash, v_user, v_lock, null, 'Genomix Therapeutics', 'Genomix Platform', 'GX-1');
  exception when others then ok := (sqlstate = '55006');
  end;
  insert into arc_test_results values (
    '39 an executing AI run blocks Save to My Contracts', ok);

  update public.ai_runs set stage = 'api_failed', completed_at = now() where id = v_run_b;

  select lock_version into v_lock from public.guest_workspaces where id = v_guest;
  select * into mig from public.arc_migrate_guest_workspace_by_token_v3(
    v_hash, v_user, v_lock, null, 'Genomix Therapeutics', 'Genomix Platform', 'GX-1');
  v_rev := mig.revision_id;

  insert into arc_test_results
  select '40 the saved analysis keeps the same AI run id, now on revision 1',
         mig.idempotent is false
     and (select revision_id from public.ai_runs where id = v_run) = v_rev
     and (select guest_workspace_id from public.ai_runs where id = v_run) is null
     and (select revision_number from public.analysis_revisions where id = v_rev) = 1;

  insert into arc_test_results
  select '41 run sources and Guidance provenance are unchanged by the save',
         (select count(*) from public.ai_run_sources where run_id = v_run) = 1
     and (select source_document_id from public.ai_run_sources where run_id = v_run) = v_doc
     and (select card_id from public.ai_run_guidance where run_id = v_run) = 12
     and (select registry_hash from public.ai_run_guidance where run_id = v_run) = 'h9f';

  insert into arc_test_results
  select '42 the AI sidecar moves across intact',
         (select count(*) from public.ai_analysis_state where guest_workspace_id = v_guest) = 0
     and (select last_successful_run_id from public.ai_analysis_state where revision_id = v_rev) = v_run
     and (select source_state from public.ai_analysis_state where revision_id = v_rev) = 'current'
     and (select field_provenance from public.ai_analysis_state where revision_id = v_rev)
           = '{"contract.transactionPriceInput":"ai"}'::jsonb;

  insert into arc_test_results
  select '43 the saved run keeps its temporary-workspace quota identity',
         (select quota_scope from public.ai_runs where id = v_run) = 'guest'
     and not exists (select 1 from public.ai_monthly_usage where user_id = v_user);

  select * into mig2 from public.arc_migrate_guest_workspace_by_token_v3(
    v_hash, v_user, v_lock, null, 'Genomix Therapeutics', 'Genomix Platform', 'GX-1');

  insert into arc_test_results
  select '44 a response-loss retry returns the same ids and migrates nothing twice',
         mig2.idempotent is true
     and mig2.revision_id = v_rev
     and mig2.contract_id = mig.contract_id
     and mig2.analysis_id = mig.analysis_id
     and (select count(*) from public.analysis_revisions where analysis_id = mig.analysis_id) = 1
     and (select count(*) from public.ai_runs where revision_id = v_rev) = 2;

  update public.guest_workspaces set expires_at = now() - interval '1 hour' where id = v_guest;
  perform public.arc_expire_guest_workspaces();
  perform public.arc_delete_expired_guest_workspaces();

  insert into arc_test_results
  select '45 expiring the old temporary workspace never touches the saved analysis',
         exists (select 1 from public.analysis_revisions where id = v_rev)
     and exists (select 1 from public.ai_runs where id = v_run and revision_id = v_rev)
     and exists (select 1 from public.ai_analysis_state where revision_id = v_rev);

  /* ------------------------------------------ 46-47 signed-in quota identity */

  insert into public.ai_runs (id, owner_user_id, revision_id, quota_scope, stage,
                              source_set_fingerprint, pre_run_canonical_inputs, model,
                              reasoning_effort, prompt_version, output_schema_version,
                              guidance_registry_hash, completed_at)
  values (gen_random_uuid(), v_user, v_rev, 'authenticated', 'succeeded', 'fp-auth',
          '{}'::jsonb, 'm', 'high', 'p9f', 's1', 'h9f', now());

  insert into arc_test_results
  select '46 a signed-in run on the saved revision keeps the authenticated quota identity',
         (select count(*) from public.ai_runs
           where revision_id = v_rev and quota_scope = 'authenticated') = 1;

  insert into arc_test_results
  select '47 the guest-funded run gains an owner but is never rebilled to the account',
         (select owner_user_id from public.ai_runs where id = v_run) = v_user
     and (select quota_scope from public.ai_runs where id = v_run) = 'guest'
     and not exists (select 1 from public.ai_monthly_usage where user_id = v_user);
end $phase9f_v3$;


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
