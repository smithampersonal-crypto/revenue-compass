-- ARC Phase 7D — arc_start_amendment_revision provenance assertions.
-- Runs inside a rolled-back transaction with synthetic auth users only.
-- Every row must report passed = true.
begin;

create temporary table arc_test_results (assertion text, passed boolean not null) on commit drop;

do $$
declare
  user_a uuid := '00000000-0000-4000-8000-00000000020a';
  user_b uuid := '00000000-0000-4000-8000-00000000020b';
  cust uuid; cont uuid; ana uuid; rev1 uuid; rev2 uuid;
  res record; again record; ok boolean; new_rev record;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values
    (user_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'arc-amend-a@example.test', '', now(), now(), now()),
    (user_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'arc-amend-b@example.test', '', now(), now(), now());

  insert into public.customers (owner_user_id, name) values (user_a, 'Amend Co') returning id into cust;
  insert into public.contracts (customer_id, title) values (cust, 'Amend Contract') returning id into cont;
  insert into public.analyses (contract_id) values (cont) returning id into ana;
  insert into public.analysis_revisions (analysis_id, revision_number, canonical_inputs, schema_version)
  values (ana, 1, '{"v":1}'::jsonb, 'arc-workflow-1') returning id into rev1;

  -- An analysis with only a draft cannot be amended.
  ok := false;
  begin
    select * into res from public.arc_start_amendment_revision(user_a, cont, rev1);
  exception when others then ok := true; end;
  insert into arc_test_results values ('01 active draft returned or non-finalized source rejected',
    ok or res.created = false);

  perform public.arc_finalize_revision(user_a, rev1, 1,
    '{"o":1}'::jsonb, '{"r":1}'::jsonb, 'arc-workflow-1', 'arc-engine-1');

  -- Wrong owner creates nothing.
  ok := false;
  begin
    select * into res from public.arc_start_amendment_revision(user_b, cont, rev1);
  exception when others then ok := true; end;
  insert into arc_test_results values ('02 other owner rejected', ok);

  -- Stale expected source creates nothing.
  ok := false;
  begin
    select * into res from public.arc_start_amendment_revision(
      user_a, cont, '00000000-0000-4000-8000-0000000002ff');
  exception when others then ok := true; end;
  insert into arc_test_results values ('03 stale expected source creates nothing',
    ok and (select count(*) from public.analysis_revisions where analysis_id = ana) = 1);

  -- The current finalized revision creates the next draft.
  select * into res from public.arc_start_amendment_revision(user_a, cont, rev1);
  rev2 := res.revision_id;
  insert into arc_test_results values ('04 current finalized source creates the next draft',
    res.created and rev2 is not null);

  select * into new_rev from public.analysis_revisions where id = rev2;
  insert into arc_test_results values ('05 supersedes_revision_id references the exact source',
    new_rev.supersedes_revision_id = rev1);
  insert into arc_test_results values ('06 canonical inputs copied from the exact source',
    new_rev.canonical_inputs = '{"v":1}'::jsonb);
  insert into arc_test_results values ('07 new draft carries no finalized metadata',
    new_rev.status = 'draft'
    and new_rev.engine_outputs is null
    and new_rev.reconciliation_snapshot is null
    and new_rev.engine_version is null
    and new_rev.finalized_at is null);

  -- A repeated call returns the existing active draft.
  select * into again from public.arc_start_amendment_revision(user_a, cont, rev1);
  insert into arc_test_results values ('08 repeated call returns the existing active draft',
    again.revision_id = rev2 and again.created = false);
  insert into arc_test_results values ('09 no duplicate draft was created',
    (select count(*) from public.analysis_revisions where analysis_id = ana and status = 'draft') = 1);

  -- The browser roles cannot execute the SECURITY DEFINER function directly.
  insert into arc_test_results values ('10 anon cannot execute the amendment rpc',
    not has_function_privilege('anon',
      'public.arc_start_amendment_revision(uuid,uuid,uuid)', 'execute'));
  insert into arc_test_results values ('11 authenticated cannot execute the amendment rpc',
    not has_function_privilege('authenticated',
      'public.arc_start_amendment_revision(uuid,uuid,uuid)', 'execute'));
  insert into arc_test_results values ('12 service_role can execute the amendment rpc',
    has_function_privilege('service_role',
      'public.arc_start_amendment_revision(uuid,uuid,uuid)', 'execute'));

  delete from auth.users where id in (user_a, user_b);
end $$;

select assertion, passed from arc_test_results order by assertion;

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
