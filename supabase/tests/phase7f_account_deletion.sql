-- ARC Phase 7F — account deletion and guest physical retention assertions.
-- Runs inside a rolled-back transaction with synthetic auth users only.
-- Every row must report passed = true.
begin;

create temporary table arc_test_results (assertion text, passed boolean) on commit drop;

-- 01-06 Both Phase 7F routines are service-role only.
insert into arc_test_results values (
  '01 anon cannot execute arc_purge_user_guest_data',
  not has_function_privilege('anon', 'public.arc_purge_user_guest_data(uuid,text)', 'execute')
);
insert into arc_test_results values (
  '02 authenticated cannot execute arc_purge_user_guest_data',
  not has_function_privilege('authenticated', 'public.arc_purge_user_guest_data(uuid,text)', 'execute')
);
insert into arc_test_results values (
  '03 service_role can execute arc_purge_user_guest_data',
  has_function_privilege('service_role', 'public.arc_purge_user_guest_data(uuid,text)', 'execute')
);
insert into arc_test_results values (
  '04 anon cannot execute arc_delete_expired_guest_workspaces',
  not has_function_privilege('anon', 'public.arc_delete_expired_guest_workspaces()', 'execute')
);
insert into arc_test_results values (
  '05 authenticated cannot execute arc_delete_expired_guest_workspaces',
  not has_function_privilege('authenticated', 'public.arc_delete_expired_guest_workspaces()', 'execute')
);
insert into arc_test_results values (
  '06 service_role can execute arc_delete_expired_guest_workspaces',
  has_function_privilege('service_role', 'public.arc_delete_expired_guest_workspaces()', 'execute')
);

do $$
declare
  owner_id uuid := '00000000-0000-4000-8000-0000000007f1';
  other_id uuid := '00000000-0000-4000-8000-0000000007f2';
  hash_migrated text := repeat('1', 64);
  hash_browser  text := repeat('2', 64);
  hash_other    text := repeat('3', 64);
  hash_expired  text := repeat('4', 64);
  customer_id uuid; contract_id uuid; analysis_id uuid; revision_id uuid;
  purged integer; removed integer; failed boolean;
  draft jsonb := '{"schemaVersion":"arc.workflow.v1","contract":{"customerName":"Deletion Co"}}'::jsonb;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (owner_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'arc-delete-owner@example.test', '', now(), now(), now()),
         (other_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'arc-delete-other@example.test', '', now(), now(), now());

  insert into public.customers (owner_user_id, name) values (owner_id, 'Deletion Co')
  returning id into customer_id;
  insert into public.contracts (customer_id, title) values (customer_id, 'Deletion contract')
  returning id into contract_id;
  insert into public.analyses (contract_id) values (contract_id) returning id into analysis_id;
  insert into public.analysis_revisions (analysis_id, revision_number, canonical_inputs, schema_version)
  values (analysis_id, 1, draft, 'arc.workflow.v1') returning id into revision_id;

  -- A finalized revision is the hardest case: it is immutable outside the
  -- account-deletion path.
  perform public.arc_finalize_revision(
    owner_id, revision_id, 1, '{"engine":"outputs"}'::jsonb, '{"reconciliation":true}'::jsonb,
    'arc.workflow.v1', 'arc.engine.v1');

  -- Guest rows holding this person's data: one they migrated from, one open in
  -- their current browser. A third belongs to somebody else.
  insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at,
                                       status, migrated_user_id)
  values (hash_migrated, draft, 'arc.workflow.v1', now() + interval '9 hours', 'migrated', owner_id);
  insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at)
  values (hash_browser, draft, 'arc.workflow.v1', now() + interval '9 hours');
  insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at,
                                       status, migrated_user_id)
  values (hash_other, draft, 'arc.workflow.v1', now() + interval '9 hours', 'migrated', other_id);

  -- 07 Finalized revisions are not deletable through ordinary paths.
  failed := false;
  begin
    delete from public.analysis_revisions where id = revision_id;
  exception when others then failed := true; end;
  insert into arc_test_results values ('07 finalized revision cannot be deleted directly', failed);

  -- 08 Guest personal data is purged first, while migrated_user_id still names it.
  select public.arc_purge_user_guest_data(owner_id, hash_browser) into purged;
  insert into arc_test_results values ('08 both guest rows of the deleting user are purged', purged = 2);
  insert into arc_test_results
  select '09 another user''s guest row is untouched',
         exists (select 1 from public.guest_workspaces where token_hash = hash_other);

  -- 10-13 Deleting the auth identity removes the whole owned chain, finalized
  -- revisions included.
  delete from auth.users where id = owner_id;
  insert into arc_test_results
  select '10 no customer remains', not exists (select 1 from public.customers where id = customer_id);
  insert into arc_test_results
  select '11 no contract remains', not exists (select 1 from public.contracts where id = contract_id);
  insert into arc_test_results
  select '12 no analysis remains', not exists (select 1 from public.analyses where id = analysis_id);
  insert into arc_test_results
  select '13 no revision remains, including the finalized one',
         not exists (select 1 from public.analysis_revisions where id = revision_id);
  insert into arc_test_results
  select '14 no guest draft of the deleted user remains',
         not exists (select 1 from public.guest_workspaces
                     where token_hash in (hash_migrated, hash_browser));

  -- 15-17 Physical retention: the nine-hour lifetime is the retention boundary.
  insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at)
  values (hash_expired, draft, 'arc.workflow.v1', now() - interval '1 minute');
  select public.arc_delete_expired_guest_workspaces() into removed;
  insert into arc_test_results values ('15 expired guest rows are physically deleted', removed >= 1);
  insert into arc_test_results
  select '16 the expired row is gone',
         not exists (select 1 from public.guest_workspaces where token_hash = hash_expired);
  insert into arc_test_results
  select '17 unexpired rows survive cleanup',
         exists (select 1 from public.guest_workspaces where token_hash = hash_other);
end $$;

select assertion, passed from arc_test_results order by assertion;
select count(*) filter (where not passed) as failures, count(*) as total from arc_test_results;

rollback;
