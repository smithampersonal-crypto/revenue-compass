# Package 3D-T — New Analysis & Recent Analyses (revised PLAN ONLY)

No accounting, billing, AI model/prompt/schema, quota amounts, or Safe Re-analysis changes. No publish, AI run or production data change until this plan is approved. Owner decisions D1–D5 are recorded in section 19.

## 1. How it works today (checked in code)

- **Bare `/analysis`:** `AnalysisLayout` sets `guest = !sample && !contract`. This calls `resumeOrCreateGuestHandler`, which hashes the HttpOnly `__Host-arc_guest` cookie and resumes that one `guest_workspaces` row, or creates one. Signed-in users take the same path for unsaved work.
- **New Analysis** in the header links to bare `/analysis`, so it resumes that same row.
- **`guest_workspaces`** has `token_hash` (globally UNIQUE), `draft_json`, `lock_version`, `status` (active/migrating/migrated/expired) and `expires_at` (created + 9 h). The hourly maintenance job expires and deletes rows.
- **Linked records** use `guest_workspace_id`: source-document selections, source documents, upload intents, AI runs, AI state and review events. About 15 trusted functions authorise with `p_guest_token_hash` + the workspace id.
- **My Contracts** (`/workspace`) reads the customer → contract → analysis → revision rows the user owns, under RLS.
- **Samples** use the in-memory `sample` mode and are never saved.
- **Guest AI allowance:** `arc_reserve_ai_allowance` counts `ai_runs where guest_workspace_id = X and quota_scope='guest' and openai_started_at is not null`. Signed-in runs use `ai_monthly_usage`.
- **Save to My Contracts** (`arc_migrate_guest_workspace_v3`, called via `_by_token_v3`) runs as one transaction. It creates the customer, contract, analysis and revision 1, then moves the workspace's records to the new revision:
  - documents: `source_documents.guest_workspace_id = null`, and selections become `revision_source_documents`;
  - **AI runs:** `revision_id = new`, `guest_workspace_id = null`. `quota_scope` and `guest_token_hash` are kept;
  - AI state and review events: moved to the revision the same way;
  - the workspace row is marked `migrated`.

## 2. Root cause

The system assumes one cookie = one workspace row = one draft. Because New Analysis goes to bare `/analysis`, it can only resume that row.

## 3. Identity model

```text
Browser session (guest_sessions, cookie, 9 h) ── guest AI bucket: 3 runs
   ├── temporary analysis A = guest_workspaces row (own credential, draft, docs, AI, reviews, lock)
   └── temporary analysis B
Signed-in user ── 10 runs/month (unchanged) ── saved contracts (unchanged tables)
```

Recent Analyses belongs to this browser only, for guests and signed-in users alike (D3). It does not sync across browsers or devices.

## 4. Credentials and schema (Option A, D1)

- **Session credential:** a new random token in the cookie. `guest_sessions.token_hash = sha256(sessionToken)`.
- **Per-analysis credential:** `derived = HMAC-SHA256(key = sessionToken, msg = analysisId)`, base64url. `guest_workspaces.token_hash = sha256(derived)`. Each value is unique per (session, analysis), so **`token_hash` stays globally UNIQUE** (correction 1). The server computes the derived token for each request. It is never stored, sent to the browser or logged.
- Every existing trusted function still receives a per-analysis `p_guest_token_hash` and so stays unchanged, apart from the quota function (section 11).

**Exact schema changes, in one migration:**

```text
guest_sessions
  id uuid pk default gen_random_uuid()
  token_hash text not null unique
  expires_at timestamptz not null
  created_at, updated_at timestamptz not null default now()  (+ arc_set_updated_at trigger)
  -- no user_id (D3)
  grants: service_role only; RLS enabled, no policies (same pattern as guest_workspaces)

guest_workspaces
  + session_id uuid null references guest_sessions(id) on delete cascade
  + credential_kind text not null default 'legacy'  -- 'legacy' | 'derived'
  + origin text not null default 'blank'            -- 'blank' | 'upload' | 'sample:<key>'
  index (session_id, status, updated_at desc)

ai_runs
  + guest_session_id uuid null references guest_sessions(id) on delete set null
  index (guest_session_id) where quota_scope = 'guest'
```

## 5. Guest lifecycle

- **Create:** New Analysis chooser → a server function looks up or creates the session. It inserts a workspace row with `session_id` set, the session's `expires_at`, the derived credential and `origin`, then returns the id. The browser goes to `/analysis?a=<id>`.
- **Resume:** `?a=<id>` loads the row only if `session_id` equals the cookie session's id, the row's `token_hash` matches the derived credential, and the row is active and not expired. Otherwise it shows "This analysis is no longer available", with links to Recent Analyses and New Analysis. It never falls back to another row.
- **Expiry:** 9 h from session creation. Starting a new analysis never extends it (D2 applies the same rule to signed-in unsaved work).
- **Multi-tab:** each tab autosaves its own row with its own lock version, so there is no shared lock across analyses.

## 6. Signed-in lifecycle

Signed-in users use the same browser session. Recent Analyses shows this browser's rows. Save to My Contracts promotes exactly one row (section 11). AI runs started while signed in keep using the existing signed-in 10/month bucket.

## 7. Signing in

The cookie survives sign-in, so temporary analyses stay in Recent Analyses. Nothing is attached to the account (D3), and nothing is saved automatically.

## 8. Existing workspaces after release (correction 2)

1. **Migration:** for each active, unmigrated workspace with no session, create a `guest_sessions` row with `token_hash = <the workspace's existing token_hash>` and the same `expires_at`. Link the workspace to it and leave `credential_kind = 'legacy'`. Nothing is deleted, and no row's credential changes.
2. **Before upgrade:** a request whose cookie hashes to a session that has a `legacy` row accepts that row with its original credential, so access is never lost.
3. **Upgrade on the first real request:** a trusted function `arc_upgrade_legacy_guest_workspace(p_session_hash, p_workspace_id, p_new_token_hash)` runs `select … for update`. It checks that the row is legacy, belongs to the session and has `token_hash = p_session_hash`. It then sets `token_hash = sha256(HMAC(cookie, id))` and `credential_kind = 'derived'`. If a repeat request finds the row already derived, it does nothing and returns the same row, so no second session or workspace is created. The cookie value itself stays the same: it becomes the session credential.
4. From then on, the row is resumed only by its exact `?a=<id>`.

## 9. Routing audit (correction 4)

Links that go to bare `/analysis`, with their new behaviour:

| Entry point | Today | After 3D-T |
|---|---|---|
| Header "New Analysis" (`AppHeader`) | resumes current row | `/analysis/new` chooser |
| Bare `/analysis` URL | resume/create | redirect to `/analysis/new` |
| Home "Try the Sample" (`?sample=horizon`) | read-only sample | **unchanged** (D4) |
| Home "Upload PDF" (`?upload=1`) | current row → documents upload | creates a new analysis (`origin=upload`) → `/analysis/documents?a=<id>&upload=1` |
| Home "Start Manually" | resumes current row | creates a new blank analysis → `/analysis?a=<id>` |
| Sitemap "ASC 606 Analysis" | resumes | `/analysis/new` |
| Sitemap sample link | read-only sample | unchanged |
| Auth page "Continue without signing in" | resumes | `/recent` |
| My Contracts "Upload PDF" (`?upload=1&customer=`) | current row → upload | new analysis → documents upload, keeping the `customer` hint |
| My Contracts "Open analysis workspace" | resumes | `/recent` |
| My Contracts contract/revision links (`?contract=`) | saved contract | unchanged |
| `AnalysisNavigation`, `analysis/index` review cleanup, `review.tsx`, `CreateRevisionAction`, `AmendmentDraftActions` | keep current search params | unchanged; they carry `a` because they spread the current search |
| `GuestSavePanel` after save | navigates to the saved contract | unchanged; the save panel also refreshes Recent |

- The chooser's **Analyze a Contract** creates a new analysis (`origin=upload`) and opens its upload step.
- The chooser's **Try a Sample Contract** creates a new analysis seeded from the canonical Horizon sample (`origin=sample:horizon`).
- **Resume** always uses `?a=<id>`. The id is a row UUID: it is useless without the session cookie and is not the credential.
- The 3D-R view-state key gains `a`, so view state never carries from one analysis to another.

## 10. Recent Analyses (`/recent`)

A list with newest first. Each row shows:
- label: the Step 1 customer name, otherwise "Untitled analysis";
- source: the first selected document's name, or "Sample — Horizon";
- status;
- updated time;
- expiry time.

Actions: **Resume Analysis**, plus **Save to My Contracts** when signed in.

Status comes from existing fields only:
- an `ai_runs` row that is not yet completed or failed → "Analysis in progress";
- `ai_analysis_state.review_items` with unresolved blocking items → "Review needed";
- no selected source and no successful run → "Not analyzed";
- otherwise → "Draft".

Empty state: "No recent analyses yet." plus a New Analysis button. There is no cap on how many can be listed (D5).

## 11. Saving, and keeping guest AI history (correction 3)

**Problem found:** the save transaction sets `ai_runs.guest_workspace_id = null`. Today's quota count uses that column, so after a save:
- Today: the cookie is cleared, so no one can reuse the bucket.
- With sessions: if the other rows keep the cookie alive, a count based on the workspace would drop A's runs. The session would then appear to have runs back.

**Smallest safe correction:** the new `ai_runs.guest_session_id`, set by `arc_create_ai_run` from the workspace's session and **never cleared by the save transaction** (that transaction is not changed). `arc_reserve_ai_allowance` counts guest runs as follows (the limit stays 3):
- `guest_session_id = <session>` for new runs;
- the same workspace test as today for legacy runs with no session id.

The migration backfills `guest_session_id` for existing runs whose workspace is linked to a session.

**Save flow:**
- The existing transaction runs unchanged on that one row. It moves the row's AI runs, state, review events and documents to the new revision, creating a new durable identity.
- It does not re-run AI and does not use any allowance.
- The row becomes `migrated` and leaves Recent Analyses.
- The session cookie is cleared only if no other active rows remain.

## 12. Security

- `guest_sessions` is service-role only. No RLS rule is relaxed, and storage paths are unchanged.
- The list function filters by the cookie session only.
- The HMAC key never leaves the server request.

## 13. Samples

- The chooser's sample path copies the frozen sample definition into a new temporary row. Sample accounting is unchanged.
- The Home sample preview is unchanged (D4).

## 14. Files

- **Migration** (section 4 schema), plus:
  - `arc_upgrade_legacy_guest_workspace`;
  - `arc_create_ai_run` sets `guest_session_id`;
  - the `arc_reserve_ai_allowance` count change;
  - `arc_delete_expired_guest_workspaces` / `arc_expire_guest_workspaces` also expire and delete sessions;
  - the legacy backfill.
- `persistence/guest.ts`: session cookie and derived-credential helpers.
- `guest.handlers.ts`, `guest.store.server.ts` and `guest.functions.ts`: create, resume by id, list, upgrade, and partial cookie clearing.
- The `ai/*` and `documents/*` server functions that read the guest cookie: resolve the per-analysis hash from `?a` instead of the cookie hash (the functions they call keep the same parameters).
- `routes/analysis/route.tsx` (`a` param, identity key, bare redirect).
- New routes: `routes/analysis/new.tsx` and `routes/recent.tsx`.
- `index.tsx`, `sitemap.tsx`, `auth/index.tsx` and `_authenticated/workspace.tsx`: entry points per section 9.
- `AppHeader.tsx` and `AccountMenu.tsx`: headers (guest: New Analysis · Recent Analyses · Sign in; signed in: New Analysis · Recent Analyses · My Contracts · Account).
- `analysis-context.tsx`: resume by id, and the missing-item state.
- `GuestSavePanel.tsx`: after a save, refresh Recent.
- `supabase/tests/phase3dt_sessions.sql`, plus unit and screen tests.

## 15. Tests

The brief's G1–G7, A1–A6, S1–S3, I1–I6, N1–N5 and Q1–Q3, plus:

- **Legacy upgrade:**
  - a legacy cookie still resumes its row before the upgrade;
  - the upgrade is atomic;
  - an exact `?a` resume works afterwards;
  - repeated or simultaneous first requests create no duplicate session or workspace.
- **Uniqueness:** derived hashes for (S, A), (S, B) and (S', A) differ, and the global UNIQUE constraint still holds.
- **Quota history:**
  - session with A and B; 2 of 3 guest runs used across them;
  - sign in and save A: no run is used, and B stays temporary;
  - the session count still reads 2 used;
  - no fresh bucket comes from saving, New Analysis, another analysis or the legacy upgrade.
- **Isolation:** a `?a` from another session is refused; an expired session refuses every row; two tabs autosave A and B without conflict.
- **Entry points:** every row of the section 9 table.

## 16. Verification

- Focused unit, routing and SQL suites.
- Full `bun run verify`, then both GitHub jobs green.
- Frozen state: `.env` has the two public values, `^2.15.0`, lock at 2.15.0 Europe West 4, Genomix SHA unchanged.

## 17. Live acceptance

The guest and signed-in flows from brief section 33, after publish approval. The guest-to-sign-in case: the temporary analyses stay in Recent on the same browser, and only the analysis explicitly saved moves to My Contracts.

## 18. Risks

- The quota function change alters how runs are counted, not the limits. Any accidental increase in remaining runs is a stop condition, covered by the tests in section 15.
- About 15 server functions switch from the cookie hash to the derived hash. Each one gets a boundary test.

## 19. Owner decisions (recorded)

- **D1:** Option A approved.
- **D2:** 9-hour retention for signed-in unsaved work.
- **D3:** no `user_id` binding; Recent Analyses is per browser.
- **D4:** Home sample preview unchanged.
- **D5:** no cap on the number of analyses.
