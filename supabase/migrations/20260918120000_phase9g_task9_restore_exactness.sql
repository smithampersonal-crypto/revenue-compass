-- Phase 9G — Task 9C. Exact whole-run restore.
--
-- STAGED, NOT APPLIED. Replaces the body of `arc_restore_pre_ai_run` in place.
-- No table, column, index, grant, RLS policy or function signature changes.
-- Security attributes are preserved exactly: SECURITY DEFINER, a fixed
-- `search_path = pg_catalog, public`, and execute granted to service_role only
-- (already in force from 20260916033209; re-stated here as a no-op assertion).
--
-- Three defects are corrected, all of them about EXACTNESS:
--
--   1. The recorded pre-run sidecar is captured as the AI-state ROW, whose keys
--      are the column names (`last_successful_run_id`, `source_state`, ...).
--      The previous body read camelCase keys, so every field fell through to
--      its coalesce default: a restore silently reset the sidecar instead of
--      restoring it. The keys now match the snapshot that is actually written.
--
--   2. The three Task 2 acknowledgment fields were never restored. They are
--      part of the AI state, so they are restored with everything else, and a
--      legacy snapshot that predates them is refused outright rather than
--      restored partially.
--
--   3. Restore never changes the selected source documents, so restoring is
--      only exact while the current selection is still the one the run
--      analyzed. A changed source set now refuses instead of producing a draft
--      that no combination of documents ever produced.
--
-- Unchanged: ownership and editability checks, guest active/unexpired checks,
-- the active-run refusal, the current-last-successful-run rule, optimistic
-- locking, response-loss idempotency, the `restored_at` stamp, and the fact
-- that run history, quota and source associations are left completely alone.

create or replace function public.arc_restore_pre_ai_run(
  p_run_id uuid,
  p_owner_user_id uuid,
  p_guest_token_hash text,
  p_expected_lock_version integer
) returns table(lock_version integer, idempotent boolean)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_run public.ai_runs;
  v_status public.arc_revision_status;
  v_lock integer;
  v_schema text;
  v_last uuid;
  v_prior jsonb;
  v_current_sources text;
begin
  select * into v_run from public.ai_runs where id = p_run_id;
  if v_run.id is null then
    raise exception 'ARC: unknown AI run' using errcode = '42501';
  end if;

  if v_run.revision_id is not null then
    select r.status, r.lock_version, r.schema_version into v_status, v_lock, v_schema
      from public.analysis_revisions r
      join public.analyses a on a.id = r.analysis_id
      join public.contracts ct on ct.id = a.contract_id
      join public.customers c on c.id = ct.customer_id
     where r.id = v_run.revision_id
       and c.owner_user_id = p_owner_user_id
     for update of r;
    if v_status is null then
      raise exception 'ARC: that analysis was not found for this caller' using errcode = '42501';
    end if;
    if v_status <> 'draft' then
      raise exception 'ARC: a finalized revision cannot be restored' using errcode = '42501';
    end if;
  else
    select g.lock_version, g.schema_version into v_lock, v_schema
      from public.guest_workspaces g
     where g.id = v_run.guest_workspace_id
       and g.token_hash = p_guest_token_hash
       and g.status = 'active'
       and g.expires_at > now()
     for update;
    if v_lock is null then
      raise exception 'ARC: that temporary workspace is no longer available' using errcode = '42501';
    end if;
  end if;

  select * into v_run from public.ai_runs where id = p_run_id for update;

  if v_run.stage <> 'succeeded' then
    raise exception 'ARC: only a successful AI run can be undone' using errcode = '42501';
  end if;

  -- No other run may be mid-flight underneath a restore.
  if exists (
    select 1 from public.ai_runs r
     where r.id <> p_run_id
       and ((v_run.revision_id is not null and r.revision_id = v_run.revision_id)
         or (v_run.guest_workspace_id is not null and r.guest_workspace_id = v_run.guest_workspace_id))
       and r.stage in ('created', 'extracting', 'preflight_ready', 'analyzing', 'validating', 'applying')
  ) then
    raise exception 'ARC: an AI analysis is still running for this analysis' using errcode = '42501';
  end if;

  select s.last_successful_run_id into v_last
    from public.ai_analysis_state s
   where (v_run.revision_id is not null and s.revision_id = v_run.revision_id)
      or (v_run.guest_workspace_id is not null and s.guest_workspace_id = v_run.guest_workspace_id);

  -- Response-loss retry: the restore already committed. This stays FIRST, so a
  -- lost response is still idempotent even if the world moved on afterwards.
  if v_run.restored_at is not null and v_last is distinct from p_run_id then
    lock_version := v_lock;
    idempotent := true;
    return next;
    return;
  end if;

  -- v1 restores only the CURRENT last successful run, never an older one.
  if v_last is distinct from p_run_id then
    raise exception 'ARC: only the most recent successful AI analysis can be undone'
      using errcode = '42501';
  end if;
  if v_lock <> p_expected_lock_version then
    raise exception 'ARC: the analysis changed since it was loaded' using errcode = '40001';
  end if;

  -- Restore does not touch the selected documents, so the selection must still
  -- be the one this run analyzed for the restored state to be exact.
  v_current_sources := public.arc_ai_source_set_fingerprint(
    v_run.revision_id, v_run.guest_workspace_id);
  if v_current_sources is distinct from v_run.source_set_fingerprint then
    raise exception 'ARC: the selected source documents changed since that AI analysis'
      using errcode = '42501';
  end if;

  -- The canonical draft goes back to the exact pre-run snapshot (unchanged
  -- from the original routine), under the same optimistic lock.
  if v_run.revision_id is not null then
    update public.analysis_revisions r
       set canonical_inputs = v_run.pre_run_canonical_inputs,
           lock_version = r.lock_version + 1
     where r.id = v_run.revision_id
       and r.lock_version = p_expected_lock_version;
  else
    update public.guest_workspaces g
       set draft_json = v_run.pre_run_canonical_inputs,
           lock_version = g.lock_version + 1
     where g.id = v_run.guest_workspace_id
       and g.lock_version = p_expected_lock_version;
  end if;

  v_prior := v_run.pre_run_ai_state;

  -- A legacy snapshot cannot be restored exactly, so it is not restored at all.
  if v_prior is not null and v_prior <> 'null'::jsonb then
    if jsonb_typeof(v_prior) <> 'object'
       or not (v_prior ? 'acknowledged_source_fingerprint')
       or not (v_prior ? 'source_acknowledged_at')
       or not (v_prior ? 'source_acknowledged_by') then
      raise exception 'ARC: that AI analysis cannot be restored exactly' using errcode = '42501';
    end if;
  end if;

  if v_prior is null or v_prior = 'null'::jsonb then
    -- Exactly the recorded prior state: there was no AI sidecar at all.
    delete from public.ai_analysis_state s
     where (v_run.revision_id is not null and s.revision_id = v_run.revision_id)
        or (v_run.guest_workspace_id is not null and s.guest_workspace_id = v_run.guest_workspace_id);
  else
    update public.ai_analysis_state s
       set last_successful_run_id = nullif(v_prior ->> 'last_successful_run_id', '')::uuid,
           source_set_fingerprint = nullif(v_prior ->> 'source_set_fingerprint', ''),
           source_state = coalesce(v_prior ->> 'source_state', 'none'),
           field_provenance = coalesce(v_prior -> 'field_provenance', '{}'::jsonb),
           object_provenance = coalesce(v_prior -> 'object_provenance', '{}'::jsonb),
           tombstones = coalesce(v_prior -> 'tombstones', '[]'::jsonb),
           review_items = coalesce(v_prior -> 'review_items', '[]'::jsonb),
           acknowledged_source_fingerprint =
             nullif(v_prior ->> 'acknowledged_source_fingerprint', ''),
           source_acknowledged_at =
             nullif(v_prior ->> 'source_acknowledged_at', '')::timestamptz,
           source_acknowledged_by =
             nullif(v_prior ->> 'source_acknowledged_by', '')::uuid,
           lock_version = s.lock_version + 1
     where (v_run.revision_id is not null and s.revision_id = v_run.revision_id)
        or (v_run.guest_workspace_id is not null and s.guest_workspace_id = v_run.guest_workspace_id);
    if not found then
      insert into public.ai_analysis_state (
        revision_id, guest_workspace_id, last_successful_run_id, source_set_fingerprint,
        source_state, field_provenance, object_provenance, tombstones, review_items,
        acknowledged_source_fingerprint, source_acknowledged_at, source_acknowledged_by)
      values (
        v_run.revision_id, v_run.guest_workspace_id,
        nullif(v_prior ->> 'last_successful_run_id', '')::uuid,
        nullif(v_prior ->> 'source_set_fingerprint', ''),
        coalesce(v_prior ->> 'source_state', 'none'),
        coalesce(v_prior -> 'field_provenance', '{}'::jsonb),
        coalesce(v_prior -> 'object_provenance', '{}'::jsonb),
        coalesce(v_prior -> 'tombstones', '[]'::jsonb),
        coalesce(v_prior -> 'review_items', '[]'::jsonb),
        nullif(v_prior ->> 'acknowledged_source_fingerprint', ''),
        nullif(v_prior ->> 'source_acknowledged_at', '')::timestamptz,
        nullif(v_prior ->> 'source_acknowledged_by', '')::uuid);
    end if;
  end if;

  -- Run history, quota and the selected source documents are untouched.
  update public.ai_runs set restored_at = now() where id = p_run_id;

  lock_version := p_expected_lock_version + 1;
  idempotent := false;
  return next;
end;
$$;

-- Unchanged authority, re-stated so this file is self-contained and idempotent.
revoke all on function public.arc_restore_pre_ai_run(uuid, uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.arc_restore_pre_ai_run(uuid, uuid, text, integer)
  to service_role;
