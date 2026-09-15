-- ARC Phase 9C — AI run/state/quota foundation.
--
-- Schema, grants, ownership isolation, active-run uniqueness, exact quota
-- semantics, the consumption boundary and completed-run immutability.
-- Runs inside a rolled-back transaction. Every row must report passed = true.
--
-- Concurrency note: this harness runs in a SINGLE database session. The
-- partial unique indexes are proven structurally (a second active insert is
-- rejected), never as a genuine two-session race.
begin;

create temporary table arc_test_results (assertion text, passed boolean not null) on commit drop;

/* ------------------------------------------------------------ 01 schema */

insert into arc_test_results
select '01 all five Phase 9 AI tables exist',
       (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'r'
           and c.relname in ('ai_runs', 'ai_run_sources', 'ai_run_guidance',
                             'ai_analysis_state', 'ai_monthly_usage')) = 5;

insert into arc_test_results
select '02 row level security is enabled on every Phase 9 AI table',
       not exists (
         select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r'
            and c.relname in ('ai_runs', 'ai_run_sources', 'ai_run_guidance',
                              'ai_analysis_state', 'ai_monthly_usage')
            and not c.relrowsecurity);

insert into arc_test_results
select '03 the Phase 9 AI tables expose no policy at all',
       not exists (
         select 1 from pg_policies p
          where p.schemaname = 'public'
            and p.tablename in ('ai_runs', 'ai_run_sources', 'ai_run_guidance',
                                'ai_analysis_state', 'ai_monthly_usage'));

insert into arc_test_results
select '04 anon and signed-in users hold no privilege of any kind on the AI tables',
       not exists (
         select 1 from information_schema.role_table_grants g
          where g.table_schema = 'public'
            and g.grantee in ('anon', 'authenticated')
            and g.table_name in ('ai_runs', 'ai_run_sources', 'ai_run_guidance',
                                 'ai_analysis_state', 'ai_monthly_usage'));

insert into arc_test_results
select '05 the service role can reach every AI table',
       not exists (
         select 1 from (values ('ai_runs'), ('ai_run_sources'), ('ai_run_guidance'),
                               ('ai_analysis_state'), ('ai_monthly_usage')) as t(name)
          where not has_table_privilege('service_role', 'public.' || t.name, 'select, insert, update, delete'));

insert into arc_test_results
select '06 the trusted Phase 9 AI functions exist',
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname in ('arc_create_ai_run', 'arc_reserve_ai_allowance',
                             'arc_mark_ai_run_failure')) = 3;

insert into arc_test_results
select '07 every trusted Phase 9 AI function is security definer with a fixed search_path',
       not exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname in ('arc_create_ai_run', 'arc_reserve_ai_allowance',
                              'arc_mark_ai_run_failure')
            and (not p.prosecdef
                 or coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path=%'));

insert into arc_test_results
select '08 no trusted Phase 9 AI function is executable by public, anon or signed-in users',
       not exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname in ('arc_create_ai_run', 'arc_reserve_ai_allowance',
                              'arc_mark_ai_run_failure')
            and (has_function_privilege('anon', p.oid, 'execute')
                 or has_function_privilege('authenticated', p.oid, 'execute')));

insert into arc_test_results
select '09 every trusted Phase 9 AI function is executable by the service role',
       not exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname in ('arc_create_ai_run', 'arc_reserve_ai_allowance',
                              'arc_mark_ai_run_failure')
            and not has_function_privilege('service_role', p.oid, 'execute'));

insert into arc_test_results
select '10 no AI table persists raw evidence, prompts or signed links',
       not exists (
         select 1 from information_schema.columns c
          where c.table_schema = 'public'
            and c.table_name in ('ai_runs', 'ai_run_sources', 'ai_run_guidance',
                                 'ai_analysis_state', 'ai_monthly_usage')
            and (c.column_name like '%pdf%' or c.column_name like '%base64%'
                 or c.column_name like '%page_text%' or c.column_name like '%raw_prompt%'
                 or c.column_name like '%signed_url%' or c.column_name like '%full_text%'
                 or c.column_name like '%raw_response%'));

/* ----------------------------------------------- fixtures and behaviour */

do $phase9$
declare
  v_user_a uuid := gen_random_uuid();
  v_user_b uuid := gen_random_uuid();
  v_customer uuid;
  v_contract uuid;
  v_analysis uuid;
  v_revision uuid;
  v_guest_a uuid;
  v_guest_b uuid;
  v_hash_a text := repeat('a', 64);
  v_hash_b text := repeat('b', 64);
  v_run uuid;
  v_run2 uuid;
  v_other uuid;
  v_month date := date_trunc('month', now() at time zone 'utc')::date;
  v_next_month date := (date_trunc('month', now() at time zone 'utc') + interval '1 month')::date;
  v_reserved boolean;
  v_already boolean;
  v_remaining integer;
  v_usage integer;
  v_i integer;
  ok boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (v_user_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          '9c-a@example.test', '', now(), now(), now()),
         (v_user_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          '9c-b@example.test', '', now(), now(), now());

  insert into public.customers (owner_user_id, name) values (v_user_a, 'Phase 9C Customer')
    returning id into v_customer;
  insert into public.contracts (customer_id, title) values (v_customer, 'Phase 9C Contract')
    returning id into v_contract;
  insert into public.analyses (contract_id) values (v_contract) returning id into v_analysis;
  insert into public.analysis_revisions (analysis_id, revision_number, canonical_inputs, schema_version)
  values (v_analysis, 1, '{}'::jsonb, 'arc.workflow.v1') returning id into v_revision;

  insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at)
  values (v_hash_a, '{}'::jsonb, 'arc.workflow.v1', now() + interval '9 hours')
    returning id into v_guest_a;
  insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at)
  values (v_hash_b, '{}'::jsonb, 'arc.workflow.v1', now() + interval '9 hours')
    returning id into v_guest_b;

  /* ------------------------------------------------- owner XOR invariant */

  begin
    insert into public.ai_runs (id, quota_scope, source_set_fingerprint, pre_run_canonical_inputs,
                                model, reasoning_effort, prompt_version, output_schema_version,
                                guidance_registry_hash, owner_user_id)
    values (gen_random_uuid(), 'authenticated', 'fp', '{}'::jsonb, 'm', 'high', 'p1', 's1', 'h1', v_user_a);
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results values ('11 a run with neither a revision nor a guest workspace is rejected', ok);

  begin
    insert into public.ai_runs (id, revision_id, guest_workspace_id, quota_scope,
                                source_set_fingerprint, pre_run_canonical_inputs, model,
                                reasoning_effort, prompt_version, output_schema_version,
                                guidance_registry_hash, owner_user_id)
    values (gen_random_uuid(), v_revision, v_guest_a, 'authenticated', 'fp', '{}'::jsonb,
            'm', 'high', 'p1', 's1', 'h1', v_user_a);
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results values ('12 a run owned by both a revision and a guest workspace is rejected', ok);

  begin
    insert into public.ai_runs (id, revision_id, quota_scope, stage, source_set_fingerprint,
                                pre_run_canonical_inputs, model, reasoning_effort, prompt_version,
                                output_schema_version, guidance_registry_hash, owner_user_id)
    values (gen_random_uuid(), v_revision, 'authenticated', 'not_a_stage', 'fp', '{}'::jsonb,
            'm', 'high', 'p1', 's1', 'h1', v_user_a);
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results values ('13 an unknown run state is rejected', ok);

  /* --------------------------------------------------------- create run */

  v_run := gen_random_uuid();
  perform public.arc_create_ai_run(v_run, v_user_a, null, v_revision, null, 1, 'authenticated',
                                   'fp-1', '{"a":1}'::jsonb, null, 'gpt-5.6-terra', 'high',
                                   'arc.prompt.v1', 'arc.schema.v1', 'hash-1');

  insert into arc_test_results
  select '14 a created run is not yet consumed and has no OpenAI start stamp',
         (select stage from public.ai_runs where id = v_run) = 'created'
     and (select openai_started_at from public.ai_runs where id = v_run) is null
     and not exists (select 1 from public.ai_monthly_usage where user_id = v_user_a);

  -- A cross-user or wrong-lock create must fail.
  begin
    perform public.arc_create_ai_run(gen_random_uuid(), v_user_b, null, v_revision, null, 1,
                                     'authenticated', 'fp', '{}'::jsonb, null, 'm', 'high',
                                     'p1', 's1', 'h1');
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results values ('15 another signed-in user cannot create a run on this revision', ok);

  begin
    perform public.arc_create_ai_run(gen_random_uuid(), v_user_a, null, v_revision, null, 99,
                                     'authenticated', 'fp', '{}'::jsonb, null, 'm', 'high',
                                     'p1', 's1', 'h1');
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results values ('16 a stale optimistic lock cannot create a run', ok);

  /* -------------------------------------------------- one active per scope */

  begin
    insert into public.ai_runs (id, revision_id, quota_scope, source_set_fingerprint,
                                pre_run_canonical_inputs, model, reasoning_effort, prompt_version,
                                output_schema_version, guidance_registry_hash, owner_user_id)
    values (gen_random_uuid(), v_revision, 'authenticated', 'fp', '{}'::jsonb, 'm', 'high',
            'p1', 's1', 'h1', v_user_a);
    ok := false;
  exception when unique_violation then ok := true;
  end;
  insert into arc_test_results values ('17 a revision cannot hold two simultaneous active runs', ok);

  /* ------------------------------------------- authenticated consumption */

  select reserved, already_reserved, remaining_allowance
    into v_reserved, v_already, v_remaining
  from public.arc_reserve_ai_allowance(v_run, v_user_a, null, v_month, 10, 3);

  insert into arc_test_results
  select '18 reservation consumes one unit, stamps the OpenAI start and moves the run to analyzing',
         v_reserved and not v_already and v_remaining = 9
     and (select stage from public.ai_runs where id = v_run) = 'analyzing'
     and (select openai_started_at from public.ai_runs where id = v_run) is not null
     and (select runs_consumed from public.ai_monthly_usage
           where user_id = v_user_a and usage_month = v_month) = 1;

  select reserved, already_reserved into v_reserved, v_already
  from public.arc_reserve_ai_allowance(v_run, v_user_a, null, v_month, 10, 3);

  insert into arc_test_results
  select '19 retrying the same reservation consumes no additional unit',
         v_reserved and v_already
     and (select runs_consumed from public.ai_monthly_usage
           where user_id = v_user_a and usage_month = v_month) = 1;

  select reserved into v_reserved
  from public.arc_reserve_ai_allowance(v_run, v_user_b, null, v_month, 10, 3);
  insert into arc_test_results values (
    '20 another user cannot reserve against a run they do not own', v_reserved is not true);

  -- A post-reservation failure stays consumed.
  perform public.arc_mark_ai_run_failure(v_run, 'openai_request', 'api', 'timeout',
                                         'The AI service did not respond in time.');
  insert into arc_test_results
  select '21 a failure after the OpenAI start boundary remains consumed',
         (select stage from public.ai_runs where id = v_run) = 'api_failed'
     and (select openai_started_at from public.ai_runs where id = v_run) is not null
     and (select runs_consumed from public.ai_monthly_usage
           where user_id = v_user_a and usage_month = v_month) = 1;

  insert into arc_test_results
  select '22 a terminal run no longer blocks a new run on the same revision',
         public.arc_create_ai_run(gen_random_uuid(), v_user_a, null, v_revision, null, 1,
                                  'authenticated', 'fp-2', '{}'::jsonb, null, 'm', 'high',
                                  'p1', 's1', 'h1') is not null;

  -- Clear the second run so the monthly loop below is unambiguous.
  update public.ai_runs set stage = 'preflight_failed', completed_at = now()
   where revision_id = v_revision and openai_started_at is null;

  -- Ten reservations per UTC month, the eleventh rejected.
  for v_i in 2..10 loop
    v_run2 := gen_random_uuid();
    insert into public.ai_runs (id, guest_workspace_id, quota_scope, guest_token_hash,
                                source_set_fingerprint, pre_run_canonical_inputs, model,
                                reasoning_effort, prompt_version, output_schema_version,
                                guidance_registry_hash, owner_user_id, stage)
    values (v_run2, null, 'authenticated', null, 'fp', '{}'::jsonb, 'm', 'high', 'p1', 's1',
            'h1', v_user_a, 'preflight_ready');
    update public.ai_runs set revision_id = v_revision where id = v_run2;
    perform public.arc_reserve_ai_allowance(v_run2, v_user_a, null, v_month, 10, 3);
    update public.ai_runs set stage = 'succeeded', completed_at = now() where id = v_run2;
  end loop;

  insert into arc_test_results
  select '23 ten authenticated reservations succeed in one UTC month',
         (select runs_consumed from public.ai_monthly_usage
           where user_id = v_user_a and usage_month = v_month) = 10;

  v_run2 := gen_random_uuid();
  perform public.arc_create_ai_run(v_run2, v_user_a, null, v_revision, null, 1, 'authenticated',
                                   'fp-11', '{}'::jsonb, null, 'm', 'high', 'p1', 's1', 'h1');
  select reserved, remaining_allowance into v_reserved, v_remaining
  from public.arc_reserve_ai_allowance(v_run2, v_user_a, null, v_month, 10, 3);

  insert into arc_test_results
  select '24 the eleventh authenticated reservation in the same UTC month is rejected',
         v_reserved is not true and v_remaining = 0
     and (select openai_started_at from public.ai_runs where id = v_run2) is null
     and (select stage from public.ai_runs where id = v_run2) = 'created'
     and (select runs_consumed from public.ai_monthly_usage
           where user_id = v_user_a and usage_month = v_month) = 10;

  select reserved into v_reserved
  from public.arc_reserve_ai_allowance(v_run2, v_user_a, null, v_next_month, 10, 3);
  insert into arc_test_results
  select '25 the next UTC month receives a fresh allowance',
         v_reserved
     and (select runs_consumed from public.ai_monthly_usage
           where user_id = v_user_a and usage_month = v_next_month) = 1
     and (select runs_consumed from public.ai_monthly_usage
           where user_id = v_user_a and usage_month = v_month) = 10;
  update public.ai_runs set stage = 'succeeded', completed_at = now() where id = v_run2;

  /* ------------------------------------------------------- guest quota */

  for v_i in 1..3 loop
    v_run2 := gen_random_uuid();
    perform public.arc_create_ai_run(v_run2, null, v_hash_a, null, v_guest_a, 1, 'guest',
                                     'fp-g', '{}'::jsonb, null, 'm', 'high', 'p1', 's1', 'h1');
    select reserved into v_reserved
    from public.arc_reserve_ai_allowance(v_run2, null, v_hash_a, v_month, 10, 3);
    if not v_reserved then
      raise exception 'guest reservation % unexpectedly rejected', v_i;
    end if;
    update public.ai_runs set stage = 'succeeded', completed_at = now() where id = v_run2;
  end loop;

  insert into arc_test_results
  select '26 the first three anonymous runs in a temporary workspace are allowed',
         (select count(*) from public.ai_runs
           where guest_workspace_id = v_guest_a and quota_scope = 'guest'
             and openai_started_at is not null) = 3;

  v_run2 := gen_random_uuid();
  perform public.arc_create_ai_run(v_run2, null, v_hash_a, null, v_guest_a, 1, 'guest',
                                   'fp-g4', '{}'::jsonb, null, 'm', 'high', 'p1', 's1', 'h1');
  select reserved, remaining_allowance into v_reserved, v_remaining
  from public.arc_reserve_ai_allowance(v_run2, null, v_hash_a, v_month, 10, 3);

  insert into arc_test_results
  select '27 the fourth anonymous run in the same temporary workspace is rejected',
         v_reserved is not true and v_remaining = 0
     and (select openai_started_at from public.ai_runs where id = v_run2) is null;

  -- A preflight failure before reservation consumes nothing.
  perform public.arc_mark_ai_run_failure(v_run2, 'preflight', 'preflight', 'input_tokens_exceeded',
                                         'The selected PDFs are too long for one AI analysis.');
  insert into arc_test_results
  select '28 a preflight failure before reservation consumes no allowance',
         (select stage from public.ai_runs where id = v_run2) = 'preflight_failed'
     and (select openai_started_at from public.ai_runs where id = v_run2) is null
     and (select count(*) from public.ai_runs
           where guest_workspace_id = v_guest_a and quota_scope = 'guest'
             and openai_started_at is not null) = 3;

  -- Another temporary workspace has its own independent allowance.
  v_run2 := gen_random_uuid();
  perform public.arc_create_ai_run(v_run2, null, v_hash_b, null, v_guest_b, 1, 'guest',
                                   'fp-gb', '{}'::jsonb, null, 'm', 'high', 'p1', 's1', 'h1');
  select reserved into v_reserved
  from public.arc_reserve_ai_allowance(v_run2, null, v_hash_b, v_month, 10, 3);
  insert into arc_test_results
  select '29 a different temporary workspace has its own three-run allowance', v_reserved;

  select reserved, already_reserved into v_reserved, v_already
  from public.arc_reserve_ai_allowance(v_run2, null, v_hash_b, v_month, 10, 3);
  insert into arc_test_results
  select '30 retrying an anonymous reservation consumes no additional unit',
         v_reserved and v_already
     and (select count(*) from public.ai_runs
           where guest_workspace_id = v_guest_b and quota_scope = 'guest'
             and openai_started_at is not null) = 1;

  select reserved into v_reserved
  from public.arc_reserve_ai_allowance(v_run2, null, v_hash_a, v_month, 10, 3);
  insert into arc_test_results values (
    '31 another temporary workspace credential cannot reserve against this run', v_reserved is not true);

  begin
    insert into public.ai_runs (id, guest_workspace_id, quota_scope, guest_token_hash,
                                source_set_fingerprint, pre_run_canonical_inputs, model,
                                reasoning_effort, prompt_version, output_schema_version,
                                guidance_registry_hash)
    values (gen_random_uuid(), v_guest_b, 'guest', v_hash_b, 'fp', '{}'::jsonb, 'm', 'high',
            'p1', 's1', 'h1');
    ok := false;
  exception when unique_violation then ok := true;
  end;
  insert into arc_test_results values ('32 a temporary workspace cannot hold two simultaneous active runs', ok);
  update public.ai_runs set stage = 'succeeded', completed_at = now() where id = v_run2;

  /* -------------------------------- signed-in user, temporary workspace */

  select coalesce(runs_consumed, 0) into v_usage from public.ai_monthly_usage
   where user_id = v_user_b and usage_month = v_month;

  v_run2 := gen_random_uuid();
  perform public.arc_create_ai_run(v_run2, v_user_b, v_hash_b, null, v_guest_b, 1, 'authenticated',
                                   'fp-mixed', '{}'::jsonb, null, 'm', 'high', 'p1', 's1', 'h1');
  select reserved into v_reserved
  from public.arc_reserve_ai_allowance(v_run2, v_user_b, v_hash_b, v_month, 10, 3);

  insert into arc_test_results
  select '33 a signed-in caller in a temporary workspace debits the authenticated monthly allowance only',
         v_reserved
     and (select runs_consumed from public.ai_monthly_usage
           where user_id = v_user_b and usage_month = v_month) = 1
     and (select count(*) from public.ai_runs
           where guest_workspace_id = v_guest_b and quota_scope = 'guest'
             and openai_started_at is not null) = 1;
  update public.ai_runs set stage = 'succeeded', completed_at = now() where id = v_run2;

  /* ----------------------------------------------------- immutability */

  select id into v_other from public.ai_runs where stage = 'succeeded' limit 1;

  begin
    update public.ai_runs set quota_scope = 'guest' where id = v_other;
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results values ('34 a completed run''s quota scope cannot be rewritten', ok);

  begin
    update public.ai_runs set openai_started_at = null where id = v_other;
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results values ('35 a completed run''s OpenAI start stamp cannot be erased', ok);

  begin
    update public.ai_runs set model = 'cheaper-model', source_set_fingerprint = 'rewritten'
     where id = v_other;
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results values ('36 completed model and source-set provenance cannot be rewritten', ok);

  begin
    delete from public.ai_runs where id = v_other;
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results values (
    '37 a consumed run cannot be deleted', ok and exists (select 1 from public.ai_runs where id = v_other));

  begin
    perform public.arc_mark_ai_run_failure(v_other, 'apply', 'application', 'late',
                                           'Rewriting a completed run.');
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results values ('38 a completed run cannot be re-marked as failed', ok);

  -- Before completion, mutable operational fields still move freely.
  v_run2 := gen_random_uuid();
  perform public.arc_create_ai_run(v_run2, null, v_hash_a, null, v_guest_a, 1, 'guest',
                                   'fp-mutable', '{}'::jsonb, null, 'm', 'high', 'p1', 's1', 'h1');
  update public.ai_runs set stage = 'extracting', input_tokens = 1234, source_count = 2, page_count = 40
   where id = v_run2;
  insert into arc_test_results
  select '39 an in-progress run still accepts operational updates',
         (select input_tokens from public.ai_runs where id = v_run2) = 1234;

  /* ------------------------------------------------- AI state and usage */

  insert into public.ai_analysis_state (guest_workspace_id, source_set_fingerprint)
  values (v_guest_a, 'fp-state');
  begin
    insert into public.ai_analysis_state (guest_workspace_id, source_set_fingerprint)
    values (v_guest_a, 'fp-state-2');
    ok := false;
  exception when unique_violation then ok := true;
  end;
  insert into arc_test_results values ('40 a temporary workspace holds at most one current AI state row', ok);

  begin
    insert into public.ai_analysis_state (revision_id, guest_workspace_id, source_set_fingerprint)
    values (v_revision, v_guest_b, 'fp');
    ok := false;
  exception when others then ok := true;
  end;
  insert into arc_test_results values ('41 an AI state row owned by both scopes is rejected', ok);

  begin
    insert into public.ai_monthly_usage (user_id, usage_month, runs_consumed)
    values (v_user_a, v_month, 1);
    ok := false;
  exception when unique_violation then ok := true;
  end;
  insert into arc_test_results values ('42 a user cannot hold duplicate usage rows for one UTC month', ok);

  insert into arc_test_results
  select '43 monthly usage rows are always stored as the first day of a UTC month',
         not exists (select 1 from public.ai_monthly_usage
                      where usage_month <> date_trunc('month', usage_month)::date);
end $phase9$;

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
