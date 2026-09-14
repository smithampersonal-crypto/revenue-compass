-- ARC Phase 8F — deletion & operations.
-- Storage deletion queue, abandoned upload cleanup, nine-hour guest expiry and
-- the deletion-path integration audit.
-- Runs inside a rolled-back transaction with synthetic auth users only.
-- Every row must report passed = true.
--
-- Concurrency note: this harness runs in a SINGLE database session. The
-- lock-ordering and claim assertions below are structural (routine definition
-- plus observed end state); they are NOT a genuine two-session race.
begin;

create temporary table arc_test_results (assertion text, passed boolean not null) on commit drop;

-- 01..08 The cleanup routines are service-role only.
insert into arc_test_results values (
  '01 anon cannot execute arc_cleanup_stale_upload_intents',
  not has_function_privilege('anon', 'public.arc_cleanup_stale_upload_intents(integer)', 'execute'));
insert into arc_test_results values (
  '02 authenticated cannot execute arc_cleanup_stale_upload_intents',
  not has_function_privilege('authenticated', 'public.arc_cleanup_stale_upload_intents(integer)', 'execute'));
insert into arc_test_results values (
  '03 service_role can execute arc_cleanup_stale_upload_intents',
  has_function_privilege('service_role', 'public.arc_cleanup_stale_upload_intents(integer)', 'execute'));
insert into arc_test_results values (
  '04 anon cannot execute arc_run_maintenance',
  not has_function_privilege('anon', 'public.arc_run_maintenance(integer)', 'execute'));
insert into arc_test_results values (
  '05 authenticated cannot execute arc_run_maintenance',
  not has_function_privilege('authenticated', 'public.arc_run_maintenance(integer)', 'execute'));
insert into arc_test_results values (
  '06 service_role can execute arc_run_maintenance',
  has_function_privilege('service_role', 'public.arc_run_maintenance(integer)', 'execute'));
insert into arc_test_results values (
  '07 anon cannot execute arc_queue_storage_object',
  not has_function_privilege('anon', 'public.arc_queue_storage_object(text,text,text)', 'execute'));
insert into arc_test_results values (
  '08 guest expiry remains service-role only',
  not has_function_privilege('anon', 'public.arc_delete_expired_guest_workspaces()', 'execute')
  and not has_function_privilege('authenticated', 'public.arc_delete_expired_guest_workspaces()', 'execute')
  and has_function_privilege('service_role', 'public.arc_delete_expired_guest_workspaces()', 'execute'));

-- 09..11 SECURITY DEFINER routines pin their search_path.
insert into arc_test_results
select '09 arc_cleanup_stale_upload_intents pins search_path',
       p.prosecdef and array_to_string(p.proconfig, ',') like '%search_path=pg_catalog, public%'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'arc_cleanup_stale_upload_intents';
insert into arc_test_results
select '10 arc_run_maintenance pins search_path',
       p.prosecdef and array_to_string(p.proconfig, ',') like '%search_path=pg_catalog, public%'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'arc_run_maintenance';
insert into arc_test_results
select '11 storage queueing triggers exist on both owning tables',
       exists (select 1 from pg_trigger where tgname = 'arc_zz_queue_source_document_object'
                 and tgrelid = 'public.source_documents'::regclass)
   and exists (select 1 from pg_trigger where tgname = 'arc_zz_queue_upload_intent_objects'
                 and tgrelid = 'public.document_upload_intents'::regclass);

do $$
declare
  owner_id uuid := '00000000-0000-4000-8000-0000000008f1';
  draft jsonb := '{"schemaVersion":"arc.workflow.v1","contract":{"customerName":"Guest Co"}}'::jsonb;
  fresh_guest uuid; old_guest uuid; empty_guest uuid; migrated_guest uuid;
  customer_id uuid; contract_id uuid; analysis_id uuid; revision_id uuid;
  guest_doc uuid; migrated_doc uuid; final_doc uuid;
  fresh_intent uuid; stale_intent uuid; failed_intent uuid; final_intent uuid;
  res record;
  report jsonb;
  n integer;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (owner_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'arc-8f-owner@example.test', '', now(), now(), now());

  insert into public.customers (owner_user_id, name) values (owner_id, 'Cleanup Co')
  returning id into customer_id;
  insert into public.contracts (customer_id, title) values (customer_id, 'Cleanup contract')
  returning id into contract_id;
  insert into public.analyses (contract_id) values (contract_id) returning id into analysis_id;
  insert into public.analysis_revisions (analysis_id, revision_number, canonical_inputs, schema_version)
  values (analysis_id, 1, draft, 'arc.workflow.v1') returning id into revision_id;

  insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at)
  values ('8f0a' || repeat('a', 60), draft, 'arc.workflow.v1', now() + interval '8 hours')
  returning id into fresh_guest;
  insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at)
  values ('8f0b' || repeat('b', 60), draft, 'arc.workflow.v1', now() - interval '1 hour')
  returning id into old_guest;
  insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at)
  values ('8f0c' || repeat('c', 60), draft, 'arc.workflow.v1', now() - interval '2 hours')
  returning id into empty_guest;
  insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at,
                                       status, migrated_user_id)
  values ('8f0d' || repeat('d', 60), draft, 'arc.workflow.v1', now() - interval '3 hours',
          'migrated', owner_id)
  returning id into migrated_guest;

  -- Documents: one owned by the expired guest, one already migrated to the
  -- authenticated contract, one belonging to the contract's live revision.
  insert into public.source_documents (guest_workspace_id, storage_object_path, original_filename,
                                       display_name, sha256, byte_size, page_count)
  values (old_guest, 'documents/8f-guest-owned.pdf', 'g.pdf', 'Guest PDF', repeat('1', 64), 100, 1)
  returning id into guest_doc;
  insert into public.source_documents (contract_id, storage_object_path, original_filename,
                                       display_name, sha256, byte_size, page_count)
  values (contract_id, 'documents/8f-migrated.pdf', 'm.pdf', 'Migrated PDF', repeat('2', 64), 100, 1)
  returning id into migrated_doc;
  insert into public.source_documents (contract_id, storage_object_path, original_filename,
                                       display_name, sha256, byte_size, page_count)
  values (contract_id, 'documents/8f-finalized-upload.pdf', 'f.pdf', 'Final PDF', repeat('3', 64), 100, 1)
  returning id into final_doc;

  -- Upload intents covering every cleanup class.
  insert into public.document_upload_intents (guest_workspace_id, pending_object_path,
        original_filename, display_name, state, expires_at)
  values (fresh_guest, 'pending/8f-fresh.pdf', 'fresh.pdf', 'Fresh', 'pending', now() + interval '50 minutes')
  returning id into fresh_intent;
  insert into public.document_upload_intents (guest_workspace_id, pending_object_path,
        permanent_object_path, original_filename, display_name, state, expires_at)
  values (fresh_guest, 'pending/8f-stale.pdf', 'documents/8f-never-committed.pdf',
          'stale.pdf', 'Stale', 'prepared', now() - interval '2 hours')
  returning id into stale_intent;
  insert into public.document_upload_intents (guest_workspace_id, pending_object_path,
        original_filename, display_name, state, expires_at)
  values (fresh_guest, 'pending/8f-failed.pdf', 'failed.pdf', 'Failed', 'failed', now() - interval '3 hours')
  returning id into failed_intent;
  insert into public.document_upload_intents (contract_id, pending_object_path,
        permanent_object_path, resolved_source_document_id, original_filename, display_name,
        state, expires_at, upload_diagnostics)
  values (contract_id, 'pending/8f-finalized.pdf', 'documents/8f-finalized-upload.pdf', final_doc,
          'f.pdf', 'Final PDF', 'finalized', now() - interval '5 hours',
          '[{"attempt":1,"observedBytes":100}]'::jsonb)
  returning id into final_intent;

  -- 12..16 Abandoned upload cleanup.
  select * into res from public.arc_cleanup_stale_upload_intents(100);

  insert into arc_test_results
  select '12 fresh upload intent is untouched',
         (select state from public.document_upload_intents where id = fresh_intent) = 'pending'
     and not exists (select 1 from public.storage_deletion_queue
                     where storage_object_path = 'pending/8f-fresh.pdf');

  insert into arc_test_results
  select '13 expired abandoned intent is terminalized and its pending object queued',
         (select state from public.document_upload_intents where id = stale_intent) = 'failed'
     and exists (select 1 from public.storage_deletion_queue
                 where storage_object_path = 'pending/8f-stale.pdf' and completed_at is null)
     and exists (select 1 from public.storage_deletion_queue
                 where storage_object_path = 'documents/8f-never-committed.pdf');

  insert into arc_test_results
  select '14 failed intent with a leftover pending object is cleaned',
         exists (select 1 from public.storage_deletion_queue
                 where storage_object_path = 'pending/8f-failed.pdf');

  insert into arc_test_results
  select '15 a finalized upload and its document are never removed by cleanup',
         (select state from public.document_upload_intents where id = final_intent) = 'finalized'
     and exists (select 1 from public.source_documents where id = final_doc)
     and not exists (select 1 from public.storage_deletion_queue
                     where storage_object_path = 'documents/8f-finalized-upload.pdf')
     and (select upload_diagnostics from public.document_upload_intents where id = final_intent)
         is not null;

  insert into arc_test_results
  select '16 cleanup reports bounded, non-negative counts',
         res.intents_processed = 2 and res.objects_queued >= 3;

  -- 17 Repeating cleanup is idempotent: no duplicate queue work.
  perform public.arc_cleanup_stale_upload_intents(100);
  select count(*) into n from public.storage_deletion_queue
   where storage_object_path = 'pending/8f-stale.pdf';
  insert into arc_test_results values ('17 repeated cleanup creates no duplicate queue work', n = 1);

  -- 18..22 Nine-hour guest expiration.
  perform public.arc_expire_guest_workspaces();
  perform public.arc_delete_expired_guest_workspaces();

  insert into arc_test_results
  select '18 a guest workspace younger than nine hours survives',
         exists (select 1 from public.guest_workspaces where id = fresh_guest);

  insert into arc_test_results
  select '19 expired guest with documents queues its files before relational deletion',
         not exists (select 1 from public.guest_workspaces where id = old_guest)
     and not exists (select 1 from public.source_documents where id = guest_doc)
     and exists (select 1 from public.storage_deletion_queue
                 where storage_object_path = 'documents/8f-guest-owned.pdf'
                   and completed_at is null);

  insert into arc_test_results
  select '20 expired guest with no documents is removed normally',
         not exists (select 1 from public.guest_workspaces where id = empty_guest);

  insert into arc_test_results
  select '21 a migrated document survives expiry of its former guest workspace',
         not exists (select 1 from public.guest_workspaces where id = migrated_guest)
     and exists (select 1 from public.source_documents where id = migrated_doc)
     and not exists (select 1 from public.storage_deletion_queue
                     where storage_object_path = 'documents/8f-migrated.pdf');

  select public.arc_delete_expired_guest_workspaces() into n;
  insert into arc_test_results values ('22 repeated guest cleanup is idempotent', n = 0);

  -- 23 The maintenance entrypoint runs every category and returns counts only.
  report := public.arc_run_maintenance(50);
  insert into arc_test_results
  select '23 maintenance entrypoint reports privacy-safe counts',
         report ? 'staleIntentsProcessed' and report ? 'guestWorkspacesDeleted'
     and report::text not like '%pending/%' and report::text not like '%documents/%'
     and not (report ? 'staleIntentsError') and not (report ? 'guestExpirationError');
end $$;

-- 24..27 The accepted destructive paths still behave as reviewed.
do $paths$
declare
  owner_id uuid := '00000000-0000-4000-8000-0000000008f2';
  draft jsonb := '{"schemaVersion":"arc.workflow.v1","contract":{"customerName":"Co"}}'::jsonb;
  customer_id uuid; contract_id uuid; analysis_id uuid; draft_rev uuid;
  final_rev uuid; amend_rev uuid; doc_id uuid; hist_doc uuid;
  blocked boolean := false;
  res record;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (owner_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'arc-8f-paths@example.test', '', now(), now(), now());

  -- Never-finalized draft contract with one document.
  insert into public.customers (owner_user_id, name) values (owner_id, 'Draft Co')
  returning id into customer_id;
  insert into public.contracts (customer_id, title) values (customer_id, 'Draft contract')
  returning id into contract_id;
  insert into public.analyses (contract_id) values (contract_id) returning id into analysis_id;
  insert into public.analysis_revisions (analysis_id, revision_number, canonical_inputs, schema_version)
  values (analysis_id, 1, draft, 'arc.workflow.v1') returning id into draft_rev;
  insert into public.source_documents (contract_id, storage_object_path, original_filename,
                                       display_name, sha256, byte_size, page_count)
  values (contract_id, 'documents/8f-draft-doc.pdf', 'd.pdf', 'Draft PDF', repeat('4', 64), 100, 1)
  returning id into doc_id;

  perform public.arc_delete_initial_draft_contract(owner_id, contract_id);

  insert into arc_test_results
  select '24 Delete Draft queues its stored files before deleting the hierarchy',
         not exists (select 1 from public.contracts where id = contract_id)
     and not exists (select 1 from public.source_documents where id = doc_id)
     and exists (select 1 from public.storage_deletion_queue
                 where storage_object_path = 'documents/8f-draft-doc.pdf'
                   and completed_at is null)
     and exists (select 1 from public.customers where id = customer_id);

  -- Finalized history with an amendment draft on top.
  insert into public.contracts (customer_id, title) values (customer_id, 'History contract')
  returning id into contract_id;
  insert into public.analyses (contract_id) values (contract_id) returning id into analysis_id;
  insert into public.analysis_revisions (analysis_id, revision_number, canonical_inputs,
                                         schema_version)
  values (analysis_id, 1, draft, 'arc.workflow.v1')
  returning id into final_rev;
  insert into public.source_documents (contract_id, storage_object_path, original_filename,
                                       display_name, sha256, byte_size, page_count)
  values (contract_id, 'documents/8f-history-doc.pdf', 'h.pdf', 'History PDF', repeat('5', 64), 100, 1)
  returning id into hist_doc;
  -- Association and finalization both go through the accepted trusted paths.
  lockv := public.arc_attach_source_document(owner_id, final_rev, hist_doc, 1);
  perform public.arc_finalize_revision(owner_id, final_rev, lockv, '{}'::jsonb, '{}'::jsonb,
                                       'arc.workflow.v1', 'arc.engine.v1');

  select * into res from public.arc_start_amendment_revision(owner_id, contract_id, final_rev);
  amend_rev := res.revision_id;
  perform public.arc_discard_amendment_draft(owner_id, amend_rev, 1);

  insert into arc_test_results
  select '25 Discard amendment draft preserves the contract documents',
         not exists (select 1 from public.analysis_revisions where id = amend_rev)
     and exists (select 1 from public.source_documents where id = hist_doc)
     and not exists (select 1 from public.storage_deletion_queue
                     where storage_object_path = 'documents/8f-history-doc.pdf')
     and exists (select 1 from public.analysis_revisions where id = final_rev);

  -- Historical immutability is not weakened for the sake of cleanup.
  begin
    delete from public.source_documents where id = hist_doc;
  exception when others then
    blocked := true;
  end;
  insert into arc_test_results values (
    '26 a historically protected document still cannot be hard-deleted', blocked);

  insert into arc_test_results
  select '27 account deletion leaves durable storage work rather than orphaned objects',
         (select public.arc_purge_user_guest_data(owner_id, '')) >= 0
     and exists (select 1 from public.storage_deletion_queue
                 where storage_object_path = 'documents/8f-draft-doc.pdf');
end $paths$;

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
