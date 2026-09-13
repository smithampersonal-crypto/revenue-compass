-- ARC Phase 8E — temporary (guest) workspace documents and document-aware
-- guest-to-account migration.
-- Runs inside a rolled-back transaction with synthetic auth users only.
-- Every row must report passed = true.
begin;

create temporary table arc_test_results (assertion text, passed boolean not null) on commit drop;

-- 01/02 Guest selections are server-only: no direct Data API access at all.
insert into arc_test_results values (
  '01 anon has no table privileges on guest_source_document_selections',
  not (
    has_table_privilege('anon', 'public.guest_source_document_selections', 'select')
    or has_table_privilege('anon', 'public.guest_source_document_selections', 'insert')
    or has_table_privilege('anon', 'public.guest_source_document_selections', 'update')
    or has_table_privilege('anon', 'public.guest_source_document_selections', 'delete')
  )
);
insert into arc_test_results values (
  '02 authenticated has no table privileges on guest_source_document_selections',
  not (
    has_table_privilege('authenticated', 'public.guest_source_document_selections', 'select')
    or has_table_privilege('authenticated', 'public.guest_source_document_selections', 'insert')
    or has_table_privilege('authenticated', 'public.guest_source_document_selections', 'update')
    or has_table_privilege('authenticated', 'public.guest_source_document_selections', 'delete')
  )
);

-- 03..08 The trusted guest selection operations are service-role only.
insert into arc_test_results values (
  '03 anon cannot execute arc_attach_guest_source_document',
  not has_function_privilege('anon',
    'public.arc_attach_guest_source_document(text,uuid,integer)', 'execute'));
insert into arc_test_results values (
  '04 authenticated cannot execute arc_attach_guest_source_document',
  not has_function_privilege('authenticated',
    'public.arc_attach_guest_source_document(text,uuid,integer)', 'execute'));
insert into arc_test_results values (
  '05 service_role can execute arc_attach_guest_source_document',
  has_function_privilege('service_role',
    'public.arc_attach_guest_source_document(text,uuid,integer)', 'execute'));
insert into arc_test_results values (
  '06 anon cannot execute arc_remove_guest_source_document',
  not has_function_privilege('anon',
    'public.arc_remove_guest_source_document(text,uuid,integer)', 'execute'));
insert into arc_test_results values (
  '07 authenticated cannot execute arc_remove_guest_source_document',
  not has_function_privilege('authenticated',
    'public.arc_remove_guest_source_document(text,uuid,integer)', 'execute'));
insert into arc_test_results values (
  '08 service_role can execute arc_remove_guest_source_document',
  has_function_privilege('service_role',
    'public.arc_remove_guest_source_document(text,uuid,integer)', 'execute'));

do $$
declare
  owner_id uuid := '00000000-0000-4000-8000-0000000008e1';
  hash_main text := repeat('1', 64);
  hash_other text := repeat('2', 64);
  hash_expired text := repeat('3', 64);
  hash_unknown text := repeat('4', 64);
  ws_main uuid; ws_other uuid; ws_expired uuid;
  doc_a uuid; doc_b uuid; doc_c uuid; doc_other uuid; doc_del uuid;
  draft jsonb := '{"schemaVersion":"arc.workflow.v1","contract":{"customerName":"Guest Co"}}'::jsonb;
  lock_now integer; lock_after integer;
  failed boolean; res record; res2 record;
  doc_count integer;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (owner_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'arc-8e-owner@example.test', '', now(), now(), now());

  insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at)
  values (hash_main, draft, 'arc.workflow.v1', now() + interval '9 hours') returning id into ws_main;
  insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at)
  values (hash_other, draft, 'arc.workflow.v1', now() + interval '9 hours') returning id into ws_other;
  insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at)
  values (hash_expired, draft, 'arc.workflow.v1', now() - interval '1 minute') returning id into ws_expired;

  insert into public.source_documents (guest_workspace_id, storage_object_path, original_filename,
    display_name, document_type, effective_date, sha256, byte_size, page_count)
  values (ws_main, 'guest/a.pdf', 'a.pdf', 'Master Agreement A', 'Master Agreement',
          date '2026-01-01', repeat('a', 64), 1000, 4) returning id into doc_a;
  insert into public.source_documents (guest_workspace_id, storage_object_path, original_filename,
    display_name, sha256, byte_size, page_count)
  values (ws_main, 'guest/b.pdf', 'b.pdf', 'Order Form B', repeat('b', 64), 2000, 2)
  returning id into doc_b;
  insert into public.source_documents (guest_workspace_id, storage_object_path, original_filename,
    display_name, sha256, byte_size, page_count)
  values (ws_main, 'guest/c.pdf', 'c.pdf', 'Unused C', repeat('c', 64), 3000, 1)
  returning id into doc_c;
  insert into public.source_documents (guest_workspace_id, storage_object_path, original_filename,
    display_name, sha256, byte_size, page_count)
  values (ws_other, 'guest/other.pdf', 'other.pdf', 'Other workspace', repeat('d', 64), 1200, 3)
  returning id into doc_other;
  insert into public.source_documents (guest_workspace_id, storage_object_path, original_filename,
    display_name, sha256, byte_size, page_count)
  values (ws_main, 'guest/del.pdf', 'del.pdf', 'Deletable', repeat('e', 64), 900, 1)
  returning id into doc_del;

  select lock_version into lock_now from public.guest_workspaces where id = ws_main;

  -- 09 An unknown credential can never touch a document.
  failed := false;
  begin
    perform public.arc_attach_guest_source_document(hash_unknown, doc_a, lock_now);
  exception when others then failed := true; end;
  insert into arc_test_results values ('09 unknown credential cannot add a document', failed);

  -- 10 An expired temporary workspace is closed for business.
  failed := false;
  begin
    perform public.arc_attach_guest_source_document(hash_expired, doc_a, 1);
  exception when others then failed := true; end;
  insert into arc_test_results values ('10 expired workspace cannot add a document', failed);

  -- 11 Another workspace's credential can never select this document.
  failed := false;
  begin
    perform public.arc_attach_guest_source_document(hash_other, doc_a, 1);
  exception when others then failed := true; end;
  insert into arc_test_results values ('11 cross-workspace selection is refused', failed);
  insert into arc_test_results
  select '12 nothing was selected by the refused attempts',
         not exists (select 1 from public.guest_source_document_selections
                     where source_document_id = doc_a);

  -- 13/14 A stale expected lock version changes nothing at all.
  failed := false;
  begin
    perform public.arc_attach_guest_source_document(hash_main, doc_a, lock_now + 5);
  exception when sqlstate '40001' then failed := true; end;
  insert into arc_test_results values ('13 stale lock version rejected on add', failed);
  insert into arc_test_results
  select '14 stale add changed neither the selection nor the lock',
         not exists (select 1 from public.guest_source_document_selections
                     where source_document_id = doc_a)
     and (select lock_version from public.guest_workspaces where id = ws_main) = lock_now;

  -- 15/16 The matching lock version adds the document and advances the shared
  -- lock exactly once.
  lock_after := public.arc_attach_guest_source_document(hash_main, doc_a, lock_now);
  insert into arc_test_results
  select '15 add with the current lock version includes the document',
         exists (select 1 from public.guest_source_document_selections
                 where guest_workspace_id = ws_main and source_document_id = doc_a);
  insert into arc_test_results
  select '16 add advances the shared lock exactly once',
         lock_after = lock_now + 1
     and (select lock_version from public.guest_workspaces where id = ws_main) = lock_now + 1;

  -- 17 Adding the same document again is a genuine no-op.
  insert into arc_test_results
  select '17 repeating an add does not advance the lock',
         public.arc_attach_guest_source_document(hash_main, doc_a, lock_now + 1) = lock_now + 1
     and (select lock_version from public.guest_workspaces where id = ws_main) = lock_now + 1
     and (select count(*) from public.guest_source_document_selections
          where guest_workspace_id = ws_main and source_document_id = doc_a) = 1;

  lock_now := lock_now + 1;
  perform public.arc_attach_guest_source_document(hash_main, doc_b, lock_now);
  lock_now := lock_now + 1;
  perform public.arc_attach_guest_source_document(hash_main, doc_del, lock_now);
  lock_now := lock_now + 1;

  -- 18/19 Removal follows exactly the same rules.
  failed := false;
  begin
    perform public.arc_remove_guest_source_document(hash_main, doc_b, lock_now - 1);
  exception when sqlstate '40001' then failed := true; end;
  insert into arc_test_results values ('18 stale lock version rejected on remove', failed);
  insert into arc_test_results
  select '19 stale remove left the document included',
         exists (select 1 from public.guest_source_document_selections
                 where guest_workspace_id = ws_main and source_document_id = doc_b);

  failed := false;
  begin
    perform public.arc_remove_guest_source_document(hash_unknown, doc_b, lock_now);
  exception when others then failed := true; end;
  insert into arc_test_results values ('20 unknown credential cannot remove a document', failed);

  insert into arc_test_results
  select '21 remove with the current lock version excludes the document',
         public.arc_remove_guest_source_document(hash_main, doc_b, lock_now) = lock_now + 1
     and not exists (select 1 from public.guest_source_document_selections
                     where guest_workspace_id = ws_main and source_document_id = doc_b);
  lock_now := lock_now + 1;

  insert into arc_test_results
  select '22 removing a document that is not included is a no-op',
         public.arc_remove_guest_source_document(hash_main, doc_b, lock_now) = lock_now
     and (select lock_version from public.guest_workspaces where id = ws_main) = lock_now;

  -- 23/24/25 Permanent deletion of a guest document.
  failed := false;
  begin
    perform public.arc_stage_source_document_deletion(null, hash_other, doc_del, lock_now);
  exception when others then failed := true; end;
  insert into arc_test_results values ('23 another workspace cannot delete this document', failed);

  failed := false;
  begin
    perform public.arc_stage_source_document_deletion(null, hash_main, doc_del, lock_now + 7);
  exception when sqlstate '40001' then failed := true; end;
  insert into arc_test_results values ('24 stale lock version rejected on delete', failed);
  insert into arc_test_results
  select '25 the refused deletions removed nothing',
         exists (select 1 from public.source_documents where id = doc_del);

  select * into res from public.arc_stage_source_document_deletion(null, hash_main, doc_del, lock_now);
  insert into arc_test_results
  select '26 deletion removes the row, queues the stored file and advances the lock',
         res.queued
     and res.lock_version = lock_now + 1
     and not exists (select 1 from public.source_documents where id = doc_del)
     and exists (select 1 from public.storage_deletion_queue
                 where storage_object_path = 'guest/del.pdf');
  lock_now := lock_now + 1;

  -- The saved state under test: A and C uploaded and included, B uploaded only.
  perform public.arc_attach_guest_source_document(hash_main, doc_c, lock_now);
  lock_now := lock_now + 1;

  -- 27 A failure while the documents are being carried across rolls the whole
  -- save back: no half-saved analysis is ever left behind.
  create or replace function pg_temp.arc_8e_fail() returns trigger
  language plpgsql as $fail$
  begin
    raise exception 'synthetic document migration failure' using errcode = '22023';
  end;
  $fail$;
  create trigger arc_8e_fail_trigger
  before insert on public.revision_source_documents
  for each row execute function pg_temp.arc_8e_fail();

  failed := false;
  begin
    select * into res from public.arc_migrate_guest_workspace_by_token(
      hash_main, owner_id, lock_now, 'Guest Co', 'Rolled back contract', null);
  exception when others then failed := true; end;
  drop trigger arc_8e_fail_trigger on public.revision_source_documents;

  insert into arc_test_results values ('27 a document migration failure aborts the save', failed);
  insert into arc_test_results
  select '28 nothing was created and the documents stayed with the visitor',
         not exists (select 1 from public.contracts where title = 'Rolled back contract')
     and (select status from public.guest_workspaces where id = ws_main) = 'active'
     and (select count(*) from public.source_documents where guest_workspace_id = ws_main) = 3;

  -- 29.. The successful save carries everything across in one transaction.
  select * into res from public.arc_migrate_guest_workspace_by_token(
    hash_main, owner_id, lock_now, 'Guest Co', 'Guest contract', 'G-8E');

  insert into arc_test_results
  select '29 every uploaded PDF moved to the new contract, including unused ones',
         (select count(*) from public.source_documents where contract_id = res.contract_id) = 3
     and not exists (select 1 from public.source_documents where guest_workspace_id = ws_main);

  insert into arc_test_results
  select '30 the moved documents are the same rows, with the same identity',
         exists (select 1 from public.source_documents
                 where id = doc_a and contract_id = res.contract_id
                   and sha256 = repeat('a', 64) and storage_object_path = 'guest/a.pdf'
                   and original_filename = 'a.pdf' and display_name = 'Master Agreement A'
                   and document_type = 'Master Agreement' and effective_date = date '2026-01-01'
                   and byte_size = 1000 and page_count = 4)
     and exists (select 1 from public.source_documents
                 where id = doc_b and contract_id = res.contract_id and sha256 = repeat('b', 64))
     and exists (select 1 from public.source_documents
                 where id = doc_c and contract_id = res.contract_id and sha256 = repeat('c', 64));

  insert into arc_test_results
  select '31 no replacement or duplicate document rows were created',
         (select count(*) from public.source_documents
           where sha256 in (repeat('a', 64), repeat('b', 64), repeat('c', 64))) = 3;

  insert into arc_test_results
  select '32 exactly the included documents became the revision 1 source set',
         (select count(*) from public.revision_source_documents where revision_id = res.revision_id) = 2
     and exists (select 1 from public.revision_source_documents
                 where revision_id = res.revision_id and source_document_id = doc_a)
     and exists (select 1 from public.revision_source_documents
                 where revision_id = res.revision_id and source_document_id = doc_c);

  insert into arc_test_results
  select '33 a document that was not included is not in the revision source set',
         not exists (select 1 from public.revision_source_documents
                     where revision_id = res.revision_id and source_document_id = doc_b);

  insert into arc_test_results
  select '34 the temporary selection rows are gone',
         not exists (select 1 from public.guest_source_document_selections
                     where guest_workspace_id = ws_main);

  insert into arc_test_results
  select '35 revision 1 is a draft carrying the visitor''s inputs',
         exists (select 1 from public.analysis_revisions
                 where id = res.revision_id and revision_number = 1 and status = 'draft'
                   and canonical_inputs = draft);

  insert into arc_test_results
  select '36 the documents now belong to the account that saved them',
         (select count(*) from public.source_documents d
            join public.contracts ct on ct.id = d.contract_id
            join public.customers c on c.id = ct.customer_id
          where c.owner_user_id = owner_id) = 3;

  -- 37 The retired credential can no longer authorize anything.
  failed := false;
  begin
    perform public.arc_attach_guest_source_document(hash_main, doc_b, 1);
  exception when others then failed := true; end;
  insert into arc_test_results values ('37 the old credential can no longer be used', failed);

  -- 38/39 Response-loss retry returns the same result and duplicates nothing.
  select count(*) into doc_count from public.source_documents where contract_id = res.contract_id;
  select * into res2 from public.arc_migrate_guest_workspace_by_token(
    hash_main, owner_id, lock_now, 'Guest Co', 'Retry contract', null);
  insert into arc_test_results values (
    '38 the retry returns exactly the same saved analysis',
    res2.idempotent and res2.customer_id = res.customer_id and res2.contract_id = res.contract_id
      and res2.analysis_id = res.analysis_id and res2.revision_id = res.revision_id);
  insert into arc_test_results
  select '39 the retry created no second copy of anything',
         (select count(*) from public.source_documents where contract_id = res.contract_id) = doc_count
     and (select count(*) from public.revision_source_documents where revision_id = res.revision_id) = 2
     and not exists (select 1 from public.contracts where title = 'Retry contract');

  -- 40 Another visitor's workspace was never touched by any of this.
  insert into arc_test_results
  select '40 a different temporary workspace is untouched',
         exists (select 1 from public.source_documents
                 where id = doc_other and guest_workspace_id = ws_other)
     and (select status from public.guest_workspaces where id = ws_other) = 'active';
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
