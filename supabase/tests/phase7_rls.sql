-- ARC Phase 7A — ownership, RLS, and lifecycle-constraint assertions.
-- Runs entirely inside a transaction that is rolled back; creates only
-- synthetic auth users. Never run against production data.
begin;

create temporary table arc_test_results (assertion text, passed boolean) on commit drop;

do $$
declare
  user_a uuid := '00000000-0000-4000-8000-00000000000a';
  user_b uuid := '00000000-0000-4000-8000-00000000000b';
  cust_a uuid;
  cust_a2 uuid;
  cont_a uuid;
  ana_a uuid;
  rev_a uuid;
  seen integer;
  ok boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values
    (user_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'arc-test-a@example.test', '', now(), now(), now()),
    (user_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'arc-test-b@example.test', '', now(), now(), now());

  insert into public.customers (owner_user_id, name) values (user_a, 'Test Customer A')
    returning id into cust_a;
  insert into public.customers (owner_user_id, name) values (user_a, 'Test Customer A2')
    returning id into cust_a2;
  insert into public.contracts (customer_id, title) values (cust_a, 'Contract A')
    returning id into cont_a;
  insert into public.analyses (contract_id) values (cont_a) returning id into ana_a;
  insert into public.analysis_revisions (analysis_id, revision_number, canonical_inputs, schema_version)
  values (ana_a, 1, '{"draft":true}'::jsonb, 'arc-workflow-1') returning id into rev_a;

  -- User A sees own rows through RLS
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  select count(*) into seen from public.customers;
  insert into arc_test_results values ('user A sees own 2 customers', seen = 2);
  select count(*) into seen from public.analysis_revisions;
  insert into arc_test_results values ('user A sees own revision', seen = 1);
  update public.customers set name = 'Renamed A' where id = cust_a;
  insert into arc_test_results values ('user A can update own customer',
    (select name from public.customers where id = cust_a) = 'Renamed A');

  -- User B is denied
  perform set_config('request.jwt.claims', json_build_object('sub', user_b, 'role', 'authenticated')::text, true);
  select count(*) into seen from public.customers;
  insert into arc_test_results values ('user B sees no customers of A', seen = 0);
  select count(*) into seen from public.contracts;
  insert into arc_test_results values ('user B sees no contracts of A', seen = 0);
  select count(*) into seen from public.analyses;
  insert into arc_test_results values ('user B sees no analyses of A', seen = 0);
  select count(*) into seen from public.analysis_revisions;
  insert into arc_test_results values ('user B sees no revisions of A', seen = 0);
  update public.customers set name = 'hacked' where id = cust_a;
  get diagnostics seen = row_count;
  insert into arc_test_results values ('user B cannot update A customer', seen = 0);

  -- Guest workspaces are unreachable from the Data API roles
  begin
    select count(*) into seen from public.guest_workspaces;
    insert into arc_test_results values ('guest workspaces unreachable by authenticated', false);
  exception when others then
    insert into arc_test_results values ('guest workspaces unreachable by authenticated', true);
  end;

  reset role;

  -- One active draft per analysis
  ok := false;
  begin
    insert into public.analysis_revisions (analysis_id, revision_number, canonical_inputs, schema_version)
    values (ana_a, 2, '{}'::jsonb, 'arc-workflow-1');
  exception when unique_violation then ok := true;
  end;
  insert into arc_test_results values ('second active draft rejected', ok);

  -- Duplicate revision numbers rejected
  ok := false;
  begin
    insert into public.analysis_revisions (analysis_id, revision_number, status, canonical_inputs, schema_version)
    values (ana_a, 1, 'finalized', '{}'::jsonb, 'arc-workflow-1');
  exception when unique_violation then ok := true;
  end;
  insert into arc_test_results values ('duplicate revision number rejected', ok);
end $$;

select assertion, passed from arc_test_results order by assertion;

rollback;
