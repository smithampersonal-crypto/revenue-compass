-- ARC Post-R2 contention driver — assertions while a competing session holds
-- the owner row.
--
-- Proves the staged replacement of arc_save_draft_with_ai_reconciliation fails
-- in bounded time with SQLSTATE 55P03 instead of blocking until the connection
-- pool is exhausted, and that the timed-out save writes NOTHING.

\set ON_ERROR_STOP on

-- Far above the routine's own 3s bound: if the routine ever went back to
-- waiting forever, this session fails with 57014 and assertion 07 fails.
set statement_timeout = '20s';

do $$
declare
  v_hash text := repeat('b', 64);
  v_guest uuid;
  v_started timestamptz;
  v_elapsed numeric;
  v_code text;
  v_draft text;
  v_lock integer;
  v_state jsonb;
  v_state_lock integer;
  v_events bigint;
begin
  select g.id into strict v_guest from public.guest_workspaces g where g.token_hash = v_hash;

  -- The competing session really does hold the owner row.
  if not (select xmax <> 0 from public.guest_workspaces g where g.id = v_guest) then
    raise exception 'ARC SQL suite failed: no competing transaction holds the owner row';
  end if;

  v_started := clock_timestamp();
  begin
    perform s.lock_version
      from public.arc_save_draft_with_ai_reconciliation(
        null, v_hash, null, v_guest, 1, '{"transactionPriceInput":"140000"}'::jsonb,
        'arc.workflow.v1',
        jsonb_build_object('reviewItems', '[]'::jsonb), '[]'::jsonb, null) s;
    v_code := 'none';
  exception when others then
    v_code := sqlstate;
  end;
  v_elapsed := extract(epoch from clock_timestamp() - v_started);

  if v_code <> '55P03' then
    raise exception 'ARC SQL suite failed: 07 a contended save must fail with 55P03, got %', v_code;
  end if;
  if v_elapsed >= 10 then
    raise exception 'ARC SQL suite failed: 08 the contended save was not bounded (% s)', v_elapsed;
  end if;

  select g.draft_json ->> 'transactionPriceInput', g.lock_version into v_draft, v_lock
    from public.guest_workspaces g where g.id = v_guest;
  if v_draft is distinct from '120000' then
    raise exception 'ARC SQL suite failed: 09 the timed-out save changed the canonical draft';
  end if;
  if v_lock <> 1 then
    raise exception 'ARC SQL suite failed: 10 the timed-out save advanced the owner lock';
  end if;

  select s.review_items, s.lock_version into v_state, v_state_lock
    from public.ai_analysis_state s where s.guest_workspace_id = v_guest;
  if v_state <> '[]'::jsonb or v_state_lock <> 1 then
    raise exception 'ARC SQL suite failed: 11 the timed-out save changed the AI sidecar';
  end if;

  select count(*) into v_events
    from public.ai_review_events e where e.guest_workspace_id = v_guest;
  if v_events <> 0 then
    raise exception 'ARC SQL suite failed: 12 the timed-out save appended a review event';
  end if;
end $$;
