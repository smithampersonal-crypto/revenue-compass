-- ARC Phase 7A — revision lifecycle (draft -> finalized -> superseded) and
-- guest-workspace migration assertions. Runs inside a rolled-back transaction
-- with synthetic auth users only. Every row must report passed = true.
begin;

create temporary table arc_test_results (assertion text, passed boolean) on commit drop;

do $$
declare
  user_a uuid := '00000000-0000-4000-8000-00000000010a';
  cust uuid; cont uuid; ana uuid; rev1 uuid; rev2 uuid;
  snap1 record; snap1b record;
  ok boolean; res record; guest uuid; guest_status text; guest_draft jsonb;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (user_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'arc-lifecycle@example.test', '', now(), now(), now());

  insert into public.customers (owner_user_id, name) values (user_a, 'Lifecycle Co') returning id into cust;
  insert into public.contracts (customer_id, title) values (cust, 'Lifecycle Contract') returning id into cont;
  insert into public.analyses (contract_id) values (cont) returning id into ana;
  insert into public.analysis_revisions (analysis_id, revision_number, canonical_inputs, schema_version)
  values (ana, 1, '{"v":1}'::jsonb, 'arc-workflow-1') returning id into rev1;

  ok := false;
  begin
    perform public.arc_finalize_revision('00000000-0000-4000-8000-0000000001ff', rev1, 1,
      '{"o":1}'::jsonb, '{"r":1}'::jsonb, 'arc-workflow-1', 'arc-engine-1');
  exception when others then ok := true; end;
  insert into arc_test_results values ('01 finalize rejects non-owner', ok);

  ok := false;
  begin
    perform public.arc_finalize_revision(user_a, rev1, 99,
      '{"o":1}'::jsonb, '{"r":1}'::jsonb, 'arc-workflow-1', 'arc-engine-1');
  exception when others then ok := true; end;
  insert into arc_test_results values ('02 finalize rejects stale lock version', ok);

  ok := false;
  begin
    perform public.arc_finalize_revision(user_a, rev1, 1, null, '{"r":1}'::jsonb, 'arc-workflow-1', 'arc-engine-1');
  exception when others then ok := true; end;
  insert into arc_test_results values ('03 finalize requires engine outputs', ok);

  perform public.arc_finalize_revision(user_a, rev1, 1,
    '{"o":1}'::jsonb, '{"r":1}'::jsonb, 'arc-workflow-1', 'arc-engine-1');
  insert into arc_test_results values ('04 revision 1 finalized',
    (select status from public.analysis_revisions where id = rev1) = 'finalized');
  insert into arc_test_results values ('05 analysis points at revision 1',
    (select current_finalized_revision_id from public.analyses where id = ana) = rev1);

  ok := false;
  begin
    perform public.arc_finalize_revision(user_a, rev1, 2,
      '{"o":9}'::jsonb, '{"r":9}'::jsonb, 'arc-workflow-1', 'arc-engine-1');
  exception when others then ok := true; end;
  insert into arc_test_results values ('06 finalizing a non-draft revision fails', ok);

  ok := false;
  begin
    update public.analysis_revisions set canonical_inputs = '{"tampered":true}'::jsonb where id = rev1;
  exception when others then ok := true; end;
  insert into arc_test_results values ('07 finalized snapshot cannot be edited', ok);

  ok := false;
  begin
    delete from public.analysis_revisions where id = rev1;
  exception when others then ok := true; end;
  insert into arc_test_results values ('08 finalized revision cannot be deleted', ok);

  select canonical_inputs, engine_outputs, reconciliation_snapshot, schema_version,
         engine_version, finalized_at, revision_number
    into snap1 from public.analysis_revisions where id = rev1;

  insert into public.analysis_revisions (analysis_id, revision_number, canonical_inputs, schema_version)
  values (ana, 2, '{"v":2}'::jsonb, 'arc-workflow-1') returning id into rev2;
  insert into arc_test_results values ('09 new draft allowed after finalization', rev2 is not null);

  perform public.arc_finalize_revision(user_a, rev2, 1,
    '{"o":2}'::jsonb, '{"r":2}'::jsonb, 'arc-workflow-1', 'arc-engine-1');

  insert into arc_test_results values ('10 revision 1 became superseded',
    (select status from public.analysis_revisions where id = rev1) = 'superseded');
  insert into arc_test_results values ('11 revision 2 is finalized',
    (select status from public.analysis_revisions where id = rev2) = 'finalized');
  insert into arc_test_results values ('12 analysis points at revision 2',
    (select current_finalized_revision_id from public.analyses where id = ana) = rev2);
  insert into arc_test_results values ('13 revision 2 records what it supersedes',
    (select supersedes_revision_id from public.analysis_revisions where id = rev2) = rev1);

  select canonical_inputs, engine_outputs, reconciliation_snapshot, schema_version,
         engine_version, finalized_at, revision_number
    into snap1b from public.analysis_revisions where id = rev1;
  insert into arc_test_results values ('14 superseded snapshot unchanged', snap1b is not distinct from snap1);

  ok := false;
  begin
    update public.analysis_revisions set status = 'draft' where id = rev1;
  exception when others then ok := true; end;
  insert into arc_test_results values ('15 superseded revision cannot be reopened', ok);

  insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at)
  values ('hash-1', '{"guest":true}'::jsonb, 'arc-workflow-1', now() + interval '9 hours')
  returning id into guest;

  select * into res from public.arc_migrate_guest_workspace(guest, user_a, 'Guest Co', 'Guest Contract', null);
  insert into arc_test_results values ('16 guest migration creates revision 1 draft',
    (select status = 'draft' and revision_number = 1 and canonical_inputs = '{"guest":true}'::jsonb
       from public.analysis_revisions where id = res.revision_id));
  insert into arc_test_results values ('17 guest workspace marked migrated',
    (select status = 'migrated' and migrated_user_id = user_a from public.guest_workspaces where id = guest));

  insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at)
  values ('hash-2', '{"guest":2}'::jsonb, 'arc-workflow-1', now() + interval '9 hours')
  returning id into guest;
  ok := false;
  begin
    select * into res from public.arc_migrate_guest_workspace(guest, user_a, '   ', 'Guest Contract', null);
  exception when others then ok := true; end;
  select status::text, draft_json into guest_status, guest_draft from public.guest_workspaces where id = guest;
  insert into arc_test_results values ('18 failed migration rolls back and leaves guest active',
    ok and guest_status = 'active' and guest_draft = '{"guest":2}'::jsonb);

  insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at)
  values ('hash-3', '{"guest":3}'::jsonb, 'arc-workflow-1', now() - interval '1 minute')
  returning id into guest;
  ok := false;
  begin
    select * into res from public.arc_migrate_guest_workspace(guest, user_a, 'Late Co', 'Late Contract', null);
  exception when others then ok := true; end;
  insert into arc_test_results values ('19 expired guest workspace cannot migrate', ok);

  delete from auth.users where id = user_a;
  insert into arc_test_results values ('20 account deletion cascades through frozen revisions',
    not exists (select 1 from public.analysis_revisions where analysis_id = ana));
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
  from arc_test_results where not passed;
  if v_failed > 0 then
    raise exception 'ARC SQL suite failed: % assertion(s) did not pass: %', v_failed, v_names;
  end if;
end $gate$;

rollback;
