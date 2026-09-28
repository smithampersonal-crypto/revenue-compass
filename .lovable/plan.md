# 3D-T narrow allowance-refund patch — PLAN ONLY

Goal: the visible "3 per 9 hours" / "10 per month" allowance counts only analyses ARC validated and applied. Validation, limits, model, prompt, schema, citation checks, accounting, billing and Safe Re-analysis are unchanged. Failed run rows are kept as they are.

## 1. Trace of current behaviour

**Guest allowance.** `arc_reserve_ai_allowance` (latest migration 20260928190250) locks the session (or the workspace, for legacy runs). It counts usage with `arc_guest_session_usage`, which counts every guest run in the session with `openai_started_at IS NOT NULL`, plus legacy runs matched exactly by `guest_token_hash`. If usage is below 3, it moves the run to `analyzing` and stamps `openai_started_at`. The UI reads the same count through `arc_guest_workspace_usage` (runs.store.server.ts `guestConsumed`). Result: any run that reached the provider counts, whatever its outcome.

**Authenticated monthly usage.** The same function upserts `ai_monthly_usage (user_id, usage_month)` and runs `runs_consumed = runs_consumed + 1` when it reserves, before the provider call. It never decrements. The UI reads `runs_consumed` directly (`monthlyUsage`).

**Stages** (`AiRunStage`):
- Active: `created`, `extracting`, `preflight_ready`, `analyzing`, `validating`, `applying`.
- Terminal: `succeeded`, `preflight_failed`, `api_failed`, `response_invalid`, `application_failed`.

**Failure categories** (orchestrator `AiFailureCategory`):
- `preflight`: the provider never started.
- `api`: authentication or configuration, model access, request validation, token limit, api_failure. The provider started but returned nothing usable.
- `response`: output parse failure, `response_invalid`, `citation_anchor_failure`, `citation_validation_failure`. Set at stage `validating`.
- `application`: apply declined, apply conflict or apply error. Set at stage `applying`, and nothing is applied.

All failures go through `arc_mark_ai_run_failure`, which only moves a run from an active stage to a terminal stage, so each run can fail once.

**The point a result counts as delivered.** `arc_apply_ai_run` needs stage `applying` and, in one transaction, writes the draft and review state and sets `stage = 'succeeded'`. It is the only path to `succeeded`. `arc_restore_pre_ai_run` sets `restored_at` but leaves the stage at `succeeded`.

**Provider attempt vs delivered analysis.**
- Provider attempt: `openai_started_at IS NOT NULL`. This stays as it is now.
- Delivered analysis: `stage = 'succeeded'`.
- A run still in progress holds a provisional reservation: its provider has started and its stage is active.

## 2. Design (database only, one migration, no new columns or tables)

**Visible allowance = succeeded runs + runs in progress.** Counting runs in progress keeps the current locking: two runs at once can never both pass the limit. When a run in progress fails, it stops counting automatically. A success stays counted even after the user restores the earlier version.

1. **`arc_guest_session_usage` / `arc_guest_workspace_usage`**
   - Change the filter from `openai_started_at IS NOT NULL` to `openai_started_at IS NOT NULL AND stage IN ('succeeded', <active stages>)`.
   - Legacy matching by exact credential, the fallback for workspaces without a session, and the service_role-only access all stay the same.
   - The reserve check and the UI still share this one definition.
2. **Monthly allowance: release on failure.** `arc_mark_ai_run_failure` gains one step, inside the same transaction: if the run's `quota_scope = 'authenticated'` and its provider has started, it runs `runs_consumed = greatest(runs_consumed - 1, 0)` for the run's UTC month. That month comes from the reserve step's `openai_started_at`, so a run that crosses midnight at month end still refunds the right month.
   - The refund can only happen once, because the active-to-terminal move can only happen once. Runs that failed at preflight never reserved, so there is nothing to refund.
3. **Separate technical-attempt safeguard (fail closed).** `arc_reserve_ai_allowance` also counts all provider attempts, whatever their outcome, under the same lock:
   - Guest: at most **6** provider attempts per browser session (a 9-hour window).
   - Signed in: at most **25** provider attempts per UTC month, counted from `ai_runs.owner_user_id` and `openai_started_at`.
   - When the cap is reached, the reservation is refused with a distinct code, `attempt_limit`. The run ends `preflight_failed` and the provider is not called.
   - The UI shows a separate message: "Too many unsuccessful AI attempts in this session. Try again later." It never says "0 analyses remaining", and the visible allowance numbers don't change.
   - The two caps are constants in SQL and are not configurable. **Owner to confirm 6 / 25.**
4. **App code (small).**
   - Map the new reservation code `attempt_limit` to its own safe message in failure-presentation.
   - No change to the orchestrator flow, validation, the Terra client, prompt, schema or accounting.
   - `guestConsumed` and `monthlyUsage` keep calling the same database sources, so the TypeScript never works out the count itself.

**Not touched.** Limits 3 / 10, the 9-hour expiry, sessions and credentials, Save/migration (it moves runs across but doesn't change their stage, so the count is unchanged), New Analysis, manual edits, access rules, the storage bucket, and `ai_runs` rows. Failed rows keep `openai_started_at`, `failure_*`, `usage_metadata` and the other metadata.

**Existing live data.** The Test 03 `response_invalid` run stops counting as soon as the new functions apply. The session's usage goes from 2 to 1, so it shows 2 remaining. Past authenticated failures are not refunded retroactively, because we don't rewrite history. **Owner to confirm** that this is acceptable. The alternative is a one-time recount of `ai_monthly_usage` from succeeded runs for the current month.

## 3. Tests

**SQL suite `supabase/tests/phase3dt_allowance_refund.sql`** (real local DB, synthetic data, rolled back, every row `passed = true`). It drives runs through the real RPCs: reserve, then advance, then `arc_apply_ai_run` or `arc_mark_ai_run_failure`.
- Live case: a new session has 3 remaining. A succeeds, leaving 2. B's provider starts, then B ends `response_invalid` with `citation_anchor_failure`, still 2. B is retried and succeeds, leaving 1.
- The failed B row still exists with its `openai_started_at`, `failure_code` and stage kept.
- Two analyses in the same session report the same usage at every step.
- Saving A to My Contracts leaves usage unchanged.
- A successful run that is later restored still counts.
- `api_failed` and `application_failed` don't count. `preflight_failed` never reserved.
- Signed in: success adds 1 to `runs_consumed`. A `response_invalid` run adds 1 while in progress and removes it on failure. Marking the same run failed twice is refused, so there is no double refund. The refund goes to the month the reservation was made in.
- Concurrency: a run in progress counts. With 2 used and 1 in progress, a fourth reservation is refused. Once the in-progress run fails, a new reservation is allowed.
- Attempt safeguard: after 6 guest provider failures, the next reservation is refused with `attempt_limit` while the visible allowance still reads 3 remaining. The signed-in cap of 25 per month works the same way.
- Security: the helpers can still only be called by service_role.
- Update `phase3dt_sessions.sql` assertions only where they assumed failed runs count (for example, test 15 must use succeeded runs). All other existing suites must still pass.

**App tests (vitest).**
- workspace-handlers: a `response_invalid` run leaves remaining unchanged for both analyses in the session.
- runs-handlers and failure-presentation: `attempt_limit` shows its own message and never the "no analyses remaining" wording.
- Then the full `bun run verify`, plus both GitHub jobs run by the owner.

## 4. Delivery rules

- One migration: replace the 3 usage/reserve functions and `arc_mark_ai_run_failure`. No new columns or tables, and no changes to access rules.
- Afterwards, restore the frozen `.env`, `package.json` and `bun.lock`, and confirm the Genomix hash is unchanged.
- No publish and no AI run.

## Decisions needed

1. Attempt safeguard caps: guest 6 per session, signed in 25 per month?
2. No retroactive refund of past signed-in failures (recommended), or a one-time recount for the current month?
