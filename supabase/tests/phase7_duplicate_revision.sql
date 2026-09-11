-- ARC Phase 7B — dedicated proof that duplicate (analysis_id, revision_number)
-- is rejected specifically by the database uniqueness constraint, independently
-- of the revision INSERT trigger (which rejects malformed/finalized rows first).
-- Runs inside a rolled-back transaction with synthetic auth users only.
begin;

create temporary table arc_dup_results (assertion text, passed boolean, detail text) on commit drop;

do $$
declare
  user_a uuid := '00000000-0000-4000-8000-0000000000da';
  cust_a uuid;
  cont_a uuid;
  ana_a uuid;
  rev_1 uuid;
  ok boolean;
  err_state text;
  err_constraint text;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (user_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'arc-dup-a@example.test', '', now(), now(), now());

  insert into public.customers (owner_user_id, name) values (user_a, 'Dup Customer')
    returning id into cust_a;
  insert into public.contracts (customer_id, title) values (cust_a, 'Dup Contract')
    returning id into cont_a;
  insert into public.analyses (contract_id) values (cont_a) returning id into ana_a;
  insert into public.analysis_revisions (analysis_id, revision_number, canonical_inputs, schema_version)
  values (ana_a, 1, '{}'::jsonb, 'arc-workflow-1') returning id into rev_1;

  -- Finalize revision 1 so a *valid* second draft row is permitted by the
  -- one-active-draft rule; the only remaining defect is the duplicate number.
  perform public.arc_finalize_revision(
    user_a, rev_1, 1, '{"ok":true}'::jsonb, '{"reconciled":true}'::jsonb,
    'arc-engine-test', 'arc-workflow-1');

  ok := false;
  err_state := null;
  err_constraint := null;
  begin
    -- A structurally valid empty draft: passes the INSERT trigger, so the only
    -- possible rejection is the (analysis_id, revision_number) unique index.
    insert into public.analysis_revisions (analysis_id, revision_number, canonical_inputs, schema_version)
    values (ana_a, 1, '{}'::jsonb, 'arc-workflow-1');
  exception when unique_violation then
    ok := true;
    err_state := sqlstate;
    get stacked diagnostics err_constraint = constraint_name;
  end;

  insert into arc_dup_results values (
    '01 duplicate (analysis_id, revision_number) rejected by unique constraint',
    ok and err_state = '23505',
    coalesce(err_state, 'no error') || ' / ' || coalesce(err_constraint, 'unnamed'));

  -- A distinct revision_number on the same analysis is still accepted, proving
  -- the rejection above was the uniqueness rule and not a blanket insert block.
  ok := true;
  begin
    insert into public.analysis_revisions (analysis_id, revision_number, canonical_inputs, schema_version)
    values (ana_a, 2, '{}'::jsonb, 'arc-workflow-1');
  exception when others then
    ok := false;
  end;
  insert into arc_dup_results values ('02 next revision_number accepted', ok, null);
end $$;

select assertion, passed, detail from arc_dup_results order by assertion;

-- CI gate: a false assertion must make psql exit non-zero.
do $gate$
declare
  v_failed integer;
  v_names text;
begin
  select count(*), string_agg(assertion, '; ' order by assertion)
    into v_failed, v_names
  from arc_dup_results where passed is not true;
  if v_failed > 0 then
    raise exception 'ARC SQL suite failed: % assertion(s) did not pass: %', v_failed, v_names;
  end if;
end $gate$;

rollback;
