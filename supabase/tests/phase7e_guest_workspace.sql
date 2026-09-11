-- ARC Phase 7E — guest workspace access and token-hash migration assertions.
-- Runs inside a rolled-back transaction with synthetic auth users only.
-- Every row must report passed = true.
begin;

create temporary table arc_test_results (assertion text, passed boolean not null) on commit drop;

-- 01/02 Guest rows are server-only: no direct Data API access for visitors or
-- signed-in users.
insert into arc_test_results values (
  '01 anon has no table privileges on guest_workspaces',
  not (
    has_table_privilege('anon', 'public.guest_workspaces', 'select')
    or has_table_privilege('anon', 'public.guest_workspaces', 'insert')
    or has_table_privilege('anon', 'public.guest_workspaces', 'update')
    or has_table_privilege('anon', 'public.guest_workspaces', 'delete')
  )
);
insert into arc_test_results values (
  '02 authenticated has no table privileges on guest_workspaces',
  not (
    has_table_privilege('authenticated', 'public.guest_workspaces', 'select')
    or has_table_privilege('authenticated', 'public.guest_workspaces', 'insert')
    or has_table_privilege('authenticated', 'public.guest_workspaces', 'update')
    or has_table_privilege('authenticated', 'public.guest_workspaces', 'delete')
  )
);

-- 03 RLS stays on, so even a stray grant would not open the table up.
insert into arc_test_results
select '03 row level security enabled on guest_workspaces', c.relrowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'guest_workspaces';

-- 04/05/06 The migration transaction is service-role only.
insert into arc_test_results values (
  '04 anon cannot execute arc_migrate_guest_workspace_by_token',
  not has_function_privilege('anon',
    'public.arc_migrate_guest_workspace_by_token(text,uuid,integer,text,text,text)', 'execute')
);
insert into arc_test_results values (
  '05 authenticated cannot execute arc_migrate_guest_workspace_by_token',
  not has_function_privilege('authenticated',
    'public.arc_migrate_guest_workspace_by_token(text,uuid,integer,text,text,text)', 'execute')
);
insert into arc_test_results values (
  '06 service_role can execute arc_migrate_guest_workspace_by_token',
  has_function_privilege('service_role',
    'public.arc_migrate_guest_workspace_by_token(text,uuid,integer,text,text,text)', 'execute')
);

do $$
declare
  owner_id uuid := '00000000-0000-4000-8000-0000000007e1';
  hash_ok text := repeat('a', 64);
  hash_expired text := repeat('b', 64);
  hash_locked text := repeat('d', 64);
  hash_ok2 text := repeat('e', 64);
  other_id uuid := '00000000-0000-4000-8000-0000000007e2';
  guest_ok uuid; guest_expired uuid; guest_locked uuid; guest_ok2 uuid;
  res record; res2 record; failed boolean;

  draft jsonb := '{"schemaVersion":"arc.workflow.v1","contract":{"customerName":"Guest Co"}}'::jsonb;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (owner_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'arc-guest-owner@example.test', '', now(), now(), now());

  insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at)
  values (hash_ok, draft, 'arc.workflow.v1', now() + interval '9 hours')
  returning id into guest_ok;

  insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at)
  values (hash_expired, draft, 'arc.workflow.v1', now() - interval '1 minute')
  returning id into guest_expired;

  insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at)
  values (hash_ok2, draft, 'arc.workflow.v1', now() + interval '9 hours')
  returning id into guest_ok2;

  -- 07 The credential hash is unique.
  failed := false;
  begin
    insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at)
    values (hash_ok, draft, 'arc.workflow.v1', now() + interval '9 hours');
  exception when unique_violation then failed := true; end;
  insert into arc_test_results values ('07 duplicate token hash rejected', failed);

  -- 08 An expired workspace cannot be migrated, whatever cleanup has run.
  failed := false;
  begin
    select * into res from public.arc_migrate_guest_workspace_by_token(
      hash_expired, owner_id, 1, 'Guest Co', 'Expired contract', null);
  exception when others then failed := true; end;
  insert into arc_test_results values ('08 expired guest workspace cannot migrate', failed);

  -- 09 An unknown credential creates nothing.
  failed := false;
  begin
    select * into res from public.arc_migrate_guest_workspace_by_token(
      repeat('c', 64), owner_id, 1, 'Guest Co', 'Unknown contract', null);
  exception when others then failed := true; end;
  insert into arc_test_results values ('09 unknown credential cannot migrate', failed);

  -- 10 A blank contract title is rejected before anything is created.
  failed := false;
  begin
    select * into res from public.arc_migrate_guest_workspace_by_token(
      hash_ok, owner_id, 1, 'Guest Co', '   ', null);
  exception when others then failed := true; end;
  insert into arc_test_results values ('10 blank contract title rejected', failed);
  insert into arc_test_results
  select '11 nothing created by the rejected attempts',
         not exists (select 1 from public.contracts where title in ('Unknown contract', 'Expired contract'));

  -- 12 The successful path is one transaction producing the whole chain.
  select * into res from public.arc_migrate_guest_workspace_by_token(
    hash_ok, owner_id, 1, 'Guest Co', 'Guest contract', 'G-1');

  insert into arc_test_results
  select '12 customer created for the caller',
         exists (select 1 from public.customers
                 where id = res.customer_id and owner_user_id = owner_id and name = 'Guest Co');
  insert into arc_test_results
  select '13 contract created with the supplied title and drafted number',
         exists (select 1 from public.contracts
                 where id = res.contract_id and customer_id = res.customer_id
                   and title = 'Guest contract' and contract_number = 'G-1');
  insert into arc_test_results
  select '14 analysis created for the contract',
         exists (select 1 from public.analyses
                 where id = res.analysis_id and contract_id = res.contract_id);
  insert into arc_test_results
  select '15 revision 1 is a draft carrying the guest inputs',
         exists (select 1 from public.analysis_revisions
                 where id = res.revision_id and analysis_id = res.analysis_id
                   and revision_number = 1 and status = 'draft'
                   and canonical_inputs = draft
                   and engine_outputs is null and finalized_at is null);
  insert into arc_test_results
  select '16 guest workspace is retired as migrated',
         exists (select 1 from public.guest_workspaces
                 where id = guest_ok and status = 'migrated' and migrated_user_id = owner_id);

  -- 17 A retired workspace never migrates a second time: the committed result
  -- is returned again, so a lost response is recoverable without duplicates.
  select * into res2 from public.arc_migrate_guest_workspace_by_token(
    hash_ok, owner_id, 1, 'Guest Co', 'Second contract', null);
  insert into arc_test_results values (
    '17 migrated workspace returns the original result idempotently',
    res2.idempotent and res2.customer_id = res.customer_id and res2.contract_id = res.contract_id
      and res2.analysis_id = res.analysis_id and res2.revision_id = res.revision_id);
  insert into arc_test_results
  select '18 no duplicate chain created by the retry',
         (select count(*) from public.contracts where customer_id = res.customer_id) = 1
     and (select count(*) from public.analyses where contract_id = res.contract_id) = 1
     and (select count(*) from public.analysis_revisions where analysis_id = res.analysis_id) = 1
     and not exists (select 1 from public.contracts where title = 'Second contract');

  -- 19 A different account may never claim a migrated workspace.
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (other_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'arc-guest-other@example.test', '', now(), now(), now());
  failed := false;
  begin
    select * into res2 from public.arc_migrate_guest_workspace_by_token(
      hash_ok, other_id, 1, 'Guest Co', 'Stolen contract', null);
  exception when others then failed := true; end;
  insert into arc_test_results values ('19 another account cannot claim a migrated workspace', failed);

  -- 20/21 A stale expected lock version (a second tab that saved again)
  -- creates nothing at all.
  insert into public.guest_workspaces (token_hash, draft_json, schema_version, lock_version, expires_at)
  values (hash_locked, draft, 'arc.workflow.v1', 4, now() + interval '9 hours')
  returning id into guest_locked;
  failed := false;
  begin
    select * into res2 from public.arc_migrate_guest_workspace_by_token(
      hash_locked, owner_id, 3, 'Guest Co', 'Stale contract', null);
  exception when others then failed := true; end;
  insert into arc_test_results values ('20 stale expected lock version rejected', failed);
  insert into arc_test_results
  select '21 nothing created by the stale attempt',
         not exists (select 1 from public.contracts where title in ('Stale contract', 'Stolen contract'))
     and (select status from public.guest_workspaces where id = guest_locked) = 'active';

  -- 22 The matching lock version migrates once and records its provenance.
  select * into res2 from public.arc_migrate_guest_workspace_by_token(
    hash_locked, owner_id, 4, 'Guest Co', 'Locked contract', 'G-2');
  insert into arc_test_results
  select '22 matching lock version migrates and records provenance',
         not res2.idempotent
     and exists (select 1 from public.guest_workspaces
                 where id = guest_locked and status = 'migrated'
                   and migrated_user_id = owner_id
                   and migrated_customer_id = res2.customer_id
                   and migrated_contract_id = res2.contract_id
                   and migrated_analysis_id = res2.analysis_id
                   and migrated_revision_id = res2.revision_id);

  -- 23/24/25 Cleanup marks only genuinely expired active rows, and never
  -- decides access: authorization is expires_at, checked on every load/save.
  -- Physical deletion of long-expired rows is deliberately deferred to a
  -- Phase 7F / operations retention job; nothing here removes rows.
  insert into arc_test_results
  select '23 an unexpired workspace is active before cleanup',
         (select status from public.guest_workspaces where id = guest_ok2) = 'active';
  perform public.arc_expire_guest_workspaces();
  insert into arc_test_results
  select '24 cleanup expires only rows past their expiry',
         (select status from public.guest_workspaces where id = guest_expired) = 'expired'
     and (select status from public.guest_workspaces where id = guest_ok2) = 'active';
  insert into arc_test_results
  select '25 cleanup retains the rows rather than deleting them',
         exists (select 1 from public.guest_workspaces where id = guest_expired);

  -- 26/27 Provenance never blocks deletion of the saved chain it points at.
  delete from public.analysis_revisions where analysis_id = res2.analysis_id;
  delete from public.analyses where id = res2.analysis_id;
  delete from public.contracts where id = res2.contract_id;
  delete from public.customers where id = res2.customer_id;
  insert into arc_test_results
  select '26 the persistent chain can be deleted with a migrated guest row present',
         not exists (select 1 from public.customers where id = res2.customer_id);
  insert into arc_test_results
  select '27 migrated provenance is cleared rather than blocking deletion',
         exists (select 1 from public.guest_workspaces
                 where id = guest_locked and migrated_customer_id is null
                   and migrated_contract_id is null and migrated_analysis_id is null
                   and migrated_revision_id is null);
end $$;


select assertion, passed from arc_test_results order by assertion;
select count(*) filter (where passed is not true) as failures, count(*) as total from arc_test_results;

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
