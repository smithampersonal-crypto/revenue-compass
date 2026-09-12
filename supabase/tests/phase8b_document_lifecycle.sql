-- ARC Phase 8A / Task 2 — trusted document lifecycle RPC assertions.
-- Runs inside a rolled-back transaction with synthetic auth users only.
-- Every row of the final result set must report passed = true.
begin;

create temporary table arc_test_results (assertion text, passed boolean not null) on commit drop;

do $$
declare
  user_a uuid := '00000000-0000-4000-8000-0000000008b1';
  user_b uuid := '00000000-0000-4000-8000-0000000008b2';
  cust uuid; cont uuid; ana uuid; rev1 uuid; rev2 uuid; g1 uuid;
  i1 uuid; i2 uuid; i3 uuid; i4 uuid; i5 uuid; i6 uuid; i7 uuid; i8 uuid;
  sha1 text := repeat('1', 64);
  sha3 text := repeat('3', 64);
  sha4 text := repeat('4', 64);
  sha5 text := repeat('5', 64);
  sha6 text := repeat('6', 64);
  sha7 text := repeat('7', 64);
  sha8 text := repeat('8', 64);
  doc1 uuid; doc3 uuid; doc4 uuid;
  p record; c record; res record; job record;
  reserved text; lock_now integer; ok boolean; n integer;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values
    (user_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'arc-lifecycle-doc-a@example.test', '', now(), now(), now()),
    (user_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'arc-lifecycle-doc-b@example.test', '', now(), now(), now());

  insert into public.customers (owner_user_id, name) values (user_a, 'Lifecycle Docs Co')
    returning id into cust;
  insert into public.contracts (customer_id, title) values (cust, 'Lifecycle Docs Contract')
    returning id into cont;
  insert into public.analyses (contract_id) values (cont) returning id into ana;
  insert into public.analysis_revisions (analysis_id, revision_number, canonical_inputs, schema_version)
  values (ana, 1, '{"v":1}'::jsonb, 'arc-workflow-1') returning id into rev1;
  insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at)
  values ('phase8b-guest', '{"v":1}'::jsonb, 'arc-workflow-1', now() + interval '9 hours')
  returning id into g1;

  insert into public.document_upload_intents
    (contract_id, target_revision_id, pending_object_path, original_filename, display_name, expires_at)
  values (cont, rev1, 'pending/8b-1.pdf', '1.pdf', 'Master Agreement', now() + interval '1 hour')
  returning id into i1;

  -- 01 another account cannot drive someone else's upload
  ok := false;
  begin
    perform public.arc_prepare_source_document_upload(i1, user_b, null, sha1, 1024, 4);
  exception when others then ok := true; end;
  insert into arc_test_results values ('01 prepare rejects a different owner', ok);

  -- 02 an expired intent is refused
  insert into public.document_upload_intents
    (contract_id, pending_object_path, original_filename, display_name, expires_at)
  values (cont, 'pending/8b-expired.pdf', 'x.pdf', 'Expired', now() - interval '1 minute')
  returning id into i5;
  ok := false;
  begin
    perform public.arc_prepare_source_document_upload(i5, user_a, null, sha5, 10, 1);
  exception when others then ok := true; end;
  insert into arc_test_results values ('02 prepare rejects an expired intent', ok);

  -- 03 a new upload reserves an opaque permanent object
  select * into p from public.arc_prepare_source_document_upload(i1, user_a, null, sha1, 1024, 4);
  reserved := p.permanent_object_path;
  insert into arc_test_results values ('03 prepare reserves a permanent object',
    p.duplicate is false and p.requires_promotion is true
    and reserved = 'documents/' || p.source_document_id::text || '.pdf');

  -- 04 retrying prepare returns exactly the same reservation
  select * into res from public.arc_prepare_source_document_upload(i1, user_a, null, sha1, 1024, 4);
  insert into arc_test_results values ('04 prepare retry is idempotent',
    res.source_document_id = p.source_document_id and res.permanent_object_path = reserved);

  -- 05 commit records exactly one document and attaches it to the draft
  select * into c from public.arc_commit_source_document_upload(i1, user_a, null, 1);
  doc1 := c.source_document_id;
  select count(*) into n from public.source_documents where contract_id = cont and sha256 = sha1;
  insert into arc_test_results values ('05 commit inserts exactly one document',
    n = 1 and doc1 = p.source_document_id and c.duplicate is false);
  insert into arc_test_results values ('06 commit attaches and advances the lock once',
    c.associated is true and c.association_conflict is false and c.lock_version = 2
    and (select lock_version from public.analysis_revisions where id = rev1) = 2);

  -- 07 committing the same intent again changes nothing
  select * into res from public.arc_commit_source_document_upload(i1, user_a, null, 2);
  select count(*) into n from public.source_documents where contract_id = cont and sha256 = sha1;
  insert into arc_test_results values ('07 commit retry is idempotent',
    res.source_document_id = doc1 and n = 1
    and (select lock_version from public.analysis_revisions where id = rev1) = 2);

  -- 08 a same-scope duplicate reuses the document and never rewrites its metadata
  insert into public.document_upload_intents
    (contract_id, pending_object_path, original_filename, display_name, expires_at)
  values (cont, 'pending/8b-2.pdf', '1-copy.pdf', 'Different Name', now() + interval '1 hour')
  returning id into i2;
  select * into p from public.arc_prepare_source_document_upload(i2, user_a, null, sha1, 1024, 4);
  select * into c from public.arc_commit_source_document_upload(i2, user_a, null, 2);
  insert into arc_test_results values ('08 duplicate upload reuses the existing document',
    p.duplicate is true and p.requires_promotion is false and c.source_document_id = doc1
    and (select display_name from public.source_documents where id = doc1) = 'Master Agreement');

  -- 09 a stale selection lock keeps the document but reports the conflict
  insert into public.document_upload_intents
    (contract_id, target_revision_id, pending_object_path, original_filename, display_name, expires_at)
  values (cont, rev1, 'pending/8b-3.pdf', '3.pdf', 'Order Form', now() + interval '1 hour')
  returning id into i3;
  perform public.arc_prepare_source_document_upload(i3, user_a, null, sha3, 2048, 6);
  select * into c from public.arc_commit_source_document_upload(i3, user_a, null, 1);
  doc3 := c.source_document_id;
  insert into arc_test_results values ('09 stale association leaves an unselected library document',
    c.association_conflict is true and c.associated is false
    and exists (select 1 from public.source_documents where id = doc3)
    and not exists (select 1 from public.revision_source_documents
                     where revision_id = rev1 and source_document_id = doc3)
    and (select lock_version from public.analysis_revisions where id = rev1) = 2);

  -- 10 losing a same-hash race adopts the winner and queues the reserved object
  insert into public.document_upload_intents
    (contract_id, pending_object_path, original_filename, display_name, expires_at)
  values (cont, 'pending/8b-4.pdf', '4.pdf', 'Raced', now() + interval '1 hour')
  returning id into i4;
  select * into p from public.arc_prepare_source_document_upload(i4, user_a, null, sha4, 4096, 2);
  reserved := p.permanent_object_path;
  insert into public.source_documents
    (contract_id, storage_object_path, original_filename, display_name, sha256, byte_size, page_count)
  values (cont, 'documents/8b-race-winner.pdf', '4.pdf', 'Race Winner', sha4, 4096, 2)
  returning id into doc4;
  select * into c from public.arc_commit_source_document_upload(i4, user_a, null, 2);
  select count(*) into n from public.storage_deletion_queue where storage_object_path = reserved;
  insert into arc_test_results values ('10 duplicate race resolves to one winner and queues the loser',
    c.source_document_id = doc4 and c.duplicate is true and n = 1
    and (select count(*) from public.source_documents where contract_id = cont and sha256 = sha4) = 1);

  -- 11 attach rejects a stale lock and writes nothing
  ok := false;
  begin
    perform public.arc_attach_source_document(user_a, rev1, doc3, 1);
  exception when sqlstate '40001' then ok := true; end;
  insert into arc_test_results values ('11 attach rejects a stale lock version',
    ok and not exists (select 1 from public.revision_source_documents
                        where revision_id = rev1 and source_document_id = doc3));

  -- 12 attach advances the lock exactly once and is idempotent
  lock_now := public.arc_attach_source_document(user_a, rev1, doc3, 2);
  insert into arc_test_results values ('12 attach advances the lock exactly once',
    lock_now = 3 and (select lock_version from public.analysis_revisions where id = rev1) = 3
    and exists (select 1 from public.revision_source_documents
                 where revision_id = rev1 and source_document_id = doc3));
  lock_now := public.arc_attach_source_document(user_a, rev1, doc3, 3);
  insert into arc_test_results values ('13 re-attaching an already selected document changes nothing',
    lock_now = 3 and (select lock_version from public.analysis_revisions where id = rev1) = 3
    and (select count(*) from public.revision_source_documents
          where revision_id = rev1 and source_document_id = doc3) = 1);

  -- 13b a stale attach still conflicts even though the end state already exists
  ok := false;
  begin
    perform public.arc_attach_source_document(user_a, rev1, doc3, 2);
  exception when sqlstate '40001' then ok := true; end;
  insert into arc_test_results values ('13b stale attach conflicts even when already selected',
    ok and (select lock_version from public.analysis_revisions where id = rev1) = 3);

  -- 14 remove advances the lock exactly once and rejects a stale lock
  ok := false;
  begin
    perform public.arc_remove_source_document(user_a, rev1, doc3, 2);
  exception when sqlstate '40001' then ok := true; end;
  lock_now := public.arc_remove_source_document(user_a, rev1, doc3, 3);
  insert into arc_test_results values ('14 remove rejects a stale lock and otherwise advances once',
    ok and lock_now = 4
    and not exists (select 1 from public.revision_source_documents
                     where revision_id = rev1 and source_document_id = doc3));

  -- 14b removing an already absent association changes nothing
  lock_now := public.arc_remove_source_document(user_a, rev1, doc3, 4);
  insert into arc_test_results values ('14b removing an absent association changes nothing',
    lock_now = 4 and (select lock_version from public.analysis_revisions where id = rev1) = 4);

  -- 14c a stale remove still conflicts even though the document is already absent
  ok := false;
  begin
    perform public.arc_remove_source_document(user_a, rev1, doc3, 3);
  exception when sqlstate '40001' then ok := true; end;
  insert into arc_test_results values ('14c stale remove conflicts even when already absent',
    ok and (select lock_version from public.analysis_revisions where id = rev1) = 4);

  -- 15 an eligible hard delete queues the object exactly once and frees the row
  select * into res from public.arc_stage_source_document_deletion(user_a, null, doc3, null);
  select count(*) into n from public.storage_deletion_queue
   where storage_object_path = (select 'documents/' || doc3::text || '.pdf');
  insert into arc_test_results values ('15 eligible hard delete queues the object once',
    res.queued is true and not exists (select 1 from public.source_documents where id = doc3)
    and n = 1);

  -- finalize the revision so doc1 enters immutable history
  select lock_version into lock_now from public.analysis_revisions where id = rev1;
  perform public.arc_finalize_revision(user_a, rev1, lock_now,
    '{"o":1}'::jsonb, '{"r":1}'::jsonb, 'arc-workflow-1', 'arc-engine-1');

  -- 16 metadata edits stop once the document is historical
  ok := false;
  begin
    perform public.arc_update_source_document_metadata(user_a, doc1, 'Renamed', 'Amendment', null);
  exception when others then ok := true; end;
  insert into arc_test_results values ('16 metadata edit rejected after finalized use',
    ok and (select display_name from public.source_documents where id = doc1) = 'Master Agreement');

  -- 17 archiving stays available for historical documents
  perform public.arc_set_source_document_archived(user_a, doc1, true);
  insert into arc_test_results values ('17 archive remains allowed after finalized use',
    (select archived_at is not null from public.source_documents where id = doc1));
  perform public.arc_set_source_document_archived(user_a, doc1, false);

  -- 18 a historical document can never be hard deleted
  ok := false;
  begin
    perform public.arc_stage_source_document_deletion(user_a, null, doc1, null);
  exception when others then ok := true; end;
  insert into arc_test_results values ('18 hard delete rejected after finalized use',
    ok and exists (select 1 from public.source_documents where id = doc1));

  -- 19 deleting a document selected by the active draft is lock-checked and atomic
  select * into res from public.arc_start_amendment_revision(user_a, cont, rev1);
  rev2 := res.revision_id;
  lock_now := public.arc_attach_source_document(user_a, rev2, doc4, 1);
  ok := false;
  begin
    perform public.arc_stage_source_document_deletion(user_a, null, doc4, 1);
  exception when sqlstate '40001' then ok := true; end;
  insert into arc_test_results values ('19 selected-document delete rejects a stale lock',
    ok and exists (select 1 from public.source_documents where id = doc4)
    and exists (select 1 from public.revision_source_documents
                 where revision_id = rev2 and source_document_id = doc4));

  select * into res from public.arc_stage_source_document_deletion(user_a, null, doc4, lock_now);
  insert into arc_test_results values ('20 selected-document delete removes the selection and advances the lock once',
    res.queued is true and res.lock_version = lock_now + 1
    and (select lock_version from public.analysis_revisions where id = rev2) = lock_now + 1
    and not exists (select 1 from public.source_documents where id = doc4)
    and (select count(*) from public.storage_deletion_queue
          where storage_object_path = 'documents/8b-race-winner.pdf') = 1);

  -- 21/22 queue claim, release and complete
  select count(*) into n from public.storage_deletion_queue where completed_at is null;
  select count(*) into n from public.arc_claim_storage_deletion_jobs(10);
  insert into arc_test_results values ('21 claiming returns every outstanding job once',
    n = 3 and (select count(*) from public.arc_claim_storage_deletion_jobs(10)) = 0);

  -- Each step runs as its own statement: expression evaluation order is not
  -- guaranteed, so the release must be observed before the reclaim.
  select * into job from public.storage_deletion_queue order by created_at, id limit 1;
  ok := public.arc_release_storage_deletion_job(job.id, 'network error');
  select count(*) into n from public.arc_claim_storage_deletion_jobs(10);
  insert into arc_test_results values ('22 release then reclaim retries without duplicating work',
    ok and n = 1
    and (select attempt_count from public.storage_deletion_queue where id = job.id) = 2);

  ok := public.arc_complete_storage_deletion_job(job.id);
  select count(*) into n from public.arc_claim_storage_deletion_jobs(10);
  insert into arc_test_results values ('23 completing a job takes it out of the queue',
    ok and n = 0);


  -- 25 validated upload facts are bounded exactly like the stored row
  insert into public.document_upload_intents
    (contract_id, pending_object_path, original_filename, display_name, expires_at)
  values (cont, 'pending/8b-oversize.pdf', 'big.pdf', 'Big', now() + interval '1 hour')
  returning id into i6;
  ok := false;
  begin
    perform public.arc_prepare_source_document_upload(i6, user_a, null, sha6, 10485761, 4);
  exception when sqlstate '22023' then ok := true; end;
  if ok then
    ok := false;
    begin
      perform public.arc_prepare_source_document_upload(i6, user_a, null, sha6, 1024, 501);
    exception when sqlstate '22023' then ok := true; end;
  end if;
  insert into arc_test_results values ('25 prepare rejects oversized upload facts',
    ok and (select state from public.document_upload_intents where id = i6) = 'pending');

  -- 26 an expired temporary workspace can no longer complete an upload
  update public.guest_workspaces set expires_at = now() - interval '1 minute' where id = g1;
  insert into public.document_upload_intents
    (guest_workspace_id, pending_object_path, original_filename, display_name, expires_at)
  values (g1, 'pending/8b-guest.pdf', 'g.pdf', 'Guest', now() + interval '1 hour')
  returning id into i7;
  ok := false;
  begin
    perform public.arc_prepare_source_document_upload(i7, null, 'phase8b-guest', sha7, 1024, 2);
  exception when others then ok := true; end;
  insert into arc_test_results values ('26 expired guest workspace cannot upload', ok);

  -- 27 an association failure that is not a concurrency conflict is fatal
  insert into public.document_upload_intents
    (contract_id, target_revision_id, pending_object_path, original_filename, display_name, expires_at)
  values (cont, rev1, 'pending/8b-finalized.pdf', 'f.pdf', 'Finalized target',
          now() + interval '1 hour')
  returning id into i8;
  perform public.arc_prepare_source_document_upload(i8, user_a, null, sha8, 1024, 2);
  ok := false;
  begin
    perform public.arc_commit_source_document_upload(i8, user_a, null,
      (select lock_version from public.analysis_revisions where id = rev1));
  exception when others then ok := true; end;
  insert into arc_test_results values ('27 non-conflict association failure is fatal',
    ok and not exists (select 1 from public.source_documents where sha256 = sha8));

  -- 24 every privileged function is service-role only

  insert into arc_test_results values ('24 lifecycle functions are service-role only',
    (select bool_and(
       not has_function_privilege('anon', f, 'execute')
       and not has_function_privilege('authenticated', f, 'execute')
       and has_function_privilege('service_role', f, 'execute'))
     from unnest(array[
       'public.arc_prepare_source_document_upload(uuid,uuid,text,text,bigint,integer)',
       'public.arc_commit_source_document_upload(uuid,uuid,text,integer)',
       'public.arc_attach_source_document(uuid,uuid,uuid,integer)',
       'public.arc_remove_source_document(uuid,uuid,uuid,integer)',
       'public.arc_update_source_document_metadata(uuid,uuid,text,text,date)',
       'public.arc_set_source_document_archived(uuid,uuid,boolean)',
       'public.arc_stage_source_document_deletion(uuid,text,uuid,integer)',
       'public.arc_claim_storage_deletion_jobs(integer)',
       'public.arc_complete_storage_deletion_job(uuid)',
       'public.arc_release_storage_deletion_job(uuid,text)'
     ]) as f));

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
