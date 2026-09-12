-- ARC Phase 8A — source document schema, ownership, RLS and immutability.
-- Runs inside a rolled-back transaction and creates only synthetic auth users.
-- Every row of the final result set must report passed = true.
begin;

create temporary table arc_test_results (assertion text, passed boolean not null) on commit drop;
grant all on arc_test_results to authenticated;
grant all on arc_test_results to anon;

do $$
declare
  user_a uuid := '00000000-0000-4000-8000-0000000008a1';
  user_b uuid := '00000000-0000-4000-8000-0000000008a2';
  cust uuid; cont uuid; cont2 uuid; ana uuid; ana2 uuid; rev1 uuid;
  g1 uuid; g2 uuid;
  doc_a uuid; doc_b uuid; doc_g uuid;
  sha_a text := repeat('a', 64);
  sha_b text := repeat('b', 64);
  seen integer;
  ok boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values
    (user_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'arc-doc-a@example.test', '', now(), now(), now()),
    (user_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'arc-doc-b@example.test', '', now(), now(), now());

  insert into public.customers (owner_user_id, name) values (user_a, 'Docs Co') returning id into cust;
  insert into public.contracts (customer_id, title) values (cust, 'Docs Contract') returning id into cont;
  insert into public.contracts (customer_id, title) values (cust, 'Other Contract') returning id into cont2;
  insert into public.analyses (contract_id) values (cont) returning id into ana;
  insert into public.analyses (contract_id) values (cont2) returning id into ana2;
  insert into public.analysis_revisions (analysis_id, revision_number, canonical_inputs, schema_version)
  values (ana, 1, '{"v":1}'::jsonb, 'arc-workflow-1') returning id into rev1;

  insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at)
  values ('phase8a-guest-1', '{"v":1}'::jsonb, 'arc-workflow-1', now() + interval '9 hours')
  returning id into g1;
  insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at)
  values ('phase8a-guest-2', '{"v":1}'::jsonb, 'arc-workflow-1', now() + interval '9 hours')
  returning id into g2;

  -- 01 the source bucket exists, is private, and is configured as approved
  insert into arc_test_results values ('01 private source bucket exists',
    exists (select 1 from storage.buckets b
             where b.id = 'arc-source-documents' and b.public is false));
  insert into arc_test_results values ('01b source bucket size limit is 10 MB',
    exists (select 1 from storage.buckets b
             where b.id = 'arc-source-documents' and b.file_size_limit = 10485760));
  -- The hosted platform does not expose a bucket content-type setting through
  -- the managed tooling, so this assertion only proves the weaker condition:
  -- where a content-type restriction IS configured (local/CI from
  -- supabase/config.toml) it must be exactly application/pdf. A NULL setting
  -- proves nothing about what the bucket accepts; Phase 8B's server-side
  -- inspection of the actual uploaded bytes remains the authoritative PDF gate
  -- and must never rely on browser-supplied MIME metadata.
  insert into arc_test_results values (
    '01c bucket content-type restriction, where configured, is exactly application/pdf',
    exists (select 1 from storage.buckets b
             where b.id = 'arc-source-documents'
               and (b.allowed_mime_types is null
                    or b.allowed_mime_types = array['application/pdf'])));



  insert into public.source_documents
    (contract_id, storage_object_path, original_filename, display_name, sha256, byte_size, page_count)
  values (cont, 'documents/phase8a-a.pdf', 'a.pdf', 'Master Agreement', sha_a, 1024, 3)
  returning id into doc_a;
  insert into public.source_documents
    (contract_id, storage_object_path, original_filename, display_name, sha256, byte_size, page_count)
  values (cont2, 'documents/phase8a-b.pdf', 'b.pdf', 'Other Doc', sha_b, 2048, 5)
  returning id into doc_b;
  insert into public.source_documents
    (guest_workspace_id, storage_object_path, original_filename, display_name, sha256, byte_size, page_count)
  values (g1, 'documents/phase8a-g.pdf', 'g.pdf', 'Guest Doc', sha_a, 512, 2)
  returning id into doc_g;

  -- 18 a draft revision may gain and lose associations through trusted context
  insert into public.revision_source_documents (revision_id, source_document_id) values (rev1, doc_a);
  delete from public.revision_source_documents where revision_id = rev1 and source_document_id = doc_a;
  insert into public.revision_source_documents (revision_id, source_document_id) values (rev1, doc_a);
  insert into arc_test_results values ('18 draft revision source set is mutable',
    exists (select 1 from public.revision_source_documents
             where revision_id = rev1 and source_document_id = doc_a));

  -- 12 a document from another contract cannot be associated
  ok := false;
  begin
    insert into public.revision_source_documents (revision_id, source_document_id) values (rev1, doc_b);
  exception when others then ok := true; end;
  insert into arc_test_results values ('12 cross-contract association rejected', ok);

  -- 13 the same association cannot be recorded twice
  ok := false;
  begin
    insert into public.revision_source_documents (revision_id, source_document_id) values (rev1, doc_a);
  exception when others then ok := true; end;
  insert into arc_test_results values ('13 duplicate association rejected', ok);

  -- 07 exactly one owner is required
  ok := false;
  begin
    insert into public.source_documents
      (contract_id, guest_workspace_id, storage_object_path, original_filename, display_name,
       sha256, byte_size, page_count)
    values (cont, g1, 'documents/phase8a-both.pdf', 'x.pdf', 'Both', repeat('c', 64), 10, 1);
  exception when others then ok := true; end;
  if ok then
    ok := false;
    begin
      insert into public.source_documents
        (storage_object_path, original_filename, display_name, sha256, byte_size, page_count)
      values ('documents/phase8a-none.pdf', 'x.pdf', 'None', repeat('d', 64), 10, 1);
    exception when others then ok := true; end;
  end if;
  insert into arc_test_results values ('07 contract xor guest ownership enforced', ok);

  -- 07b a document always carries a real filename and a real display name
  ok := false;
  begin
    insert into public.source_documents
      (contract_id, storage_object_path, original_filename, display_name, sha256, byte_size, page_count)
    values (cont, 'documents/phase8a-blank1.pdf', '   ', 'Named', repeat('1', 64), 10, 1);
  exception when others then ok := true; end;
  if ok then
    ok := false;
    begin
      insert into public.source_documents
        (contract_id, storage_object_path, original_filename, display_name, sha256, byte_size, page_count)
      values (cont, 'documents/phase8a-blank2.pdf', 'x.pdf', '', repeat('2', 64), 10, 1);
    exception when others then ok := true; end;
  end if;
  insert into arc_test_results values ('07b blank document names rejected', ok);

  -- 07c oversized or over-long documents are rejected at the row level
  ok := false;
  begin
    insert into public.source_documents
      (contract_id, storage_object_path, original_filename, display_name, sha256, byte_size, page_count)
    values (cont, 'documents/phase8a-big.pdf', 'big.pdf', 'Big', repeat('3', 64), 10485761, 1);
  exception when others then ok := true; end;
  if ok then
    ok := false;
    begin
      insert into public.source_documents
        (contract_id, storage_object_path, original_filename, display_name, sha256, byte_size, page_count)
      values (cont, 'documents/phase8a-long.pdf', 'long.pdf', 'Long', repeat('4', 64), 10, 501);
    exception when others then ok := true; end;
  end if;
  insert into arc_test_results values ('07c oversized documents rejected', ok);


  -- 08 duplicate sha within a contract is rejected
  ok := false;
  begin
    insert into public.source_documents
      (contract_id, storage_object_path, original_filename, display_name, sha256, byte_size, page_count)
    values (cont, 'documents/phase8a-a2.pdf', 'a2.pdf', 'Copy', sha_a, 1024, 3);
  exception when others then ok := true; end;
  insert into arc_test_results values ('08 duplicate contract sha256 rejected', ok);

  -- 09 duplicate sha within a guest workspace is rejected
  ok := false;
  begin
    insert into public.source_documents
      (guest_workspace_id, storage_object_path, original_filename, display_name, sha256, byte_size, page_count)
    values (g1, 'documents/phase8a-g2.pdf', 'g2.pdf', 'Guest Copy', sha_a, 512, 2);
  exception when others then ok := true; end;
  insert into arc_test_results values ('09 duplicate guest sha256 rejected', ok);

  -- 10 the same bytes may exist in two different contracts
  insert into public.source_documents
    (contract_id, storage_object_path, original_filename, display_name, sha256, byte_size, page_count)
  values (cont2, 'documents/phase8a-a3.pdf', 'a3.pdf', 'Same bytes', sha_a, 1024, 3);
  insert into arc_test_results values ('10 same sha256 allowed in another contract',
    exists (select 1 from public.source_documents where contract_id = cont2 and sha256 = sha_a));

  -- 11 the same bytes may exist in two different guest workspaces
  insert into public.source_documents
    (guest_workspace_id, storage_object_path, original_filename, display_name, sha256, byte_size, page_count)
  values (g2, 'documents/phase8a-g3.pdf', 'g3.pdf', 'Same bytes', sha_a, 512, 2);
  insert into arc_test_results values ('11 same sha256 allowed in another guest workspace',
    exists (select 1 from public.source_documents where guest_workspace_id = g2 and sha256 = sha_a));

  -- 14 technical facts are immutable after insert
  ok := false;
  begin
    update public.source_documents set sha256 = repeat('e', 64) where id = doc_a;
  exception when others then ok := true; end;
  if ok then
    ok := false;
    begin
      update public.source_documents set storage_object_path = 'documents/moved.pdf' where id = doc_a;
    exception when others then ok := true; end;
  end if;
  insert into arc_test_results values ('14 technical document facts are immutable', ok);

  -- finalize the revision so doc_a is part of immutable history
  perform public.arc_finalize_revision(user_a, rev1, 1,
    '{"o":1}'::jsonb, '{"r":1}'::jsonb, 'arc-workflow-1', 'arc-engine-1');

  -- 15 user metadata locks once the document is in finalized history
  ok := false;
  begin
    update public.source_documents set display_name = 'Renamed' where id = doc_a;
  exception when others then ok := true; end;
  if ok then
    ok := false;
    begin
      update public.source_documents set effective_date = date '2026-01-01' where id = doc_a;
    exception when others then ok := true; end;
  end if;
  insert into arc_test_results values ('15 historical metadata is locked', ok);

  -- 16 archiving stays available after historical use
  update public.source_documents set archived_at = now() where id = doc_a;
  update public.source_documents set archived_at = null where id = doc_a;
  insert into arc_test_results values ('16 archive and unarchive remain allowed',
    (select archived_at is null from public.source_documents where id = doc_a));

  -- 17 a finalized source set can never change
  ok := false;
  begin
    delete from public.revision_source_documents where revision_id = rev1 and source_document_id = doc_a;
  exception when others then ok := true; end;
  if ok then
    ok := false;
    begin
      insert into public.revision_source_documents (revision_id, source_document_id)
      values (rev1, (select id from public.source_documents where storage_object_path = 'documents/phase8a-a3.pdf'));
    exception when others then ok := true; end;
  end if;
  insert into arc_test_results values ('17 finalized source set is immutable', ok);

  -- 05 browser roles hold no direct write privileges
  insert into arc_test_results values ('05 authenticated cannot write source_documents directly',
    not has_table_privilege('authenticated', 'public.source_documents', 'insert')
    and not has_table_privilege('authenticated', 'public.source_documents', 'update')
    and not has_table_privilege('authenticated', 'public.source_documents', 'delete')
    and not has_table_privilege('authenticated', 'public.revision_source_documents', 'insert')
    and not has_table_privilege('authenticated', 'public.revision_source_documents', 'delete'));

  -- 06 server-only tables are unreachable from browser roles
  insert into arc_test_results values ('06 guest/intent/queue tables are server-only',
    not has_table_privilege('authenticated', 'public.guest_source_document_selections', 'select')
    and not has_table_privilege('anon', 'public.guest_source_document_selections', 'select')
    and not has_table_privilege('authenticated', 'public.document_upload_intents', 'select')
    and not has_table_privilege('anon', 'public.document_upload_intents', 'select')
    and not has_table_privilege('authenticated', 'public.storage_deletion_queue', 'select')
    and not has_table_privilege('anon', 'public.storage_deletion_queue', 'select')
    and has_table_privilege('service_role', 'public.document_upload_intents', 'select')
    and has_table_privilege('service_role', 'public.storage_deletion_queue', 'select'));

  -- 02/03 owner-derived RLS
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  select count(*) into seen from public.source_documents;
  insert into arc_test_results values ('02 owner reads own contract documents', seen = 3);
  select count(*) into seen from public.revision_source_documents;
  insert into arc_test_results values ('02b owner reads own revision associations', seen = 1);

  perform set_config('request.jwt.claims',
    json_build_object('sub', user_b, 'role', 'authenticated')::text, true);
  select count(*) into seen from public.source_documents;
  insert into arc_test_results values ('03 another user reads no documents', seen = 0);

  -- 04 anonymous callers cannot read source documents at all
  set local role anon;
  ok := false;
  begin
    select count(*) into seen from public.source_documents;
    ok := seen = 0;
  exception when others then ok := true; end;
  insert into arc_test_results values ('04 anon cannot read source documents', ok);

  reset role;

  delete from auth.users where id in (user_a, user_b);
end $$;

select assertion, passed from arc_test_results order by assertion;

-- CI gate: a false or null assertion must make psql exit non-zero.
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
