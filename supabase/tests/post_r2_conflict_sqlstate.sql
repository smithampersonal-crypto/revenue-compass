-- ARC Post-R2 database hardening — non-retryable conflict SQLSTATE.
--
-- A PostgREST client retries SQLSTATE 40001, because that code means "the
-- database could not serialize this transaction, try again". ARC used the same
-- code for its OWN optimistic-lock and business conflicts, which are permanent
-- for the request that hit them. Retrying them produced hundreds of thousands
-- of "the analysis changed since it was loaded" errors and sustained high
-- database CPU.
--
-- This suite proves, against the effective catalog rather than against source
-- files, that no ARC routine raises 40001 any more, and that a stale
-- optimistic lock now fails with the explicit non-retryable code PT409.
begin;

create temporary table arc_test_results (assertion text, passed boolean not null) on commit drop;

/* ------------------------------------------------------ 01 catalog scan */

insert into arc_test_results
select '01 no public routine raises an ARC-authored 40001 any more',
       not exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.prosrc like '%errcode = ''40001''%');

insert into arc_test_results
select '02 the conflict code is raised instead, across the ARC routine set',
       (select count(*) >= 19 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.prosrc like '%errcode = ''PT409''%');

insert into arc_test_results
select '03 no routine still catches the retryable code from a callee',
       not exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.prosrc like '%sqlstate ''40001''%');

insert into arc_test_results
select '04 the conflict code is outside the serialization-failure class',
       left('PT409', 2) <> '40';

/* ------------------------------------------------- 05 stale lock, guest */

do $guest$
declare
  v_hash text := repeat('c', 64);
  v_user uuid := gen_random_uuid();
  v_code text;
  v_before integer;
begin
  insert into auth.users (id, email) values (v_user, 'post-r2-conflict@example.test');
  insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at)
  values (v_hash, '{"transactionPriceInput":"120000"}'::jsonb, 'arc.workflow.v1',
          now() + interval '9 hours');

  select g.lock_version into v_before from public.guest_workspaces g where g.token_hash = v_hash;

  begin
    perform public.arc_migrate_guest_workspace_by_token_v3(
      v_hash, v_user, v_before + 7, null, 'Post R2 Customer', 'Post R2 Contract', null);
    v_code := 'none';
  exception when others then
    v_code := sqlstate;
  end;

  insert into arc_test_results
  select '05 a stale temporary-workspace lock raises PT409, not 40001', v_code = 'PT409';

  insert into arc_test_results
  select '06 the rejected claim changed nothing',
         (select g.lock_version from public.guest_workspaces g where g.token_hash = v_hash)
           = v_before
     and not exists (select 1 from public.customers cu where cu.owner_user_id = v_user);
end $guest$;

/* ---------------------------------------------- 07 stale lock, documents */

do $docs$
declare
  v_hash text := repeat('d', 64);
  v_guest uuid;
  v_doc uuid := gen_random_uuid();
  v_code text;
begin
  insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at)
  values (v_hash, '{}'::jsonb, 'arc.workflow.v1', now() + interval '9 hours')
  returning id into v_guest;

  begin
    perform public.arc_attach_guest_source_document(v_hash, v_doc, 42);
    v_code := 'none';
  exception when others then
    v_code := sqlstate;
  end;

  insert into arc_test_results
  select '07 a stale document-attach lock raises PT409, not 40001', v_code = 'PT409';

  insert into arc_test_results
  select '08 the rejected attach left the temporary workspace untouched',
         (select g.lock_version from public.guest_workspaces g where g.id = v_guest) = 1;
end $docs$;

/* -------------------------------------------------------------- gate */

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
