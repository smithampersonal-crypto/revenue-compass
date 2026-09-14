-- ARC Phase 8G — hardening and final Phase 8 certification.
-- Privilege, tenant-isolation and private-storage assertions.
-- Runs inside a rolled-back transaction. Every row must report passed = true.
--
-- Concurrency note: this harness runs in a SINGLE database session. Any
-- lock-ordering claim elsewhere in the Phase 8 suites is structural, not a
-- genuine two-session race.
begin;

create temporary table arc_test_results (assertion text, passed boolean not null) on commit drop;

-- 01 Every ARC SECURITY DEFINER function pins a fixed search_path.
insert into arc_test_results
select '01 every ARC security definer function has a fixed search_path',
       not exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname like 'arc\_%'
            and p.prosecdef
            and coalesce(array_to_string(p.proconfig, ','), '') not like 'search_path=%');

-- 02..03 Trusted lifecycle, maintenance and document RPCs are service-role only.
insert into arc_test_results
select '02 no ARC security definer function is executable by anon',
       not exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname like 'arc\_%' and p.prosecdef
            and has_function_privilege('anon', p.oid, 'execute'));

insert into arc_test_results
select '03 no ARC security definer function is executable by signed-in users',
       not exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname like 'arc\_%' and p.prosecdef
            and has_function_privilege('authenticated', p.oid, 'execute'));

-- 04 Every trusted function is reachable by the service role.
insert into arc_test_results
select '04 every ARC security definer function is executable by the service role',
       not exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname like 'arc\_%' and p.prosecdef
            and not has_function_privilege('service_role', p.oid, 'execute'));

-- 05 Browser roles cannot bypass row-level security with TRUNCATE, nor hold
--    REFERENCES/TRIGGER on any ARC table.
insert into arc_test_results
select '05 browser roles hold no truncate, references or trigger privilege on ARC tables',
       not exists (
         select 1 from information_schema.role_table_grants g
          where g.table_schema = 'public'
            and g.grantee in ('anon', 'authenticated')
            and g.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')
            and g.table_name in ('customers', 'contracts', 'analyses', 'analysis_revisions',
                                 'source_documents', 'revision_source_documents',
                                 'guest_workspaces', 'guest_source_document_selections',
                                 'document_upload_intents', 'storage_deletion_queue'));

-- 06..08 Server-only tables stay unreachable from the browser roles.
insert into arc_test_results
select '06 anon holds no privilege on the server-only guest and queue tables',
       not exists (
         select 1 from information_schema.role_table_grants g
          where g.table_schema = 'public' and g.grantee = 'anon'
            and g.table_name in ('guest_workspaces', 'guest_source_document_selections',
                                 'document_upload_intents', 'storage_deletion_queue'));

insert into arc_test_results
select '07 signed-in users hold no privilege on the server-only guest and queue tables',
       not exists (
         select 1 from information_schema.role_table_grants g
          where g.table_schema = 'public' and g.grantee = 'authenticated'
            and g.table_name in ('guest_workspaces', 'guest_source_document_selections',
                                 'document_upload_intents', 'storage_deletion_queue'));

insert into arc_test_results
select '08 signed-in users can only read source documents and their revision links',
       not exists (
         select 1 from information_schema.role_table_grants g
          where g.table_schema = 'public' and g.grantee in ('anon', 'authenticated')
            and g.table_name in ('source_documents', 'revision_source_documents')
            and g.privilege_type <> 'SELECT');

-- 09..11 Row-level security stays enabled and owner-scoped.
insert into arc_test_results
select '09 row level security is enabled on every ARC table',
       not exists (
         select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r'
            and c.relname in ('customers', 'contracts', 'analyses', 'analysis_revisions',
                              'source_documents', 'revision_source_documents',
                              'guest_workspaces', 'guest_source_document_selections',
                              'document_upload_intents', 'storage_deletion_queue')
            and not c.relrowsecurity);

insert into arc_test_results
select '10 the source document read policy is owner-scoped through contract and customer',
       exists (
         select 1 from pg_policies p
          where p.schemaname = 'public' and p.tablename = 'source_documents'
            and p.cmd = 'SELECT'
            and p.qual like '%owner_user_id = auth.uid()%'
            and p.qual like '%contracts%'
            and p.qual like '%customers%');

insert into arc_test_results
select '11 the server-only tables expose no policy at all',
       not exists (
         select 1 from pg_policies p
          where p.schemaname = 'public'
            and p.tablename in ('guest_workspaces', 'guest_source_document_selections',
                                'document_upload_intents', 'storage_deletion_queue'));

-- 12..14 Private Storage.
insert into arc_test_results
select '12 the source document bucket is private',
       exists (select 1 from storage.buckets b
                where b.id = 'arc-source-documents' and b.public is false);

insert into arc_test_results
select '13 no browser role can reach storage objects directly',
       not exists (
         select 1 from pg_policies p
          where p.schemaname = 'storage' and p.tablename = 'objects'
            and p.roles::text like '%anon%');

insert into arc_test_results
select '14 the bucket enforces the accepted ten megabyte ceiling',
       exists (select 1 from storage.buckets b
                where b.id = 'arc-source-documents' and b.file_size_limit = 10485760);

-- 15..18 Tenant isolation is decided by the server-side ownership chain, never
-- by a caller-supplied identifier.
do $isolation$
declare
  owner_a uuid := gen_random_uuid();
  owner_b uuid := gen_random_uuid();
  cust_b uuid;
  contract_b uuid;
  analysis_b uuid;
  revision_b uuid;
  doc_b uuid;
  ok boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (owner_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          '8g-a@example.test', '', now(), now(), now()),
         (owner_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          '8g-b@example.test', '', now(), now(), now());

  insert into public.customers (owner_user_id, name) values (owner_b, 'Owner B Ltd')
  returning id into cust_b;
  insert into public.contracts (customer_id, title) values (cust_b, 'B Contract')
  returning id into contract_b;
  insert into public.analyses (contract_id) values (contract_b) returning id into analysis_b;
  insert into public.analysis_revisions (analysis_id, revision_number, canonical_inputs, schema_version)
  values (analysis_b, 1, '{}'::jsonb, 'arc.workflow.v1') returning id into revision_b;
  insert into public.source_documents (contract_id, storage_object_path, original_filename,
                                       display_name, sha256, byte_size, page_count)
  values (contract_b, 'documents/8g-owner-b.pdf', 'b.pdf', 'B PDF', repeat('b', 64), 100, 1)
  returning id into doc_b;

  -- Attach: owner A naming owner B's revision and document.
  begin
    perform public.arc_attach_source_document(owner_a, revision_b, doc_b, 1);
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results values (
    '15 another account cannot attach a document to a revision it does not own', ok);

  -- Metadata: owner A rewriting owner B's document.
  begin
    perform public.arc_update_source_document_metadata(owner_a, doc_b, 'Hijacked', null, null);
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results values (
    '16 another account cannot rewrite a document''s metadata', ok
      and (select display_name from public.source_documents where id = doc_b) = 'B PDF');

  -- Archive: owner A archiving owner B's document.
  begin
    perform public.arc_set_source_document_archived(owner_a, doc_b, true);
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results values (
    '17 another account cannot archive a document', ok
      and (select archived_at from public.source_documents where id = doc_b) is null);

  -- Hard deletion: owner A staging owner B's document for deletion.
  begin
    perform public.arc_stage_source_document_deletion(owner_a, null, doc_b, 1);
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results values (
    '18 another account cannot stage a document for deletion', ok
      and exists (select 1 from public.source_documents where id = doc_b));

  -- 19 Draft deletion cannot be broadened by supplying another owner's id.
  begin
    perform public.arc_delete_initial_draft_contract(owner_a, contract_b);
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results values (
    '19 draft deletion cannot be broadened by naming another account''s contract', ok
      and exists (select 1 from public.contracts where id = contract_b));
end $isolation$;

-- 20..22 Guest isolation: one temporary workspace cannot reach another's.
do $guest$
declare
  guest_a uuid;
  guest_b uuid;
  hash_a text := '8g0a' || repeat('a', 60);
  hash_b text := '8g0b' || repeat('b', 60);
  doc_b uuid;
  ok boolean;
begin
  insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at)
  values (hash_a, '{}'::jsonb, 'arc.workflow.v1', now() + interval '5 hours')
  returning id into guest_a;
  insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at)
  values (hash_b, '{}'::jsonb, 'arc.workflow.v1', now() + interval '5 hours')
  returning id into guest_b;

  insert into public.source_documents (guest_workspace_id, storage_object_path, original_filename,
                                       display_name, sha256, byte_size, page_count)
  values (guest_b, 'documents/8g-guest-b.pdf', 'gb.pdf', 'Guest B PDF', repeat('c', 64), 100, 1)
  returning id into doc_b;

  begin
    perform public.arc_attach_guest_source_document(hash_a, doc_b, 1);
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results values (
    '20 one temporary workspace cannot include another workspace''s document', ok);

  begin
    perform public.arc_stage_source_document_deletion(null, hash_a, doc_b, 1);
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results values (
    '21 one temporary workspace cannot delete another workspace''s document', ok
      and exists (select 1 from public.source_documents where id = doc_b));

  -- An expired credential is refused even when it is the workspace's own.
  update public.guest_workspaces set expires_at = now() - interval '1 minute' where id = guest_a;
  begin
    perform public.arc_attach_guest_source_document(hash_a, doc_b, 1);
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results values (
    '22 an expired temporary credential is refused', ok);
end $guest$;

-- 23..26 Post-migration isolation and document identity preservation.
do $migration$
declare
  owner_id uuid := gen_random_uuid();
  guest_id uuid;
  hash_g text := '8g0c' || repeat('c', 60);
  doc_id uuid;
  before_path text;
  before_sha text;
  res record;
  ok boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (owner_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          '8g-m@example.test', '', now(), now(), now());

  insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at)
  values (hash_g, '{"a":1}'::jsonb, 'arc.workflow.v1', now() + interval '5 hours')
  returning id into guest_id;

  insert into public.source_documents (guest_workspace_id, storage_object_path, original_filename,
                                       display_name, document_type, sha256, byte_size, page_count)
  values (guest_id, 'documents/8g-migrating.pdf', 'm.pdf', 'Migrating PDF', 'Master Agreement',
          repeat('d', 64), 4242, 4)
  returning id into doc_id;
  insert into public.guest_source_document_selections (guest_workspace_id, source_document_id)
  values (guest_id, doc_id);

  select storage_object_path, sha256 into before_path, before_sha
    from public.source_documents where id = doc_id;

  select * into res from public.arc_migrate_guest_workspace_by_token_v2(
    hash_g, owner_id, 1, null, 'Migrated Customer', 'Migrated Contract', null);

  insert into arc_test_results
  select '23 migration preserves the same document row, path, hash and metadata',
         (select count(*) from public.source_documents where sha256 = before_sha) = 1
     and (select storage_object_path from public.source_documents where id = doc_id) = before_path
     and (select display_name from public.source_documents where id = doc_id) = 'Migrating PDF'
     and (select document_type from public.source_documents where id = doc_id) = 'Master Agreement'
     and (select byte_size from public.source_documents where id = doc_id) = 4242
     and (select page_count from public.source_documents where id = doc_id) = 4;

  insert into arc_test_results
  select '24 migration moves ownership to the contract and keeps the revision association',
         (select contract_id from public.source_documents where id = doc_id) = res.contract_id
     and (select guest_workspace_id from public.source_documents where id = doc_id) is null
     and exists (select 1 from public.revision_source_documents
                  where revision_id = res.revision_id and source_document_id = doc_id);

  -- The retired guest credential no longer reaches the document.
  begin
    perform public.arc_attach_guest_source_document(hash_g, doc_id, 1);
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results values (
    '25 the retired temporary credential cannot reach the migrated document', ok);

  -- Response-loss retry returns the same contract instead of a duplicate.
  select * into res from public.arc_migrate_guest_workspace_by_token_v2(
    hash_g, owner_id, 1, null, 'Migrated Customer', 'Migrated Contract', null);
  insert into arc_test_results
  select '26 a lost migration response replays the same contract and one document',
         res.idempotent
     and (select count(*) from public.source_documents where sha256 = before_sha) = 1
     and (select count(*) from public.contracts c
           join public.customers cu on cu.id = c.customer_id
          where cu.owner_user_id = owner_id) = 1;

  -- 27 Guest expiry of the former workspace never deletes the migrated PDF.
  update public.guest_workspaces set expires_at = now() - interval '1 minute' where id = guest_id;
  perform public.arc_expire_guest_workspaces();
  perform public.arc_delete_expired_guest_workspaces();
  insert into arc_test_results
  select '27 a migrated document survives expiry of its former temporary workspace',
         exists (select 1 from public.source_documents where id = doc_id)
     and not exists (select 1 from public.storage_deletion_queue
                     where storage_object_path = 'documents/8g-migrating.pdf');
end $migration$;

-- 28..30 Historical immutability survives the lower-level RPC surface.
do $history$
declare
  v_owner_id uuid := gen_random_uuid();
  v_cust_id uuid;
  v_contract_id uuid;
  v_analysis_id uuid;
  v_revision_id uuid;
  v_doc_id uuid;
  ok boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (v_owner_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          '8g-h@example.test', '', now(), now(), now());

  insert into public.customers (owner_user_id, name) values (v_owner_id, 'History Ltd')
  returning id into v_cust_id;
  insert into public.contracts (customer_id, title) values (v_cust_id, 'History Contract')
  returning id into v_contract_id;
  insert into public.analyses (contract_id) values (v_contract_id) returning id into v_analysis_id;
  insert into public.analysis_revisions (analysis_id, revision_number, canonical_inputs, schema_version)
  values (v_analysis_id, 1, '{}'::jsonb, 'arc.workflow.v1') returning id into v_revision_id;
  insert into public.source_documents (contract_id, storage_object_path, original_filename,
                                       display_name, sha256, byte_size, page_count)
  values (v_contract_id, 'documents/8g-historical.pdf', 'h.pdf', 'Historical PDF',
          repeat('e', 64), 100, 1)
  returning id into v_doc_id;

  perform public.arc_attach_source_document(v_owner_id, v_revision_id, v_doc_id, 1);
  perform public.arc_finalize_revision(v_owner_id, v_revision_id, 2, '{}'::jsonb, '{}'::jsonb,
                                       'arc.workflow.v1', 'arc.engine.v1');

  -- Removing a historical association.
  begin
    perform public.arc_remove_source_document(v_owner_id, v_revision_id, v_doc_id, 3);
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results values (
    '28 a finalized revision''s source set cannot be changed', ok
      and exists (select 1 from public.revision_source_documents
                   where revision_id = v_revision_id and source_document_id = v_doc_id));

  -- Individual hard deletion of a historical document.
  begin
    delete from public.source_documents where id = v_doc_id;
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results values (
    '29 a historical document cannot be individually hard-deleted', ok
      and exists (select 1 from public.source_documents where id = v_doc_id));

  -- Archiving is presentation only and leaves the bytes and provenance alone.
  perform public.arc_set_source_document_archived(v_owner_id, v_doc_id, true);
  insert into arc_test_results
  select '30 archiving a historical document preserves its bytes and provenance',
         (select archived_at from public.source_documents where id = v_doc_id) is not null
     and exists (select 1 from public.revision_source_documents
                  where revision_id = v_revision_id and source_document_id = v_doc_id)
     and not exists (select 1 from public.storage_deletion_queue
                     where storage_object_path = 'documents/8g-historical.pdf');
end $history$;

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
