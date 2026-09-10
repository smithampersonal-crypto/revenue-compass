-- ARC Phase 7A acceptance patch — adversarial privilege / lifecycle tests.
-- Exercises real database privileges and RLS as an authenticated owner.
-- The whole script runs inside a transaction that is rolled back and creates
-- only synthetic auth users. Every row must report passed = true.
begin;

create temporary table arc_test_results (assertion text, passed boolean) on commit drop;
grant all on arc_test_results to authenticated;

do $$
declare
  user_a uuid := '00000000-0000-4000-8000-00000000020a';
  user_b uuid := '00000000-0000-4000-8000-00000000020b';
  cust uuid; cust2 uuid; cont uuid; cont2 uuid;
  ana uuid; ana2 uuid; rev1 uuid; rev2 uuid; rev_other uuid;
  ok boolean; seen integer; guest uuid; res record;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values
    (user_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'arc-priv-a@example.test', '', now(), now(), now()),
    (user_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'arc-priv-b@example.test', '', now(), now(), now());

  insert into public.customers (owner_user_id, name) values (user_a, 'Priv Co') returning id into cust;
  insert into public.customers (owner_user_id, name) values (user_a, 'Priv Co Two') returning id into cust2;
  insert into public.contracts (customer_id, title) values (cust, 'Priv Contract') returning id into cont;
  insert into public.contracts (customer_id, title) values (cust2, 'Priv Contract 2') returning id into cont2;
  insert into public.analyses (contract_id) values (cont) returning id into ana;
  insert into public.analyses (contract_id) values (cont2) returning id into ana2;
  insert into public.analysis_revisions (analysis_id, revision_number, canonical_inputs, schema_version)
  values (ana, 1, '{"v":1}'::jsonb, 'arc-workflow-1') returning id into rev1;
  insert into public.analysis_revisions (analysis_id, revision_number, canonical_inputs, schema_version)
  values (ana2, 1, '{"other":true}'::jsonb, 'arc-workflow-1') returning id into rev_other;

  perform public.arc_finalize_revision(user_a, rev1, 1,
    '{"o":1}'::jsonb, '{"r":1}'::jsonb, 'arc-workflow-1', 'arc-engine-1');

  insert into public.analysis_revisions (analysis_id, revision_number, canonical_inputs, schema_version)
  values (ana, 2, '{"v":2}'::jsonb, 'arc-workflow-1') returning id into rev2;

  -- =====================================================
  -- adversarial: authenticated owner of the rows
  -- =====================================================
  ok := false;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
    insert into public.analysis_revisions
      (analysis_id, revision_number, status, canonical_inputs, schema_version,
       engine_outputs, reconciliation_snapshot, engine_version, finalized_at)
    values (ana, 3, 'finalized', '{}'::jsonb, 'arc-workflow-1',
            '{}'::jsonb, '{}'::jsonb, 'x', now());
  exception when others then ok := true; end;
  insert into arc_test_results values ('01 owner cannot insert a finalized revision', ok);

  ok := false;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
    update public.analysis_revisions set status = 'finalized' where id = rev2;
  exception when others then ok := true; end;
  insert into arc_test_results values ('02 owner cannot finalize a draft directly', ok);

  ok := false;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
    update public.analysis_revisions set status = 'superseded' where id = rev2;
  exception when others then ok := true; end;
  insert into arc_test_results values ('03 owner cannot supersede a draft directly', ok);

  ok := false;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
    update public.analysis_revisions set status = 'superseded' where id = rev1;
  exception when others then ok := true; end;
  insert into arc_test_results values ('04 owner cannot supersede a finalized revision', ok);

  ok := false;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
    update public.analyses set current_finalized_revision_id = rev2 where id = ana;
  exception when others then ok := true; end;
  insert into arc_test_results values ('05 owner cannot set the current finalized pointer', ok);

  ok := false;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
    update public.contracts set customer_id = cust2 where id = cont;
  exception when others then ok := true; end;
  insert into arc_test_results values ('06 owner cannot move a contract to another customer', ok);

  ok := false;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
    update public.analyses set contract_id = cont2 where id = ana;
  exception when others then ok := true; end;
  insert into arc_test_results values ('07 owner cannot move an analysis to another contract', ok);

  ok := false;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
    update public.analysis_revisions set analysis_id = ana2 where id = rev2;
  exception when others then ok := true; end;
  insert into arc_test_results values ('08 owner cannot move a revision to another analysis', ok);

  ok := false;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
    update public.analysis_revisions set supersedes_revision_id = rev_other where id = rev2;
  exception when others then ok := true; end;
  insert into arc_test_results values ('09 owner cannot create a cross-analysis supersedes link', ok);

  ok := false;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
    update public.analyses set current_finalized_revision_id = rev_other where id = ana;
  exception when others then ok := true; end;
  insert into arc_test_results values ('10 owner cannot point at another analysis revision', ok);

  -- service-role-only trusted RPC stays unreachable
  ok := false;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
    perform public.arc_finalize_revision(user_a, rev2, 1, '{}'::jsonb, '{}'::jsonb, 's', 'e');
  exception when others then ok := true; end;
  insert into arc_test_results values ('11 authenticated cannot execute finalize RPC', ok);

  -- =====================================================
  -- legitimate paths
  -- =====================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);

  update public.analysis_revisions
     set canonical_inputs = '{"v":2,"edited":true}'::jsonb, lock_version = lock_version + 1
   where id = rev2;
  insert into arc_test_results values ('12 owner can edit draft canonical inputs',
    (select canonical_inputs from public.analysis_revisions where id = rev2)
      = '{"v":2,"edited":true}'::jsonb);

  update public.contracts set title = 'Renamed Contract', contract_number = 'C-1', status = 'archived'
   where id = cont;
  insert into arc_test_results values ('13 owner can edit contract metadata',
    (select title = 'Renamed Contract' and contract_number = 'C-1' and status = 'archived'
       from public.contracts where id = cont));

  select count(*) into seen from public.analysis_revisions;
  insert into arc_test_results values ('14 owner still reads own revisions', seen = 3);

  perform set_config('request.jwt.claims', json_build_object('sub', user_b, 'role', 'authenticated')::text, true);
  select count(*) into seen from public.customers;
  insert into arc_test_results values ('15 user B sees no customers of A', seen = 0);
  select count(*) into seen from public.analysis_revisions;
  insert into arc_test_results values ('16 user B sees no revisions of A', seen = 0);
  update public.contracts set title = 'hacked' where id = cont;
  get diagnostics seen = row_count;
  insert into arc_test_results values ('17 user B cannot edit A contract', seen = 0);

  reset role;

  -- trusted lifecycle still works
  perform public.arc_finalize_revision(user_a, rev2,
    (select lock_version from public.analysis_revisions where id = rev2),
    '{"o":2}'::jsonb, '{"r":2}'::jsonb, 'arc-workflow-1', 'arc-engine-1');
  insert into arc_test_results values ('18 trusted finalization draft -> finalized',
    (select status from public.analysis_revisions where id = rev2) = 'finalized');
  insert into arc_test_results values ('19 prior revision became superseded',
    (select status from public.analysis_revisions where id = rev1) = 'superseded');
  insert into arc_test_results values ('20 analysis pointer moved to newest revision',
    (select current_finalized_revision_id from public.analyses where id = ana) = rev2);
  insert into arc_test_results values ('21 supersession lineage recorded',
    (select supersedes_revision_id from public.analysis_revisions where id = rev2) = rev1);

  -- guest migration still works
  insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at)
  values ('priv-hash-1', '{"guest":true}'::jsonb, 'arc-workflow-1', now() + interval '9 hours')
  returning id into guest;
  select * into res from public.arc_migrate_guest_workspace(guest, user_a, 'Guest Co', 'Guest Contract', null);
  insert into arc_test_results values ('22 guest migration still works',
    (select status = 'draft' and revision_number = 1
       from public.analysis_revisions where id = res.revision_id));

  -- account deletion cascade still works
  delete from auth.users where id = user_a;
  insert into arc_test_results values ('23 account deletion cascades',
    not exists (select 1 from public.analysis_revisions where analysis_id = ana));
end $$;

select assertion, passed from arc_test_results order by assertion;

rollback;
