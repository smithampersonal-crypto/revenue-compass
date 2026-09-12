-- ARC — amendment draft reset / discard lifecycle assertions.
-- Runs inside a rolled-back transaction with synthetic auth users only.
-- Every row must report passed = true.
begin;

create temporary table arc_test_results (assertion text, passed boolean not null) on commit drop;

do $$
declare
  user_a uuid := '00000000-0000-4000-8000-00000000030a';
  user_b uuid := '00000000-0000-4000-8000-00000000030b';
  cust uuid; cont uuid; ana uuid; rev1 uuid; rev2 uuid; rev2b uuid;
  res record; reset_res record; ok boolean; row2 record; finalized_before record;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values
    (user_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'arc-lifecycle-a@example.test', '', now(), now(), now()),
    (user_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'arc-lifecycle-b@example.test', '', now(), now(), now());

  insert into public.customers (owner_user_id, name) values (user_a, 'Lifecycle Co') returning id into cust;
  insert into public.contracts (customer_id, title) values (cust, 'Lifecycle Contract') returning id into cont;
  insert into public.analyses (contract_id) values (cont) returning id into ana;
  insert into public.analysis_revisions (analysis_id, revision_number, canonical_inputs, schema_version)
  values (ana, 1, '{"v":1}'::jsonb, 'arc-workflow-1') returning id into rev1;

  perform public.arc_finalize_revision(user_a, rev1, 1,
    '{"o":1}'::jsonb, '{"r":1}'::jsonb, 'arc-workflow-1', 'arc-engine-1');
  select * into finalized_before from public.analysis_revisions where id = rev1;

  select * into res from public.arc_start_amendment_revision(user_a, cont, rev1);
  rev2 := res.revision_id;

  -- Edit the draft so a reset has something to restore.
  update public.analysis_revisions
     set canonical_inputs = '{"v":2}'::jsonb, lock_version = lock_version + 1
   where id = rev2;
  select * into row2 from public.analysis_revisions where id = rev2;

  -- 01 stale lock version resets nothing
  ok := false;
  begin
    select * into reset_res from public.arc_reset_amendment_draft(user_a, rev2, row2.lock_version - 1);
  exception when others then ok := true; end;
  insert into arc_test_results values ('01 reset rejects a stale lock version',
    ok and (select canonical_inputs from public.analysis_revisions where id = rev2) = '{"v":2}'::jsonb);

  -- 02 another owner cannot reset
  ok := false;
  begin
    select * into reset_res from public.arc_reset_amendment_draft(user_b, rev2, row2.lock_version);
  exception when others then ok := true; end;
  insert into arc_test_results values ('02 another owner cannot reset the draft', ok);

  -- 03/04 reset restores the source inputs and advances the lock once
  select * into reset_res from public.arc_reset_amendment_draft(user_a, rev2, row2.lock_version);
  insert into arc_test_results values ('03 reset restores the finalized source inputs',
    (select canonical_inputs from public.analysis_revisions where id = rev2) = '{"v":1}'::jsonb);
  insert into arc_test_results values ('04 reset advances the lock version exactly once',
    reset_res.lock_version = row2.lock_version + 1);

  -- 05 the finalized source is untouched by the reset
  insert into arc_test_results values ('05 reset leaves the finalized revision unchanged',
    (select to_jsonb(r) from public.analysis_revisions r where r.id = rev1)
      = to_jsonb(finalized_before));

  -- 06 a finalized revision can never be reset
  ok := false;
  begin
    select * into reset_res from public.arc_reset_amendment_draft(user_a, rev1, 2);
  exception when others then ok := true; end;
  insert into arc_test_results values ('06 a finalized revision cannot be reset', ok);

  select * into row2 from public.analysis_revisions where id = rev2;

  -- 07 stale lock version discards nothing
  ok := false;
  begin
    perform public.arc_discard_amendment_draft(user_a, rev2, row2.lock_version - 1);
  exception when others then ok := true; end;
  insert into arc_test_results values ('07 discard rejects a stale lock version',
    ok and exists (select 1 from public.analysis_revisions where id = rev2));

  -- 08 another owner cannot discard
  ok := false;
  begin
    perform public.arc_discard_amendment_draft(user_b, rev2, row2.lock_version);
  exception when others then ok := true; end;
  insert into arc_test_results values ('08 another owner cannot discard the draft',
    ok and exists (select 1 from public.analysis_revisions where id = rev2));

  -- 09 a finalized revision can never be discarded
  ok := false;
  begin
    perform public.arc_discard_amendment_draft(user_a, rev1, 2);
  exception when others then ok := true; end;
  insert into arc_test_results values ('09 a finalized revision cannot be discarded',
    ok and exists (select 1 from public.analysis_revisions where id = rev1));

  -- 10/11 discard removes only the draft and returns the finalized revision
  insert into arc_test_results values ('10 discard returns the current finalized revision',
    public.arc_discard_amendment_draft(user_a, rev2, row2.lock_version) = rev1);
  insert into arc_test_results values ('11 the discarded draft is gone from history',
    not exists (select 1 from public.analysis_revisions where id = rev2));
  insert into arc_test_results values ('12 the finalized revision survived the discard unchanged',
    (select to_jsonb(r) from public.analysis_revisions r where r.id = rev1)
      = to_jsonb(finalized_before));
  insert into arc_test_results values ('13 the analysis still points at the finalized revision',
    (select current_finalized_revision_id from public.analyses where id = ana) = rev1);

  -- 14 the abandoned revision number is reusable
  select * into res from public.arc_start_amendment_revision(user_a, cont, rev1);
  rev2b := res.revision_id;
  insert into arc_test_results values ('14 a new revision reuses the discarded number',
    (select revision_number from public.analysis_revisions where id = rev2b) = 2);

  -- 15-17 the browser roles cannot execute the trusted functions directly
  insert into arc_test_results values ('15 anon cannot execute the reset rpc',
    not has_function_privilege('anon',
      'public.arc_reset_amendment_draft(uuid,uuid,integer)', 'execute'));
  insert into arc_test_results values ('16 authenticated cannot execute the discard rpc',
    not has_function_privilege('authenticated',
      'public.arc_discard_amendment_draft(uuid,uuid,integer)', 'execute'));
  insert into arc_test_results values ('17 service_role can execute both rpcs',
    has_function_privilege('service_role',
      'public.arc_reset_amendment_draft(uuid,uuid,integer)', 'execute')
    and has_function_privilege('service_role',
      'public.arc_discard_amendment_draft(uuid,uuid,integer)', 'execute'));

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
