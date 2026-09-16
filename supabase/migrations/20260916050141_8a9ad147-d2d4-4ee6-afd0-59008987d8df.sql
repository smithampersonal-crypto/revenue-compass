create or replace function public.arc_protect_ai_run()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_terminal constant text[] := array['succeeded', 'preflight_failed', 'api_failed',
                                      'response_invalid', 'application_failed'];
  v_probe public.ai_runs;
  v_rehome boolean;
begin
  -- Accepted Phase 9A semantics: deletion is a parent-lifecycle concern. An
  -- expired temporary workspace, a deleted contract or a deleted account must
  -- be able to take its AI rows with it. No browser role holds delete here.
  if tg_op = 'DELETE' then
    return old;
  end if;

  -- The single permitted ownership transition: a temporary-workspace run
  -- becomes a saved-revision run when the visitor saves their work.
  v_rehome := old.guest_workspace_id is not null
              and new.guest_workspace_id is null
              and old.revision_id is null
              and new.revision_id is not null;

  if old.stage = any (v_terminal) then
    v_probe := new;
    v_probe.restored_at := old.restored_at;
    v_probe.updated_at := old.updated_at;
    if v_rehome then
      v_probe.revision_id := old.revision_id;
      v_probe.guest_workspace_id := old.guest_workspace_id;
      v_probe.owner_user_id := old.owner_user_id;
    end if;
    if v_probe is distinct from old then
      raise exception 'ARC: a completed AI run is immutable';
    end if;
    return new;
  end if;

  if new.id <> old.id
     or (not v_rehome and (new.revision_id is distinct from old.revision_id
                           or new.guest_workspace_id is distinct from old.guest_workspace_id
                           or new.owner_user_id is distinct from old.owner_user_id))
     or new.guest_token_hash is distinct from old.guest_token_hash
     or new.quota_scope <> old.quota_scope
     or new.source_set_fingerprint <> old.source_set_fingerprint
     or new.pre_run_canonical_inputs is distinct from old.pre_run_canonical_inputs
     or new.pre_run_ai_state is distinct from old.pre_run_ai_state
     or new.model <> old.model
     or new.reasoning_effort <> old.reasoning_effort
     or new.prompt_version <> old.prompt_version
     or new.output_schema_version <> old.output_schema_version
     or new.guidance_registry_hash <> old.guidance_registry_hash
     or new.created_at <> old.created_at then
    raise exception 'ARC: AI run provenance is immutable';
  end if;

  if old.openai_started_at is not null
     and new.openai_started_at is distinct from old.openai_started_at then
    raise exception 'ARC: the OpenAI start stamp is immutable once set';
  end if;

  return new;
end;
$$;