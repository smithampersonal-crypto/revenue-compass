-- ARC recruiter-v1 — Horizon New Analysis source-document parity.
-- Each Horizon temporary analysis owns its own copy of the canonical source
-- document; Save carries it onto revision 1 through the existing migration
-- path; compensation or expiry of one workspace never touches another
-- workspace's copy or a saved contract's document.
-- Runs inside a rolled-back transaction with synthetic data only.
-- Every row must report passed = true.
begin;

create temporary table arc_test_results (assertion text, passed boolean not null) on commit drop;

do $$
declare
  owner_id uuid := '00000000-0000-4000-8000-0000000003e1';
  hash_a text := repeat('a', 63) || '1';
  hash_b text := repeat('b', 63) || '1';
  hash_c text := repeat('c', 63) || '1';
  canonical text := 'a39c8883c51ea97c83166ce61d0ec506fb86324348afbcaa5c846edabb859c70';
  draft jsonb := '{"schemaVersion":"arc.workflow.v1","draft":{"contract":{"customerName":"Horizon Logistics"}}}'::jsonb;
  ws_a uuid; ws_b uuid; ws_c uuid;
  doc_a uuid; doc_b uuid; doc_c uuid;
  lock_a integer; lock_b integer; lock_c integer;
  runs_before bigint;
  res record;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (owner_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'arc-3e-horizon@example.test', '', now(), now(), now());

  select count(*) into runs_before from public.ai_runs;

  insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at, origin)
  values (hash_a, draft, 'arc.workflow.v1', now() + interval '9 hours', 'sample:horizon')
  returning id into ws_a;
  insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at, origin)
  values (hash_b, draft, 'arc.workflow.v1', now() + interval '9 hours', 'sample:horizon')
  returning id into ws_b;
  insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at, origin)
  values (hash_c, draft, 'arc.workflow.v1', now() + interval '9 hours', 'sample:horizon')
  returning id into ws_c;

  -- The same canonical content, one independent row and object per workspace.
  insert into public.source_documents (guest_workspace_id, storage_object_path, original_filename,
    display_name, sha256, byte_size, page_count)
  values (ws_a, 'documents/3e-a.pdf', 'horizon-logistics-saas-order-form.pdf',
          'Horizon Logistics — SaaS Order Form & Billing Schedule', canonical, 9773, 2)
  returning id into doc_a;
  insert into public.source_documents (guest_workspace_id, storage_object_path, original_filename,
    display_name, sha256, byte_size, page_count)
  values (ws_b, 'documents/3e-b.pdf', 'horizon-logistics-saas-order-form.pdf',
          'Horizon Logistics — SaaS Order Form & Billing Schedule', canonical, 9773, 2)
  returning id into doc_b;
  insert into public.source_documents (guest_workspace_id, storage_object_path, original_filename,
    display_name, sha256, byte_size, page_count)
  values (ws_c, 'documents/3e-c.pdf', 'horizon-logistics-saas-order-form.pdf',
          'Horizon Logistics — SaaS Order Form & Billing Schedule', canonical, 9773, 2)
  returning id into doc_c;

  select lock_version into lock_a from public.guest_workspaces where id = ws_a;
  select lock_version into lock_b from public.guest_workspaces where id = ws_b;
  select lock_version into lock_c from public.guest_workspaces where id = ws_c;
  perform public.arc_attach_guest_source_document(hash_a, doc_a, lock_a);
  perform public.arc_attach_guest_source_document(hash_b, doc_b, lock_b);
  perform public.arc_attach_guest_source_document(hash_c, doc_c, lock_c);

  insert into arc_test_results values ('01 each Horizon analysis includes its own document',
    (select count(*) from public.guest_source_document_selections
      where (guest_workspace_id, source_document_id) in ((ws_a, doc_a), (ws_b, doc_b), (ws_c, doc_c))) = 3);

  insert into arc_test_results values ('02 no workspace can include another workspace''s copy',
    not exists (select 1 from public.guest_source_document_selections s
                  join public.source_documents d on d.id = s.source_document_id
                 where s.guest_workspace_id <> d.guest_workspace_id));

  -- Save ws_a to My Contracts through the existing migration path.
  select lock_version into lock_a from public.guest_workspaces where id = ws_a;
  select * into res from public.arc_migrate_guest_workspace_by_token_v3(
    hash_a, owner_id, lock_a, null, 'Horizon Logistics', 'Horizon Logistics', null);

  insert into arc_test_results values ('03 saving links the Horizon document to revision 1',
    exists (select 1 from public.revision_source_documents rsd
              join public.analysis_revisions r on r.id = rsd.revision_id
             where rsd.source_document_id = doc_a and r.id = res.revision_id
               and r.revision_number = 1));

  insert into arc_test_results values ('04 the saved document now belongs to the contract',
    (select d.contract_id is not null and d.guest_workspace_id is null and d.sha256 = canonical
       from public.source_documents d where d.id = doc_a));

  insert into arc_test_results values ('05 sibling Horizon analyses are unchanged by the save',
    (select count(*) from public.guest_source_document_selections
      where (guest_workspace_id, source_document_id) in ((ws_b, doc_b), (ws_c, doc_c))) = 2);

  -- Compensation path: removing one new workspace (as the seeding rollback does).
  delete from public.guest_workspaces g
   where g.id = ws_b and g.token_hash = hash_b and g.status = 'active';

  insert into arc_test_results values ('06 compensation removes that workspace''s document and selection',
    not exists (select 1 from public.source_documents where id = doc_b)
    and not exists (select 1 from public.guest_source_document_selections where guest_workspace_id = ws_b));

  insert into arc_test_results values ('07 compensation durably queues the removed object',
    exists (select 1 from public.storage_deletion_queue q
             where q.storage_object_path = 'documents/3e-b.pdf' and q.completed_at is null));

  insert into arc_test_results values ('08 compensation leaves other copies and the saved document intact',
    exists (select 1 from public.source_documents where id = doc_c)
    and exists (select 1 from public.source_documents where id = doc_a));

  -- Expiry of the remaining workspaces, including the migrated one.
  update public.guest_workspaces set expires_at = now() - interval '1 minute'
   where id in (ws_a, ws_c);
  perform public.arc_delete_expired_guest_workspaces();

  insert into arc_test_results values ('09 expiry removes the unsaved copy',
    not exists (select 1 from public.source_documents where id = doc_c));

  insert into arc_test_results values ('10 expiry never removes a saved contract''s document',
    exists (select 1 from public.source_documents where id = doc_a)
    and exists (select 1 from public.revision_source_documents where source_document_id = doc_a)
    and not exists (select 1 from public.storage_deletion_queue q
                     where q.storage_object_path = 'documents/3e-a.pdf'));

  insert into arc_test_results values ('11 no AI run was created by any of this',
    (select count(*) from public.ai_runs) = runs_before);
end $$;

do $gate$
declare
  v_failed integer;
  v_names text;
begin
  select count(*), string_agg(assertion, '; ')
    into v_failed, v_names
  from arc_test_results where passed is not true;
  if v_failed > 0 then
    raise exception 'ARC SQL suite failed: % assertion(s) did not pass: %', v_failed, v_names;
  end if;
end $gate$;

rollback;
