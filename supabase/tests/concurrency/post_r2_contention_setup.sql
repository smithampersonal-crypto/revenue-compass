-- ARC Post-R2 contention driver — committed fixture.
--
-- One temporary guest workspace with an AI sidecar and a succeeded run: the
-- exact production shape a guest autosave reconciles. These rows must be
-- committed so a second, genuinely concurrent session can lock the owner row.
-- They are removed by post_r2_contention_teardown.sql.

insert into public.guest_workspaces (token_hash, draft_json, schema_version, expires_at)
values (repeat('b', 64), '{"transactionPriceInput":"120000"}'::jsonb, 'arc.workflow.v1',
        now() + interval '9 hours');

insert into public.ai_runs (id, guest_workspace_id, guest_token_hash, quota_scope, stage,
                            source_set_fingerprint, pre_run_canonical_inputs, model,
                            reasoning_effort, prompt_version, output_schema_version,
                            guidance_registry_hash, openai_started_at, completed_at)
select '11111111-2222-3333-4444-555555555555'::uuid, g.id, g.token_hash, 'guest', 'succeeded',
       'fp-post-r2', '{}'::jsonb, 'm', 'high', 'p', 's', 'h', now(), now()
  from public.guest_workspaces g where g.token_hash = repeat('b', 64);

insert into public.ai_analysis_state (guest_workspace_id, last_successful_run_id,
                                      source_set_fingerprint, field_provenance,
                                      object_provenance, tombstones, review_items)
select g.id, '11111111-2222-3333-4444-555555555555'::uuid, 'fp-post-r2',
       '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb
  from public.guest_workspaces g where g.token_hash = repeat('b', 64);
