-- ARC Phase 8D — revision source provenance assertions.
--
-- Every lifecycle operation below is exercised through the real trusted
-- functions (arc_start_amendment_revision, arc_reset_amendment_draft,
-- arc_discard_amendment_draft, arc_finalize_revision); none of their logic is
-- reproduced here.
--
-- Limitation, reported rather than faked: this harness runs in a single
-- session inside one rolled-back transaction, so a genuine two-session race
-- cannot be scheduled. The finalization lock boundary is therefore proven
-- structurally — the selected rows are locked by the finalization transaction
-- and the historical immutability guards reject every crossing mutation once
-- the revision leaves `draft`.
begin;

create temporary table arc_test_results (assertion text, passed boolean not null) on commit drop;

do $$
declare
  user_a uuid := '00000000-0000-4000-8000-0000000008d1';
  cust uuid; cont uuid; ana uuid; rev1 uuid; rev2 uuid;
  cont0 uuid; ana0 uuid; rev0 uuid;
  docA uuid; docB uuid; docC uuid;
  r record;
  v_lock integer; v_inputs jsonb; v_src_inputs jsonb;
  v_paths text; v_shas text;
  n integer; ok boolean;
  set_before text; set_after text;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (user_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'arc-provenance-a@example.test', '', now(), now(), now());

  insert into public.customers (owner_user_id, name) values (user_a, 'Provenance Co')
    returning id into cust;
  insert into public.contracts (customer_id, title) values (cust, 'Provenance Contract')
    returning id into cont;
  insert into public.analyses (contract_id) values (cont) returning id into ana;
  insert into public.analysis_revisions (analysis_id, revision_number, canonical_inputs, schema_version)
  values (ana, 1, '{"v":1}'::jsonb, 'arc.workflow.v1') returning id into rev1;

  insert into public.source_documents
    (contract_id, storage_object_path, original_filename, display_name, sha256, byte_size, page_count)
  values
    (cont, 'contracts/' || cont || '/a.pdf', 'master.pdf', 'Master Agreement', repeat('a', 64), 1000, 3)
    returning id into docA;
  insert into public.source_documents
    (contract_id, storage_object_path, original_filename, display_name, sha256, byte_size, page_count)
  values
    (cont, 'contracts/' || cont || '/b.pdf', 'order.pdf', 'Order Form', repeat('b', 64), 2000, 2)
    returning id into docB;
  insert into public.source_documents
    (contract_id, storage_object_path, original_filename, display_name, sha256, byte_size, page_count)
  values
    (cont, 'contracts/' || cont || '/c.pdf', 'amendment.pdf', 'Amendment 1', repeat('c', 64), 3000, 1)
    returning id into docC;

  insert into public.revision_source_documents (revision_id, source_document_id)
  values (rev1, docA), (rev1, docB);

  -- ------------------------------------------------ finalize revision 1 ----
  select public.arc_finalize_revision(
    user_a, rev1, 1, '{"engine":"out"}'::jsonb, '{"recon":true}'::jsonb,
    'arc.workflow.v1', 'arc.engine.v1') into rev1;

  select status = 'finalized' into ok from public.analysis_revisions where id = rev1;
  insert into arc_test_results values ('17. finalize with selected source documents succeeds', ok);

  select string_agg(source_document_id::text, ',' order by source_document_id::text)
    into set_after from public.revision_source_documents where revision_id = rev1;
  insert into arc_test_results values (
    '18. finalization freezes exactly the selected source set',
    set_after = (select string_agg(x::text, ',' order by x::text) from unnest(array[docA, docB]) x));

  begin
    insert into public.revision_source_documents (revision_id, source_document_id) values (rev1, docC);
    insert into arc_test_results values ('19. finalized revision association insert is rejected', false);
  exception when others then
    insert into arc_test_results values ('19. finalized revision association insert is rejected', true);
  end;

  begin
    delete from public.revision_source_documents where revision_id = rev1 and source_document_id = docB;
    insert into arc_test_results values ('20. finalized revision association delete is rejected', false);
  exception when others then
    insert into arc_test_results values ('20. finalized revision association delete is rejected', true);
  end;

  begin
    update public.source_documents set display_name = 'Renamed after history' where id = docA;
    insert into arc_test_results values (
      '21. source metadata mutation cannot cross the finalization lock boundary', false);
  exception when others then
    insert into arc_test_results values (
      '21. source metadata mutation cannot cross the finalization lock boundary', true);
  end;

  -- ------------------------------------------------- create revision 2 -----
  select * into r from public.arc_start_amendment_revision(user_a, cont, rev1);
  rev2 := r.revision_id;
  insert into arc_test_results values ('0a. create revision produced a new draft', r.created);

  select string_agg(source_document_id::text, ',' order by source_document_id::text)
    into set_after from public.revision_source_documents where revision_id = rev2;
  insert into arc_test_results values (
    '1. create revision 2 inherits exactly revision 1 source ids',
    set_after = (select string_agg(x::text, ',' order by x::text) from unnest(array[docA, docB]) x));

  select count(*) into n from public.source_documents where contract_id = cont;
  insert into arc_test_results values ('2. no source_documents rows duplicated by revision creation', n = 3);

  select string_agg(storage_object_path, ',' order by id::text), string_agg(sha256, ',' order by id::text)
    into v_paths, v_shas from public.source_documents where contract_id = cont;
  insert into arc_test_results values (
    '3. no storage identity/path/hash changed by revision creation',
    v_paths like '%a.pdf%' and v_paths like '%b.pdf%' and v_paths like '%c.pdf%'
      and v_shas like '%' || repeat('a', 64) || '%');

  -- The accountant changes the draft's selection: B out, C in.
  delete from public.revision_source_documents where revision_id = rev2 and source_document_id = docB;
  insert into public.revision_source_documents (revision_id, source_document_id) values (rev2, docC);
  select lock_version into v_lock from public.analysis_revisions where id = rev2;

  select * into r from public.arc_start_amendment_revision(user_a, cont, rev1);
  insert into arc_test_results values (
    '4a. retrying create revision returns the existing draft', r.revision_id = rev2 and r.created = false);

  select string_agg(source_document_id::text, ',' order by source_document_id::text)
    into set_after from public.revision_source_documents where revision_id = rev2;
  insert into arc_test_results values (
    '4. retrying create revision does not recopy associations',
    set_after = (select string_agg(x::text, ',' order by x::text) from unnest(array[docA, docC]) x));
  insert into arc_test_results values (
    '5. active draft additions and removals survive a create-revision retry',
    not exists (select 1 from public.revision_source_documents
                 where revision_id = rev2 and source_document_id = docB)
    and exists (select 1 from public.revision_source_documents
                 where revision_id = rev2 and source_document_id = docC)
    and (select lock_version from public.analysis_revisions where id = rev2) = v_lock);

  -- ------------------------------------------------------------- reset ----
  update public.analysis_revisions set canonical_inputs = '{"v":"edited"}'::jsonb where id = rev2;
  select lock_version into v_lock from public.analysis_revisions where id = rev2;

  -- Stale reset first: it must change nothing at all.
  begin
    perform * from public.arc_reset_amendment_draft(user_a, rev2, v_lock + 7);
    ok := false;
  exception when others then
    ok := true;
  end;
  select canonical_inputs into v_inputs from public.analysis_revisions where id = rev2;
  select string_agg(source_document_id::text, ',' order by source_document_id::text)
    into set_after from public.revision_source_documents where revision_id = rev2;
  insert into arc_test_results values (
    '11. stale reset changes neither canonical inputs nor source associations',
    ok and v_inputs = '{"v":"edited"}'::jsonb
      and set_after = (select string_agg(x::text, ',' order by x::text) from unnest(array[docA, docC]) x)
      and (select lock_version from public.analysis_revisions where id = rev2) = v_lock);

  select * into r from public.arc_reset_amendment_draft(user_a, rev2, v_lock);

  select canonical_inputs into v_inputs from public.analysis_revisions where id = rev2;
  select canonical_inputs into v_src_inputs from public.analysis_revisions where id = rev1;
  insert into arc_test_results values (
    '6. reset restores the finalized revision canonical inputs exactly', v_inputs = v_src_inputs);

  select string_agg(source_document_id::text, ',' order by source_document_id::text)
    into set_after from public.revision_source_documents where revision_id = rev2;
  insert into arc_test_results values (
    '7. reset restores the finalized revision source associations exactly',
    set_after = (select string_agg(x::text, ',' order by x::text) from unnest(array[docA, docB]) x));
  insert into arc_test_results values (
    '8. reset removes draft-only associations',
    not exists (select 1 from public.revision_source_documents
                 where revision_id = rev2 and source_document_id = docC));
  insert into arc_test_results values (
    '9. reset leaves draft-only PDFs in the contract library',
    exists (select 1 from public.source_documents where id = docC and contract_id = cont));
  insert into arc_test_results values (
    '10. reset advances the revision lock exactly once',
    (select lock_version from public.analysis_revisions where id = rev2) = v_lock + 1
    and r.lock_version = v_lock + 1);

  select string_agg(source_document_id::text, ',' order by source_document_id::text)
    into set_after from public.revision_source_documents where revision_id = rev1;
  insert into arc_test_results values (
    '12. reset leaves the finalized source revision unchanged',
    set_after = (select string_agg(x::text, ',' order by x::text) from unnest(array[docA, docB]) x)
    and (select status from public.analysis_revisions where id = rev1) = 'finalized');

  -- ----------------------------------------------------------- discard ----
  insert into public.revision_source_documents (revision_id, source_document_id) values (rev2, docC);
  select lock_version into v_lock from public.analysis_revisions where id = rev2;
  perform public.arc_discard_amendment_draft(user_a, rev2, v_lock);

  insert into arc_test_results values (
    '13. discard removes only the draft revision associations',
    not exists (select 1 from public.revision_source_documents where revision_id = rev2));
  select count(*) into n from public.source_documents where contract_id = cont;
  insert into arc_test_results values ('14. discard leaves contract source documents untouched', n = 3);
  select string_agg(source_document_id::text, ',' order by source_document_id::text)
    into set_after from public.revision_source_documents where revision_id = rev1;
  insert into arc_test_results values (
    '15. discard leaves historical revision associations untouched',
    set_after = (select string_agg(x::text, ',' order by x::text) from unnest(array[docA, docB]) x));

  -- ------------------------------------------- finalize with zero sources --
  insert into public.contracts (customer_id, title) values (cust, 'No Documents Contract')
    returning id into cont0;
  insert into public.analyses (contract_id) values (cont0) returning id into ana0;
  insert into public.analysis_revisions (analysis_id, revision_number, canonical_inputs, schema_version)
  values (ana0, 1, '{"v":1}'::jsonb, 'arc.workflow.v1') returning id into rev0;
  perform public.arc_finalize_revision(user_a, rev0, 1, '{}'::jsonb, '{}'::jsonb,
                                       'arc.workflow.v1', 'arc.engine.v1');
  insert into arc_test_results values (
    '16. finalize with zero source documents succeeds',
    (select status from public.analysis_revisions where id = rev0) = 'finalized');

  -- --------------------------------------------------- supersession -------
  select * into r from public.arc_start_amendment_revision(user_a, cont, rev1);
  rev2 := r.revision_id;
  delete from public.revision_source_documents where revision_id = rev2 and source_document_id = docB;
  insert into public.revision_source_documents (revision_id, source_document_id) values (rev2, docC);
  select lock_version into v_lock from public.analysis_revisions where id = rev2;
  perform public.arc_finalize_revision(user_a, rev2, v_lock, '{"engine":"out"}'::jsonb,
                                       '{"recon":true}'::jsonb, 'arc.workflow.v1', 'arc.engine.v1');

  select string_agg(source_document_id::text, ',' order by source_document_id::text)
    into set_before from public.revision_source_documents where revision_id = rev1;
  select string_agg(source_document_id::text, ',' order by source_document_id::text)
    into set_after from public.revision_source_documents where revision_id = rev2;

  insert into arc_test_results values (
    '22. revision 1 source set remains immutable after revision 2 finalizes',
    set_before = (select string_agg(x::text, ',' order by x::text) from unnest(array[docA, docB]) x)
    and (select status from public.analysis_revisions where id = rev1) = 'superseded');
  insert into arc_test_results values (
    '23. revision 2 final source set may differ from revision 1',
    set_after = (select string_agg(x::text, ',' order by x::text) from unnest(array[docA, docC]) x)
    and set_after <> set_before);

  select count(*) into n from public.revision_source_documents where source_document_id = docA;
  insert into arc_test_results values (
    '24. one document supports multiple historical revisions without duplication',
    n = 2
    and (select count(*) from public.source_documents where id = docA) = 1
    and (select count(distinct storage_object_path) from public.source_documents
          where contract_id = cont) = 3);
end $$;

-- ---------------------------------------------------------------------------
-- Lifecycle lock ordering: Finalize vs permanent Delete.
--
-- Limitation, reported rather than faked: this harness runs as a single psql
-- session inside one rolled-back transaction, so a genuine two-session
-- deadlock race cannot be scheduled here. Assertions 25-27 are therefore a
-- deterministic structural regression on the shipped function definitions —
-- they prove both transactions take the draft revision lock before the
-- source_documents lock, which is the property that makes the deadlock
-- impossible. Assertions 28-31 prove that reordering did not weaken any
-- deletion guarantee.
-- ---------------------------------------------------------------------------
do $lockorder$
declare
  user_b uuid := '00000000-0000-4000-8000-0000000008d2';
  cust uuid; cont uuid; ana uuid; rev uuid; hist_rev uuid;
  docX uuid; docY uuid;
  v_del text; v_fin text;
  v_lock integer; r record; ok boolean;
begin
  v_del := pg_get_functiondef('public.arc_stage_source_document_deletion(uuid,text,uuid,integer)'::regprocedure);
  v_fin := pg_get_functiondef('public.arc_finalize_revision(uuid,uuid,integer,jsonb,jsonb,text,text)'::regprocedure);

  insert into arc_test_results values (
    '25. finalization locks the revision before the selected source documents',
    strpos(v_fin, 'for update of r') > 0
    and strpos(v_fin, 'for update of r') <
        strpos(v_fin, 'from public.source_documents d'));

  insert into arc_test_results values (
    '26. deletion locks the draft revision before the source document',
    strpos(v_del, 'where r.id = v_draft_id') > 0
    and strpos(v_del, 'where r.id = v_draft_id') <
        strpos(v_del, 'where d.id = p_source_document_id
     for update'));

  insert into arc_test_results values (
    '27. deletion identifies the candidate document with an unlocked read',
    strpos(v_del, 'for update') > strpos(v_del, 'select * into v_doc from public.source_documents d'));

  -- Behavioural regression: nothing the reordering touches may be weaker.
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (user_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'arc-lockorder-b@example.test', '', now(), now(), now());
  insert into public.customers (owner_user_id, name) values (user_b, 'Lock Order Co')
    returning id into cust;
  insert into public.contracts (customer_id, title) values (cust, 'Lock Order Contract')
    returning id into cont;
  insert into public.analyses (contract_id) values (cont) returning id into ana;
  insert into public.analysis_revisions (analysis_id, revision_number, canonical_inputs, schema_version)
  values (ana, 1, '{"v":1}'::jsonb, 'arc.workflow.v1') returning id into hist_rev;

  insert into public.source_documents
    (contract_id, storage_object_path, original_filename, display_name, sha256, byte_size, page_count)
  values (cont, 'contracts/' || cont || '/x.pdf', 'x.pdf', 'Historical', repeat('d', 64), 10, 1)
    returning id into docX;
  insert into public.revision_source_documents (revision_id, source_document_id)
  values (hist_rev, docX);
  perform public.arc_finalize_revision(user_b, hist_rev, 1, '{}'::jsonb, '{}'::jsonb,
                                       'arc.workflow.v1', 'arc.engine.v1');

  begin
    perform * from public.arc_stage_source_document_deletion(user_b, null, docX, 1);
    ok := false;
  exception when others then
    ok := true;
  end;
  insert into arc_test_results values (
    '28. a document in finalized history still cannot be deleted',
    ok and exists (select 1 from public.source_documents where id = docX));

  select * into r from public.arc_start_amendment_revision(user_b, cont, hist_rev);
  rev := r.revision_id;
  insert into public.source_documents
    (contract_id, storage_object_path, original_filename, display_name, sha256, byte_size, page_count)
  values (cont, 'contracts/' || cont || '/y.pdf', 'y.pdf', 'Draft only', repeat('e', 64), 10, 1)
    returning id into docY;
  insert into public.revision_source_documents (revision_id, source_document_id) values (rev, docY);
  select lock_version into v_lock from public.analysis_revisions where id = rev;

  begin
    perform * from public.arc_stage_source_document_deletion(user_b, null, docY, v_lock + 9);
    ok := false;
  exception when others then
    ok := true;
  end;
  insert into arc_test_results values (
    '29. a stale expected lock version still rejects the deletion',
    ok and exists (select 1 from public.source_documents where id = docY)
    and (select lock_version from public.analysis_revisions where id = rev) = v_lock);

  begin
    perform * from public.arc_stage_source_document_deletion('00000000-0000-4000-8000-0000000008d9'::uuid, null, docY, v_lock);
    ok := false;
  exception when others then
    ok := true;
  end;
  insert into arc_test_results values (
    '30. another account still cannot delete this document',
    ok and exists (select 1 from public.source_documents where id = docY));

  perform * from public.arc_stage_source_document_deletion(user_b, null, docY, v_lock);
  insert into arc_test_results values (
    '31. deleting a selected draft document removes it, advances the lock once and queues Storage',
    not exists (select 1 from public.source_documents where id = docY)
    and not exists (select 1 from public.revision_source_documents where source_document_id = docY)
    and (select lock_version from public.analysis_revisions where id = rev) = v_lock + 1
    and exists (select 1 from public.storage_deletion_queue
                 where storage_object_path = 'contracts/' || cont || '/y.pdf'
                   and reason = 'document_deleted'));
end $lockorder$;



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
