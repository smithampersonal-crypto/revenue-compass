-- ARC Post-R2 live regression patch — autosave lock bounding.
--
-- Defect 4 (Genomix Test 02): a guest autosave failed with "The autosave store
-- is unavailable". Root cause: public.arc_save_draft_with_ai_reconciliation
-- takes the owner row FOR UPDATE with no lock_timeout, and its session has no
-- idle_in_transaction_session_timeout. When a client abandons an in-flight
-- autosave (debounce overlap, navigation, tab close) the backend can keep
-- holding that row lock before PostgreSQL notices the disconnect; every later
-- autosave then blocks indefinitely on the lock while holding a pooled
-- connection, and PostgREST returns
-- PGRST003 "Timed out acquiring connection from connection pool".
--
-- This migration replaces ONLY that routine, with the accepted Phase 9G Task 4
-- body, adding two statements immediately after begin and before any
-- validation or lock acquisition. Signature, return shape, SECURITY DEFINER,
-- search_path, ownership validation, scope locking, actor derivation, lock
-- ordering, optimistic-lock behaviour, canonical write, sidecar write, review
-- event append semantics and privileges are unchanged. No table, schema, RLS,
-- grant, trigger or data change is made. The frozen Phase 9G Task 9 migration
-- is untouched.
--
-- A contended save now fails in bounded time with SQLSTATE 55P03, writing
-- nothing at all; the application treats 55P03 as contention (not a stale
-- lock), retries once, and otherwise surfaces a retryable save state.

create or replace function public.arc_save_draft_with_ai_reconciliation(
  p_owner_user_id uuid,
  p_guest_token_hash text,
  p_revision_id uuid,
  p_guest_workspace_id uuid,
  p_expected_lock_version integer,
  p_canonical_inputs jsonb,
  p_schema_version text,
  p_ai_state jsonb,
  p_review_events jsonb default '[]'::jsonb,
  p_actor_user_id uuid default null
) returns table(lock_version integer, saved_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_lock integer;
  v_actor uuid;
  v_run uuid;
  v_saved timestamptz;
  v_event jsonb;
begin
  -- Post-R2 live regression patch. Bound the time this routine may spend
  -- waiting on the owner row, and the time an abandoned in-flight autosave may
  -- keep that row locked. Without these bounds a client that disappears
  -- mid-save leaves the row locked, every later save blocks on it while
  -- holding a pooled connection, and the pool is exhausted (PGRST003) instead
  -- of one save failing cleanly. Nothing else about the routine changes.
  set local lock_timeout = '3s';
  set local idle_in_transaction_session_timeout = '15s';

  if p_expected_lock_version is null or p_canonical_inputs is null
     or p_ai_state is null or coalesce(btrim(p_schema_version), '') = '' then
    raise exception 'ARC: an autosave requires a lock version and canonical state'
      using errcode = '22023';
  end if;

  -- Ownership, draft status, guest credential and expiry, plus the owner-row
  -- lock, in the accepted Task 2 order.
  v_lock := public.arc_lock_ai_review_scope(p_owner_user_id, p_guest_token_hash,
                                            p_revision_id, p_guest_workspace_id);
  v_actor := public.arc_ai_review_actor(p_owner_user_id, p_actor_user_id, p_revision_id);

  if v_lock <> p_expected_lock_version then
    raise exception 'ARC: the analysis changed since it was loaded' using errcode = '40001';
  end if;

  if p_revision_id is not null then
    update public.analysis_revisions r
       set canonical_inputs = p_canonical_inputs,
           schema_version = p_schema_version,
           lock_version = r.lock_version + 1
     where r.id = p_revision_id
       and r.status = 'draft'
       and r.lock_version = p_expected_lock_version
    returning r.updated_at into v_saved;
  else
    update public.guest_workspaces g
       set draft_json = p_canonical_inputs,
           schema_version = p_schema_version,
           lock_version = g.lock_version + 1
     where g.id = p_guest_workspace_id
       and g.status = 'active'
       and g.lock_version = p_expected_lock_version
    returning g.updated_at into v_saved;
  end if;

  if v_saved is null then
    raise exception 'ARC: the analysis changed since it was loaded' using errcode = '40001';
  end if;

  -- Only the reconciliation fields move. A missing sidecar row means this
  -- analysis has never used AI, so there is nothing to reconcile.
  select s.last_successful_run_id into v_run
    from public.ai_analysis_state s
   where (p_revision_id is not null and s.revision_id = p_revision_id)
      or (p_guest_workspace_id is not null and s.guest_workspace_id = p_guest_workspace_id)
   for update;

  if found then
    update public.ai_analysis_state s
       set field_provenance = coalesce(p_ai_state -> 'fieldProvenance', s.field_provenance),
           object_provenance = coalesce(p_ai_state -> 'objectProvenance', s.object_provenance),
           tombstones = coalesce(p_ai_state -> 'tombstones', s.tombstones),
           review_items = coalesce(p_ai_state -> 'reviewItems', s.review_items),
           lock_version = s.lock_version + 1
     where (p_revision_id is not null and s.revision_id = p_revision_id)
        or (p_guest_workspace_id is not null and s.guest_workspace_id = p_guest_workspace_id);

    for v_event in select value from jsonb_array_elements(coalesce(p_review_events, '[]'::jsonb)) value
    loop
      if (v_event ->> 'type') = 'yellow_affirmed' then
        insert into public.ai_review_events (
          revision_id, guest_workspace_id, ai_run_id, actor_kind, actor_user_id, event_type,
          review_item_id, review_target_key, review_section, review_severity, review_fingerprint)
        values (
          p_revision_id, p_guest_workspace_id, v_run,
          case when v_actor is not null then 'authenticated' else 'guest' end,
          v_actor,
          'yellow_affirmed',
          v_event ->> 'reviewItemId', v_event ->> 'targetKey', v_event ->> 'section',
          'yellow', v_event ->> 'reviewFingerprint');
      elsif (v_event ->> 'type') = 'review_item_reopened' then
        insert into public.ai_review_events (
          revision_id, guest_workspace_id, ai_run_id, actor_kind, actor_user_id, event_type,
          review_item_id, review_target_key, review_section, review_severity, review_fingerprint)
        values (
          p_revision_id, p_guest_workspace_id, v_run, 'system', null,
          'review_item_reopened',
          v_event ->> 'reviewItemId', v_event ->> 'targetKey', v_event ->> 'section',
          coalesce(v_event ->> 'severity', 'yellow'), v_event ->> 'reviewFingerprint');
      else
        raise exception 'ARC: unknown reconciliation event' using errcode = '22023';
      end if;
    end loop;
  end if;

  lock_version := p_expected_lock_version + 1;
  saved_at := v_saved;
  return next;
end;
$$;

comment on function public.arc_save_draft_with_ai_reconciliation(
  uuid, text, uuid, uuid, integer, jsonb, text, jsonb, jsonb, uuid) is
  'Phase 9G Task 4: one autosave, one transaction, one lock advance. Writes the '
  'canonical draft, the reconciled AI provenance/tombstone/review state and the '
  'edit-driven audit events together. Source freshness, the acknowledged source '
  'fingerprint and the last successful run are never changed here.';

/* ----------------------------------------------------------- privileges */

revoke all on function public.arc_save_draft_with_ai_reconciliation(
  uuid, text, uuid, uuid, integer, jsonb, text, jsonb, jsonb, uuid)
  from public, anon, authenticated;

grant execute on function public.arc_save_draft_with_ai_reconciliation(
  uuid, text, uuid, uuid, integer, jsonb, text, jsonb, jsonb, uuid) to service_role;