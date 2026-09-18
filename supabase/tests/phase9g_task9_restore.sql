-- ARC Phase 9G — Task 9C. Exact whole-run restore.
--
-- Proves the restore routine puts the analysis back into EXACTLY the state it
-- was in before the run: the canonical draft, every AI sidecar field including
-- the three Task 2 acknowledgment fields, or no sidecar row at all. A snapshot
-- that cannot be restored exactly (legacy shape) and a changed source set are
-- refused instead of being restored approximately.
--
-- Everything runs inside a rolled-back transaction. Every row of
-- arc_test_results must report passed = true.
begin;

create temporary table arc_test_results (assertion text, passed boolean not null) on commit drop;

/* ---------------------------------------------------------- 01 security */

insert into arc_test_results
select '01 restore is SECURITY DEFINER with a fixed search_path',
       (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'arc_restore_pre_ai_run')
   and (select array_to_string(p.proconfig, ',') from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'arc_restore_pre_ai_run')
       = 'search_path=pg_catalog, public';

insert into arc_test_results
select '02 only the trusted server role may execute restore',
       (select has_function_privilege('service_role', p.oid, 'execute')
           and not has_function_privilege('anon', p.oid, 'execute')
           and not has_function_privilege('authenticated', p.oid, 'execute')
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'arc_restore_pre_ai_run');

/* --------------------------------------------------------- 03 behaviour */

do $task9$
declare
  v_user uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_customer uuid;
  v_contract uuid;
  v_analysis uuid;
  v_rev uuid;
  v_doc uuid;
  v_doc2 uuid;
  v_run uuid;
  v_run2 uuid;
  v_fp text;
  v_lock integer;
  v_lock_after integer;
  v_idem boolean;
  v_state public.ai_analysis_state;
  v_ack_at timestamptz := timestamptz '2026-03-04 05:06:07+00';
  v_prior jsonb;
  v_runs integer;
  v_sources integer;
  ok boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          '9g-t9-a@example.test', '', now(), now(), now()),
         (v_other, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          '9g-t9-b@example.test', '', now(), now(), now());

  insert into public.customers (owner_user_id, name) values (v_user, 'Task 9 Customer')
    returning id into v_customer;
  insert into public.contracts (customer_id, title) values (v_customer, 'Task 9 Contract')
    returning id into v_contract;
  insert into public.analyses (contract_id) values (v_contract) returning id into v_analysis;
  insert into public.analysis_revisions (analysis_id, revision_number, canonical_inputs, schema_version)
  values (v_analysis, 1, '{"origin":"post-run"}'::jsonb, 'arc.workflow.v1')
    returning id into v_rev;

  insert into public.source_documents (contract_id, storage_bucket, storage_object_path,
                                       original_filename, display_name, sha256, byte_size, page_count)
  values (v_contract, 'arc-source-documents', 't9/1.pdf', '1.pdf', 'Contract',
          repeat('a', 64), 100, 4)
    returning id into v_doc;
  insert into public.source_documents (contract_id, storage_bucket, storage_object_path,
                                       original_filename, display_name, sha256, byte_size, page_count)
  values (v_contract, 'arc-source-documents', 't9/2.pdf', '2.pdf', 'Amendment',
          repeat('b', 64), 120, 2)
    returning id into v_doc2;

  select lock_version into v_lock from public.analysis_revisions where id = v_rev;
  v_lock := public.arc_attach_source_document(v_user, v_rev, v_doc, v_lock);
  v_fp := public.arc_ai_source_set_fingerprint(v_rev, null);

  /* ------------------------------ exact sidecar restore, all fields (03-07) */

  v_prior := jsonb_build_object(
    'last_successful_run_id', null,
    'source_set_fingerprint', 'fp-prior',
    'source_state', 'stale',
    'field_provenance', jsonb_build_object('a', 'ai'),
    'object_provenance', jsonb_build_object('po-1', 'ai'),
    'tombstones', jsonb_build_array('po-9'),
    'review_items', jsonb_build_array(jsonb_build_object('id', 'r1')),
    'acknowledged_source_fingerprint', 'fp-acked',
    'source_acknowledged_at', v_ack_at,
    'source_acknowledged_by', v_user);

  v_run := gen_random_uuid();
  insert into public.ai_runs (id, revision_id, quota_scope, stage, source_set_fingerprint,
                              pre_run_canonical_inputs, pre_run_ai_state, model, reasoning_effort,
                              prompt_version, output_schema_version, guidance_registry_hash,
                              owner_user_id, openai_started_at, completed_at)
  values (v_run, v_rev, 'authenticated', 'succeeded', v_fp, '{"origin":"pre-run"}'::jsonb,
          v_prior, 'm', 'high', 'p9g', 's1', 'h9g', v_user, now(), now());

  insert into public.ai_analysis_state (
    revision_id, last_successful_run_id, source_set_fingerprint, source_state,
    field_provenance, object_provenance, tombstones, review_items,
    acknowledged_source_fingerprint, source_acknowledged_at, source_acknowledged_by)
  values (v_rev, v_run, v_fp, 'current',
          jsonb_build_object('a', 'ai', 'b', 'ai'), jsonb_build_object('po-2', 'ai'),
          '[]'::jsonb, jsonb_build_array(jsonb_build_object('id', 'r9')),
          null, null, null);

  select lock_version into v_lock from public.analysis_revisions where id = v_rev;
  select lock_version, idempotent into v_lock_after, v_idem
  from public.arc_restore_pre_ai_run(v_run, v_user, null, v_lock);
  select * into v_state from public.ai_analysis_state where revision_id = v_rev;

  insert into arc_test_results
  select '03 restore puts back the exact pre-run canonical draft',
         (select canonical_inputs from public.analysis_revisions where id = v_rev)
           = '{"origin":"pre-run"}'::jsonb
     and v_lock_after = v_lock + 1
     and v_idem is false;

  insert into arc_test_results
  select '04 restore puts back every recorded sidecar field, not a default',
         v_state.source_state is not distinct from 'stale'
     and v_state.source_set_fingerprint is not distinct from 'fp-prior'
     and v_state.last_successful_run_id is null
     and v_state.field_provenance is not distinct from jsonb_build_object('a', 'ai')
     and v_state.object_provenance is not distinct from jsonb_build_object('po-1', 'ai')
     and v_state.tombstones is not distinct from jsonb_build_array('po-9')
     and v_state.review_items is not distinct from jsonb_build_array(jsonb_build_object('id', 'r1'));

  insert into arc_test_results
  select '05 restore puts back the three stale-source acknowledgment fields',
         v_state.acknowledged_source_fingerprint is not distinct from 'fp-acked'
     and v_state.source_acknowledged_at is not distinct from v_ack_at
     and v_state.source_acknowledged_by is not distinct from v_user;

  insert into arc_test_results
  select '06 restore stamps the run as restored and leaves run history alone',
         (select restored_at is not null from public.ai_runs where id = v_run)
     and (select count(*) from public.ai_runs where revision_id = v_rev) = 1;

  insert into arc_test_results
  select '07 restore leaves the selected source documents untouched',
         (select count(*) from public.revision_source_documents where revision_id = v_rev) = 1
     and public.arc_ai_source_set_fingerprint(v_rev, null) = v_fp;

  /* ------------------------------- acknowledgment keys present but null (08) */

  v_run2 := gen_random_uuid();
  insert into public.ai_runs (id, revision_id, quota_scope, stage, source_set_fingerprint,
                              pre_run_canonical_inputs, pre_run_ai_state, model, reasoning_effort,
                              prompt_version, output_schema_version, guidance_registry_hash,
                              owner_user_id, openai_started_at, completed_at)
  values (v_run2, v_rev, 'authenticated', 'succeeded', v_fp, '{"origin":"pre-run-2"}'::jsonb,
          jsonb_build_object(
            'last_successful_run_id', null, 'source_set_fingerprint', null,
            'source_state', 'none', 'field_provenance', '{}'::jsonb,
            'object_provenance', '{}'::jsonb, 'tombstones', '[]'::jsonb,
            'review_items', '[]'::jsonb,
            'acknowledged_source_fingerprint', null,
            'source_acknowledged_at', null, 'source_acknowledged_by', null),
          'm', 'high', 'p9g', 's1', 'h9g', v_user, now(), now());
  update public.ai_analysis_state set last_successful_run_id = v_run2,
         acknowledged_source_fingerprint = 'fp-acked', source_acknowledged_at = v_ack_at,
         source_acknowledged_by = v_user
   where revision_id = v_rev;

  select lock_version into v_lock from public.analysis_revisions where id = v_rev;
  perform public.arc_restore_pre_ai_run(v_run2, v_user, null, v_lock);
  select * into v_state from public.ai_analysis_state where revision_id = v_rev;

  insert into arc_test_results
  select '08 recorded null acknowledgment values restore as null, not as carry-over',
         v_state.acknowledged_source_fingerprint is null
     and v_state.source_acknowledged_at is null
     and v_state.source_acknowledged_by is null
     and v_state.source_state is not distinct from 'none';

  /* ------------------------------------------ first-run: no sidecar at all (09) */

  v_run2 := gen_random_uuid();
  insert into public.ai_runs (id, revision_id, quota_scope, stage, source_set_fingerprint,
                              pre_run_canonical_inputs, pre_run_ai_state, model, reasoning_effort,
                              prompt_version, output_schema_version, guidance_registry_hash,
                              owner_user_id, openai_started_at, completed_at)
  values (v_run2, v_rev, 'authenticated', 'succeeded', v_fp, '{"origin":"first"}'::jsonb,
          null, 'm', 'high', 'p9g', 's1', 'h9g', v_user, now(), now());
  update public.ai_analysis_state set last_successful_run_id = v_run2 where revision_id = v_rev;

  select lock_version into v_lock from public.analysis_revisions where id = v_rev;
  perform public.arc_restore_pre_ai_run(v_run2, v_user, null, v_lock);

  insert into arc_test_results
  select '09 a first run restores to no AI sidecar row at all',
         not exists (select 1 from public.ai_analysis_state where revision_id = v_rev)
     and (select canonical_inputs from public.analysis_revisions where id = v_rev)
           = '{"origin":"first"}'::jsonb;

  /* ------------------------------------------------ legacy snapshot (10-11) */

  v_run2 := gen_random_uuid();
  insert into public.ai_runs (id, revision_id, quota_scope, stage, source_set_fingerprint,
                              pre_run_canonical_inputs, pre_run_ai_state, model, reasoning_effort,
                              prompt_version, output_schema_version, guidance_registry_hash,
                              owner_user_id, openai_started_at, completed_at)
  values (v_run2, v_rev, 'authenticated', 'succeeded', v_fp, '{"origin":"legacy"}'::jsonb,
          jsonb_build_object('sourceState', 'current', 'sourceSetFingerprint', 'fp-old',
                             'fieldProvenance', '{}'::jsonb, 'objectProvenance', '{}'::jsonb,
                             'tombstones', '[]'::jsonb, 'reviewItems', '[]'::jsonb),
          'm', 'high', 'p9g', 's1', 'h9g', v_user, now(), now());
  insert into public.ai_analysis_state (revision_id, last_successful_run_id,
                                        source_set_fingerprint, source_state)
  values (v_rev, v_run2, v_fp, 'current');

  select lock_version into v_lock from public.analysis_revisions where id = v_rev;
  begin
    perform public.arc_restore_pre_ai_run(v_run2, v_user, null, v_lock);
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results values (
    '10 a snapshot that predates the acknowledgment fields is refused, not partly restored', ok);

  insert into arc_test_results
  select '11 a refused legacy restore changes nothing at all',
         (select canonical_inputs from public.analysis_revisions where id = v_rev)
           = '{"origin":"first"}'::jsonb
     and (select lock_version from public.analysis_revisions where id = v_rev) = v_lock
     and (select source_state from public.ai_analysis_state where revision_id = v_rev) = 'current'
     and (select restored_at is null from public.ai_runs where id = v_run2);

  /* ------------------------------------------- changed source set (12-13) */

  -- A completed run is immutable, so each case below gets its own run row.
  select lock_version into v_lock from public.analysis_revisions where id = v_rev;
  v_lock := public.arc_attach_source_document(v_user, v_rev, v_doc2, v_lock);

  v_prior := jsonb_build_object(
    'last_successful_run_id', null, 'source_set_fingerprint', null,
    'source_state', 'none', 'field_provenance', '{}'::jsonb,
    'object_provenance', '{}'::jsonb, 'tombstones', '[]'::jsonb, 'review_items', '[]'::jsonb,
    'acknowledged_source_fingerprint', null, 'source_acknowledged_at', null,
    'source_acknowledged_by', null);

  v_run2 := gen_random_uuid();
  insert into public.ai_runs (id, revision_id, quota_scope, stage, source_set_fingerprint,
                              pre_run_canonical_inputs, pre_run_ai_state, model, reasoning_effort,
                              prompt_version, output_schema_version, guidance_registry_hash,
                              owner_user_id, openai_started_at, completed_at)
  values (v_run2, v_rev, 'authenticated', 'succeeded', v_fp, '{"origin":"moved"}'::jsonb,
          v_prior, 'm', 'high', 'p9g', 's1', 'h9g', v_user, now(), now());
  update public.ai_analysis_state set last_successful_run_id = v_run2 where revision_id = v_rev;
  if not found then
    insert into public.ai_analysis_state (revision_id, last_successful_run_id, source_state)
    values (v_rev, v_run2, 'current');
  end if;

  select lock_version into v_lock from public.analysis_revisions where id = v_rev;
  begin
    perform public.arc_restore_pre_ai_run(v_run2, v_user, null, v_lock);
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results values (
    '12 a restore is refused once the selected source documents have changed', ok);

  insert into arc_test_results
  select '13 a refused source-set restore changes nothing at all',
         (select canonical_inputs from public.analysis_revisions where id = v_rev)
           = '{"origin":"first"}'::jsonb
     and (select lock_version from public.analysis_revisions where id = v_rev) = v_lock
     and (select count(*) from public.revision_source_documents where revision_id = v_rev) = 2
     and (select restored_at is null from public.ai_runs where id = v_run2);

  /* ------------------------------------------------- scope and locks (14-17) */

  v_run2 := gen_random_uuid();
  insert into public.ai_runs (id, revision_id, quota_scope, stage, source_set_fingerprint,
                              pre_run_canonical_inputs, pre_run_ai_state, model, reasoning_effort,
                              prompt_version, output_schema_version, guidance_registry_hash,
                              owner_user_id, openai_started_at, completed_at)
  values (v_run2, v_rev, 'authenticated', 'succeeded',
          public.arc_ai_source_set_fingerprint(v_rev, null), '{"origin":"eligible"}'::jsonb,
          v_prior, 'm', 'high', 'p9g', 's1', 'h9g', v_user, now(), now());
  update public.ai_analysis_state set last_successful_run_id = v_run2 where revision_id = v_rev;

  begin
    perform public.arc_restore_pre_ai_run(v_run2, v_other, null, v_lock);
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results values ('14 another accountant cannot restore this analysis', ok);

  begin
    perform public.arc_restore_pre_ai_run(v_run2, v_user, null, v_lock + 5);
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results values ('15 a stale expected lock refuses the restore', ok);

  v_run := gen_random_uuid();
  insert into public.ai_runs (id, revision_id, quota_scope, stage, source_set_fingerprint,
                              pre_run_canonical_inputs, model, reasoning_effort, prompt_version,
                              output_schema_version, guidance_registry_hash, owner_user_id)
  values (v_run, v_rev, 'authenticated', 'analyzing', 'fp-active', '{}'::jsonb,
          'm', 'high', 'p9g', 's1', 'h9g', v_user);
  begin
    perform public.arc_restore_pre_ai_run(v_run2, v_user, null, v_lock);
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results values (
    '16 a restore is refused while another AI analysis is running', ok);
  update public.ai_runs set stage = 'failed', failure_stage = 'analyzing',
         failure_category = 'test', failure_code = 'test', safe_message = 'test'
   where id = v_run;

  select count(*) into v_runs from public.ai_runs where revision_id = v_rev;
  select count(*) into v_sources from public.revision_source_documents where revision_id = v_rev;
  select lock_version into v_lock from public.analysis_revisions where id = v_rev;
  select lock_version, idempotent into v_lock_after, v_idem
  from public.arc_restore_pre_ai_run(v_run2, v_user, null, v_lock);


  insert into arc_test_results
  select '17 the eligible restore succeeds and leaves history and sources alone',
         v_idem is false
     and v_lock_after = v_lock + 1
     and (select count(*) from public.ai_runs where revision_id = v_rev) = v_runs
     and (select count(*) from public.revision_source_documents where revision_id = v_rev) = v_sources;
end $task9$;

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
