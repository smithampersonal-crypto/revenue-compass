-- Runner-level proof that a failed assertion fails the test command.
-- Not part of supabase/tests/, so it never runs in an ordinary `db:test`.
-- Run with: bun run db:test:gate-proof  (expected to exit non-zero)
begin;

create temporary table arc_test_results (assertion text, passed boolean) on commit drop;
insert into arc_test_results values ('gate proof: deliberately false', false);

select assertion, passed from arc_test_results order by assertion;

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
