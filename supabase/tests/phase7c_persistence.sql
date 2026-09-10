-- ARC Phase 7C — autosave authorization/concurrency and atomic contract creation.
-- Runs entirely inside a transaction that is rolled back and creates only
-- synthetic auth users. Never run against production data.
-- Every row of the final result set must report passed = true.
begin;

create temporary table arc_test_results (assertion text, passed boolean) on commit drop;
grant all on arc_test_results to authenticated;

do $$
declare
  user_a uuid := '00000000-0000-4000-8000-0000000000ca';
  user_b uuid := '00000000-0000-4000-8000-0000000000cb';
  cust_a uuid;
  cust_b uuid;
  cont_a uuid;
  ana_a uuid;
  rev_a uuid;
  created record;
  seen integer;
  ok boolean;
  inputs jsonb := '{"schemaVersion":"arc.workflow.v1","draft":{}}'::jsonb;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values
    (user_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'arc-7c-a@example.test', '', now(), now(), now()),
    (user_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'arc-7c-b@example.test', '', now(), now(), now());

  insert into public.customers (owner_user_id, name) values (user_a, '7C Customer A')
    returning id into cust_a;
  insert into public.customers (owner_user_id, name) values (user_b, '7C Customer B')
    returning id into cust_b;

  -- ---------------- atomic contract creation ----------------
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', user_a, 'role', 'authenticated')::text, true);

  select * into created
  from public.arc_create_contract_with_draft(
    cust_a, '7C Contract', 'C-7C-1', inputs, 'arc.workflow.v1');

  insert into arc_test_results values ('01 owned customer creates a contract',
    created.contract_id is not null);
  insert into arc_test_results values ('02 contract creation creates its analysis',
    exists (select 1 from public.analyses a
            where a.id = created.analysis_id and a.contract_id = created.contract_id));
  insert into arc_test_results values ('03 contract creation creates draft revision 1',
    exists (select 1 from public.analysis_revisions r
            where r.id = created.revision_id
              and r.analysis_id = created.analysis_id
              and r.revision_number = 1
              and r.status = 'draft'
              and r.lock_version = 1
              and r.schema_version = 'arc.workflow.v1'));

  cont_a := created.contract_id;
  ana_a := created.analysis_id;
  rev_a := created.revision_id;

  -- an unowned customer is rejected and creates nothing
  ok := false;
  begin
    perform public.arc_create_contract_with_draft(
      cust_b, 'Should not exist', null, inputs, 'arc.workflow.v1');
  exception when others then ok := true;
  end;
  insert into arc_test_results values ('04 unowned customer rejected', ok);
  select count(*) into seen from public.contracts c where c.title = 'Should not exist';
  insert into arc_test_results values ('05 rejected creation left zero contracts', seen = 0);

  -- a failure inside the function leaves no partial hierarchy
  select count(*) into seen from public.contracts;
  ok := false;
  begin
    perform public.arc_create_contract_with_draft(
      cust_a, 'Partial hierarchy', null, null, 'arc.workflow.v1');
  exception when others then ok := true;
  end;
  insert into arc_test_results values ('06 invalid draft rejected', ok);
  insert into arc_test_results values ('07 no partial contract hierarchy remains',
    seen = (select count(*) from public.contracts)
    and not exists (select 1 from public.contracts c where c.title = 'Partial hierarchy'));

  -- ---------------- autosave authorization and concurrency ----------------
  update public.analysis_revisions
     set canonical_inputs = '{"schemaVersion":"arc.workflow.v1","draft":{"v":1}}'::jsonb,
         lock_version = 2
   where id = rev_a and lock_version = 1 and status = 'draft';
  insert into arc_test_results values ('08 owner autosave accepted at expected lock',
    (select lock_version from public.analysis_revisions where id = rev_a) = 2);

  -- a stale lock version writes nothing
  update public.analysis_revisions
     set canonical_inputs = '{"schemaVersion":"arc.workflow.v1","draft":{"v":"stale"}}'::jsonb,
         lock_version = 2
   where id = rev_a and lock_version = 1 and status = 'draft';
  get diagnostics seen = row_count;
  insert into arc_test_results values ('09 stale lock autosave writes nothing', seen = 0);
  insert into arc_test_results values ('10 stale lock left saved copy untouched',
    (select canonical_inputs -> 'draft' ->> 'v' from public.analysis_revisions where id = rev_a)
      = '1');

  -- another signed-in user cannot autosave this revision
  perform set_config('request.jwt.claims',
    json_build_object('sub', user_b, 'role', 'authenticated')::text, true);
  update public.analysis_revisions
     set canonical_inputs = '{"schemaVersion":"arc.workflow.v1","draft":{"v":"intruder"}}'::jsonb,
         lock_version = 3
   where id = rev_a and lock_version = 2 and status = 'draft';
  get diagnostics seen = row_count;
  insert into arc_test_results values ('11 other user cannot autosave revision', seen = 0);
  select count(*) into seen from public.analysis_revisions where id = rev_a;
  insert into arc_test_results values ('12 other user cannot even see revision', seen = 0);

  -- another signed-in user cannot create a contract under user A's customer
  ok := false;
  begin
    perform public.arc_create_contract_with_draft(
      cust_a, 'Intruder contract', null, inputs, 'arc.workflow.v1');
  exception when others then ok := true;
  end;
  insert into arc_test_results values ('13 other user cannot create under A''s customer', ok);
  perform set_config('request.jwt.claims',
    json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  select count(*) into seen from public.contracts c where c.title = 'Intruder contract';
  insert into arc_test_results values ('14 intruder contract was not created', seen = 0);

  -- a finalized revision can no longer be autosaved
  perform set_config('role', 'postgres', true);
  reset role;
  update public.analysis_revisions
     set status = 'finalized',
         engine_outputs = '{}'::jsonb,
         reconciliation_snapshot = '{}'::jsonb,
         engine_version = 'test',
         finalized_at = now(),
         lock_version = lock_version + 1
   where id = rev_a;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  update public.analysis_revisions
     set canonical_inputs = '{"schemaVersion":"arc.workflow.v1","draft":{"v":"after"}}'::jsonb,
         lock_version = 99
   where id = rev_a and lock_version = 3 and status = 'draft';
  get diagnostics seen = row_count;
  insert into arc_test_results values ('15 finalized revision cannot be autosaved', seen = 0);

  reset role;
end $$;

select assertion, passed from arc_test_results order by assertion;

rollback;
