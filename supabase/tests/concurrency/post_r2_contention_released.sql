-- ARC Post-R2 contention driver — assertions after the competing session has
-- released the owner row and exited.
--
-- The very same save must now succeed exactly once, and a stale expected lock
-- must still be ARC's own non-retryable conflict (PT409), not contention and
-- not an ARC-authored 40001.

\set ON_ERROR_STOP on

set statement_timeout = '20s';

do $$
declare
  v_hash text := repeat('b', 64);
  v_guest uuid;
  v_lock integer;
  v_code text;
begin
  select g.id into strict v_guest from public.guest_workspaces g where g.token_hash = v_hash;

  select s.lock_version into v_lock
    from public.arc_save_draft_with_ai_reconciliation(
      null, v_hash, null, v_guest, 1, '{"transactionPriceInput":"140000"}'::jsonb,
      'arc.workflow.v1',
      jsonb_build_object('reviewItems', '[]'::jsonb),
      jsonb_build_array(jsonb_build_object(
        'type', 'yellow_affirmed', 'reviewItemId', 'item-1',
        'targetKey', 'transactionPrice.input', 'section', 'step_3',
        'reviewFingerprint', 'fp-1')), null) s;

  if v_lock <> 2 then
    raise exception 'ARC SQL suite failed: 13 the save did not succeed once the lock was released';
  end if;

  if not exists (select 1 from public.guest_workspaces g
                  where g.id = v_guest and g.lock_version = 2
                    and g.draft_json ->> 'transactionPriceInput' = '140000') then
    raise exception 'ARC SQL suite failed: 14 the owner lock did not advance exactly once';
  end if;

  if (select count(*) from public.ai_review_events e where e.guest_workspace_id = v_guest) <> 1 then
    raise exception 'ARC SQL suite failed: 15 the reconciliation did not append exactly one audit event';
  end if;

  begin
    perform s.lock_version
      from public.arc_save_draft_with_ai_reconciliation(
        null, v_hash, null, v_guest, 1, '{"transactionPriceInput":"150000"}'::jsonb,
        'arc.workflow.v1',
        jsonb_build_object('reviewItems', '[]'::jsonb), '[]'::jsonb, null) s;
    v_code := 'none';
  exception when others then
    v_code := sqlstate;
  end;

  if v_code <> 'PT409' then
    raise exception 'ARC SQL suite failed: 16 a stale expected lock must raise PT409, got %', v_code;
  end if;

  if not exists (select 1 from public.guest_workspaces g
                  where g.id = v_guest and g.lock_version = 2
                    and g.draft_json ->> 'transactionPriceInput' = '140000') then
    raise exception 'ARC SQL suite failed: 17 the rejected stale save changed something';
  end if;
end $$;
