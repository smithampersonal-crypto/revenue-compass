-- Companion proof: an assertion that is NULL (unknown) must also fail the gate.
-- Postgres three-valued logic drops NULL from `where not passed`, so the gate
-- uses `passed is not true`. This file proves that.
begin;

-- Deliberately nullable here: the suites themselves declare NOT NULL, this
-- file exists to prove the gate would still catch an unknown result.
create temporary table arc_test_results (assertion text, passed boolean) on commit drop;
insert into arc_test_results values ('gate proof: unknown/NULL result', null);

select assertion, passed from arc_test_results order by assertion;

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
