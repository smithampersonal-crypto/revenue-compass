-- ARC Phase 8E acceptance — saving under an existing customer, and deleting a
-- never-finalized first draft together with its private documents.
-- Runs inside a rolled-back transaction with synthetic auth users only.
-- Every row must report passed = true.
begin;

create temporary table arc_test_results (assertion text, passed boolean not null) on commit drop;

-- 01/02/03 The trusted transactions are service-role only.
insert into arc_test_results values (
  '01 anon cannot execute arc_delete_initial_draft_contract',
  not has_function_privilege('anon', 'public.arc_delete_initial_draft_contract(uuid,uuid)', 'execute')
);
insert into arc_test_results values (
  '02 authenticated cannot execute arc_delete_initial_draft_contract',
  not has_function_privilege('authenticated', 'public.arc_delete_initial_draft_contract(uuid,uuid)', 'execute')
);
insert into arc_test_results values (
  '03 service_role can execute arc_delete_initial_draft_contract',
  has_function_privilege('service_role', 'public.arc_delete_initial_draft_contract(uuid,uuid)', 'execute')
);

do $$
declare
  owner_id uuid := '00000000-0000-4000-8000-00000000081a';
  other_id uuid := '00000000-0000-4000-8000-00000000081b';
  hash_a text := repeat('1', 64);
  hash_b text := repeat('2', 64);
  hash_c text := repeat('3', 64);
  draft jsonb := '{"schemaVersion":"arc.workflow.v1","contract":{"customerName":"Guest Co"}}'::jsonb;
  guest_a uuid; guest_b uuid; guest_c uuid;
  existing_customer uuid;
  res record;
  doc_id uuid; doc_path text := 'owner/contract/kept.pdf';
  pending_path text := 'pending/unfinished.pdf';
  contract_id uuid; analysis_id uuid; draft_id uuid; kept_customer uuid;
  amend_contract uuid; amend_analysis uuid; amend_draft uuid; amend_final uuid;
  failed boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (owner_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'arc-8e-owner@example.test', '', now(), now(), now()),
         (other_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'arc-8e-other@example.test', '', now(), now(), now());

  insert into public.customers (owner_user_id, name)
  values (owner_id, 'Existing Customer') returning id into existing_customer;

  insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at)
  values (hash_a, draft, 'arc.workflow.v1', now() + interval '9 hours') returning id into guest_a;
  insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at)
  values (hash_b, draft, 'arc.workflow.v1', now() + interval '9 hours') returning id into guest_b;
  insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at)
  values (hash_c, draft, 'arc.workflow.v1', now() + interval '9 hours') returning id into guest_c;

  -- 04 A saved analysis can be filed under a customer the caller already owns,
  -- without creating a second customer row.
  select * into res from public.arc_migrate_guest_workspace_by_token_v2(
    hash_a, owner_id, 1, existing_customer, null, 'Filed under existing', null);
  insert into arc_test_results
  select '04 existing customer reused rather than duplicated',
         res.customer_id = existing_customer
     and (select count(*) from public.customers where owner_user_id = owner_id) = 1
     and exists (select 1 from public.contracts
                 where id = res.contract_id and customer_id = existing_customer);

  -- 05 The response-loss retry returns the same saved hierarchy.
  insert into arc_test_results
  select '05 retry returns the original hierarchy without duplicates',
         (select r2.idempotent and r2.contract_id = res.contract_id
            from public.arc_migrate_guest_workspace_by_token_v2(
              hash_a, owner_id, 1, existing_customer, null, 'Filed again', null) r2)
     and (select count(*) from public.contracts where customer_id = existing_customer) = 1;

  -- 06 A customer belonging to another account is refused, whatever the
  -- browser sent as a hint, and nothing is created.
  failed := false;
  begin
    select * into res from public.arc_migrate_guest_workspace_by_token_v2(
      hash_b, other_id, 1, existing_customer, null, 'Stolen customer', null);
  exception when others then failed := true; end;
  insert into arc_test_results values ('06 a foreign customer hint is refused', failed);
  insert into arc_test_results
  select '07 nothing created by the refused attempt',
         not exists (select 1 from public.contracts where title = 'Stolen customer');

  -- 08 Exactly one customer mode is accepted.
  failed := false;
  begin
    select * into res from public.arc_migrate_guest_workspace_by_token_v2(
      hash_b, owner_id, 1, existing_customer, 'Both modes', 'Both contract', null);
  exception when others then failed := true; end;
  insert into arc_test_results values ('08 both customer modes rejected', failed);

  -- A never-finalized saved analysis, with one stored document and one
  -- unfinished upload.
  select * into res from public.arc_migrate_guest_workspace_by_token_v2(
    hash_c, owner_id, 1, null, 'Delete Me Co', 'Draft only contract', null);
  contract_id := res.contract_id;
  analysis_id := res.analysis_id;
  draft_id := res.revision_id;
  kept_customer := res.customer_id;

  insert into public.source_documents (contract_id, storage_object_path, original_filename,
    display_name, sha256, byte_size, page_count)
  values (contract_id, doc_path, 'kept.pdf', 'Kept', repeat('a', 64), 1000, 2)
  returning id into doc_id;

  insert into public.document_upload_intents (contract_id, pending_object_path,
    original_filename, display_name, expires_at)
  values (contract_id, pending_path, 'unfinished.pdf', 'Unfinished', now() + interval '1 hour');

  -- 09 Another account cannot delete it.
  failed := false;
  begin
    perform public.arc_delete_initial_draft_contract(other_id, contract_id);
  exception when others then failed := true; end;
  insert into arc_test_results values ('09 another account cannot delete the draft contract', failed);
  insert into arc_test_results
  select '10 the contract survives the refused deletion',
         exists (select 1 from public.contracts where id = contract_id);

  -- 11..15 The owner's deletion removes the contract and everything under it,
  -- queues every private object first, and leaves the customer in place.
  perform public.arc_delete_initial_draft_contract(owner_id, contract_id);
  insert into arc_test_results
  select '11 the contract is deleted', not exists (select 1 from public.contracts where id = contract_id);
  insert into arc_test_results
  select '12 the customer remains',
         exists (select 1 from public.customers where id = kept_customer);
  insert into arc_test_results
  select '13 analysis, draft revision and document rows are gone',
         not exists (select 1 from public.analyses where id = analysis_id)
     and not exists (select 1 from public.analysis_revisions where id = draft_id)
     and not exists (select 1 from public.source_documents where id = doc_id);
  insert into arc_test_results
  select '14 the stored document path was queued for deletion',
         exists (select 1 from public.storage_deletion_queue
                 where storage_object_path = doc_path and storage_bucket = 'arc-source-documents');
  insert into arc_test_results
  select '15 the unfinished upload path was queued too',
         exists (select 1 from public.storage_deletion_queue where storage_object_path = pending_path);

  -- 16/17 Finalized history fails closed, and an amendment draft may not use
  -- this deletion at all.
  insert into public.contracts (customer_id, title) values (existing_customer, 'Finalized contract')
  returning id into amend_contract;
  insert into public.analyses (contract_id) values (amend_contract) returning id into amend_analysis;
  insert into public.analysis_revisions (analysis_id, revision_number, canonical_inputs, schema_version)
  values (amend_analysis, 1, draft, 'arc.workflow.v1') returning id into amend_final;
  -- The accepted lifecycle transactions create the history, so this suite
  -- never writes a finalized revision by hand.
  perform public.arc_finalize_revision(owner_id, amend_final, 1,
    '{"o":1}'::jsonb, '{"r":1}'::jsonb, 'arc.workflow.v1', 'arc.engine.v1');
  select r.revision_id into amend_draft
    from public.arc_start_amendment_revision(owner_id, amend_contract, amend_final) r;

  failed := false;
  begin
    perform public.arc_delete_initial_draft_contract(owner_id, amend_contract);
  exception when others then failed := true; end;
  insert into arc_test_results values (
    '16 an amendment draft over finalized history cannot be deleted this way', failed);
  insert into arc_test_results
  select '17 the finalized contract and its revisions survive',
         exists (select 1 from public.contracts where id = amend_contract)
     and exists (select 1 from public.analysis_revisions where id = amend_final and status = 'finalized')
     and exists (select 1 from public.analysis_revisions where id = amend_draft);
end $$;

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
