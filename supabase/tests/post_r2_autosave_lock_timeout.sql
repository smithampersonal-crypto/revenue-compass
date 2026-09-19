-- ARC Post-R2 live regression patch — autosave lock bounding (defect 4),
-- routine surface assertions.
--
-- Proves the staged replacement of arc_save_draft_with_ai_reconciliation
-- declares both bounds, sets them before any validation or locking, and keeps
-- its security and privilege invariants.
--
-- The behavioural half of this regression — a genuinely concurrent competing
-- transaction, the bounded 55P03 failure, the untouched draft/lock/sidecar/
-- audit trail, the successful save after release and the PT409 stale save — is
-- driven by scripts/post-r2-contention.sh, which the SQL suite runner executes
-- straight after these suites. Contention needs two independent client
-- sessions, which a single psql session cannot create (and which dblink cannot
-- create either against local Supabase or CI, because it dials out from inside
-- the database container where the host-facing URL is not reachable).
--
-- The idle_in_transaction_session_timeout is asserted from the routine's
-- source rather than by sleeping 15s: a wall-clock idle test is inherently
-- flaky here. It is exercised by the controlled hosted verification recorded
-- in roadmap.md after Cloud apply.
begin;

create temporary table arc_test_results (assertion text, passed boolean not null) on commit drop;

insert into arc_test_results
select '01 the routine bounds how long it waits for the owner row',
       (select p.prosrc like '%lock_timeout%' and p.prosrc like '%3s%'
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'arc_save_draft_with_ai_reconciliation');

insert into arc_test_results
select '02 the routine bounds an abandoned in-flight save',
       (select p.prosrc like '%idle_in_transaction_session_timeout%' and p.prosrc like '%15s%'
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'arc_save_draft_with_ai_reconciliation');

insert into arc_test_results
select '03 the bounds are set before any validation or locking',
       (select strpos(p.prosrc, 'lock_timeout') < strpos(p.prosrc, 'arc_lock_ai_review_scope')
           and strpos(p.prosrc, 'lock_timeout') < strpos(p.prosrc, 'p_expected_lock_version is null')
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'arc_save_draft_with_ai_reconciliation');

insert into arc_test_results
select '04 it is still security definer with the same fixed search_path',
       (select p.prosecdef and array_to_string(p.proconfig, ',') like '%search_path=pg_catalog, public%'
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'arc_save_draft_with_ai_reconciliation');

insert into arc_test_results
select '05 only the service role may still execute it',
       (select has_function_privilege('service_role', p.oid, 'execute')
           and not has_function_privilege('anon', p.oid, 'execute')
           and not has_function_privilege('authenticated', p.oid, 'execute')
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'arc_save_draft_with_ai_reconciliation');

insert into arc_test_results
select '06 exactly one routine of this name exists',
       (select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'arc_save_draft_with_ai_reconciliation');

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
