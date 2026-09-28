# Package 3D-T — New Analysis & Recent Analyses (PLAN ONLY)

No accounting, billing, AI model/prompt/schema, quota amounts, or Safe Re-analysis changes. No publish, no AI run, no production data change. **This package needs a database migration**, so per the stop conditions it goes back to you for decisions (section 19) before any code.

## 1. How it works today (checked in code)

- **`/analysis` with no sample or contract:** `AnalysisLayout` passes `guest = !sample && !contract` to `AnalysisProvider`. That calls `resumeGuestWorkspace` → `resumeOrCreateGuestHandler`. It hashes the HttpOnly `__Host-arc_guest` cookie, finds that `guest_workspaces` row, and resumes it if it is active and not expired. Only if there is no row does it create one. This also happens for signed-in users: bare `/analysis` is backed by the cookie workspace, not a saved contract.
- **New Analysis:** `AppHeader` links to `/analysis` with no search params, which goes down the same resume path.
- **Temporary workspace:** the `guest_workspaces` table has `token_hash` (unique), `draft_json`, `schema_version`, `lock_version`, `status` (active/migrated), `migrated_user_id` and `expires_at` (created + 9 h, `GUEST_LIFETIME_SECONDS = 32400`). Expiry is checked on every load/save. The cookie Max-Age is 9 h, and the hourly maintenance job cleans up.
- **Draft storage:** a guest draft lives in `guest_workspaces.draft_json`, saved with an optimistic lock (`saveGuestDraftHandler`, or `arc_save_draft_with_ai_reconciliation` when AI data exists). A saved-contract draft lives in `analysis_revisions`.
- **Records tied 1:1 to the workspace:** `guest_source_document_selections`, `source_documents`, `document_upload_intents`, `ai_runs`, `ai_analysis_state`, `ai_review_events`. Each has a `guest_workspace_id` foreign key (cascade delete), and about 15 trusted functions authorise with `p_guest_token_hash` + `guest_workspace_id`.
- **My Contracts:** `/workspace` (in `_authenticated`) reads the `customers → contracts → analyses → analysis_revisions` rows the user owns, under RLS.
- **Samples:** `?sample=horizon` etc. use the in-memory `sample` mode. Nothing is saved. A refresh reloads the canonical sample.
- **AI allowance:** `arc_reserve_ai_allowance`. Guest runs are counted with `count(ai_runs where guest_workspace_id = X and quota_scope='guest')`. Signed-in runs count against `ai_monthly_usage` per user per month.
- **Save to My Contracts:** `migrateGuestWorkspaceHandler` → `arc_migrate_guest_workspace_by_token_v3`. It is one transaction that creates customer (or reuses one) → contract → analysis → revision 1 from the guest draft, moves the AI state, review events and documents, marks the workspace `migrated`, and then clears the cookie.

## 2. Root cause

The system assumes "one browser cookie = one `guest_workspaces` row = one draft". New Analysis goes to `/analysis`, which resumes that single row. There is nowhere to hold a second analysis, so "new" always reopens the current one.

## 3. Proposed identity model

```text
Browser session (cookie, 9 h)  ── AI allowance bucket (3 runs), expiry
   ├── Temporary analysis A  (own draft, docs, AI state, review events, lock)
   ├── Temporary analysis B
   └── ...
Signed-in user ── AI allowance bucket (10/month)
   ├── Temporary analyses (unsaved)      → Recent Analyses
   └── Saved contracts (existing tables) → My Contracts
```

## 4. Persistence model — options

- **Option A (recommended): one `guest_workspaces` row per analysis, grouped by a new session.** Add a `guest_sessions` table (token_hash, expires_at, optional `user_id`). Add `guest_workspaces.session_id` and `label_hint`, and drop `token_hash` uniqueness per session. The cookie holds only the session credential. For each analysis row, the server stores `hash(HMAC(sessionToken, analysisId))`. Because each row still has its own token hash, every existing trusted function, RLS rule and document path keeps working unchanged: saving, AI, review, restore and migration still see "one workspace = one analysis". Only two functions change:
  - `arc_reserve_ai_allowance`, so the guest count is per **session** (sum across its rows), not per row. Without this, each new analysis would get 3 fresh runs.
  - Maintenance cleanup, so it expires by session.
- **Option B:** a new `temporary_analyses` child table, with all six tables and about 15 functions re-pointed from `guest_workspace_id` to it. This is much larger and touches the frozen AI and document functions. Not recommended.

## 5. Guest lifecycle (Option A)

- **Create:** New Analysis → the server creates a session if needed, then a new analysis row with an empty draft (or a sample seed, section 14). It redirects to `/analysis?a=<analysisId>`.
- **Resume:** `?a=<id>` loads the row only if its `session_id` matches the cookie session and it is active and not expired. Otherwise it shows "This analysis is no longer available", with links back. It never falls back to another row.
- **Expiry:** each row keeps `expires_at = session expires_at` (9 h from session start, unchanged). Opening a new analysis does not extend the session.
- **Isolation:** the browser never lists by ID. The list server function filters by the cookie session hash only.

## 6. Signed-in lifecycle

Signed-in users already use the cookie workspace for unsaved work, and this stays the same. The list function also includes session rows stamped with `user_id` (section 7). Save moves exactly one analysis through the existing migration transaction (section 11). **Retention for signed-in unsaved work does not exist today apart from the 9-hour guest lifetime.** Keeping it at 9 h is the default. A longer period is an owner decision.

Three separate clocks: AI allowance (3 per 9-h session / 10 per calendar month), temporary retention (9 h), sign-in session (Supabase, unrelated).

## 7. Signing in with temporary work

Today the cookie survives sign-in, so the unsaved analysis is still there, and it moves only when "Save to account" is used. Proposal: on sign-in, stamp `guest_sessions.user_id` if it is unset. Recent Analyses then shows that session's analyses to that user on this browser. No automatic save and no merging by name. Sessions from other browsers are not pulled in. **Owner decision D3.**

## 8. Routing

- `/analysis` = a safe entry point. With a valid session and no `a`, it goes to `/analysis/new` (never auto-resumes).
- `/analysis/new` = chooser.
- `/analysis?a=<uuid>` = the exact temporary analysis, carried to child pages (`/analysis/documents?a=…` etc.).
- `/recent` = Recent Analyses.
- `?sample=` (read-only preview) and `?contract=&revision=` stay as they are.
- A row UUID is fine in the address bar: it is useless without the session cookie, and it is not the credential.
- 3D-R view state is keyed by an identity string, which gains `a`, so accordion state does not carry across analyses.

## 9. Recent Analyses page

A single list with newest first. Each row shows:
- the customer/contract label (Step 1 customer name, otherwise "Untitled analysis");
- the source file name or "Sample — Horizon";
- status;
- "Updated 2h ago";
- when it expires.

Actions: **Resume Analysis** (primary), and **Save to My Contracts** for signed-in users.

Status comes from existing fields only: no selected source and no AI run → "Not analyzed"; an `ai_runs` row that is running → "Analysis in progress"; `ai_analysis_state.review_items` with unresolved blocking items → "Review needed"; otherwise "Draft".

Empty state: "No recent analyses yet." plus a New Analysis button.

## 10. Header

- Guest: **New Analysis · Recent Analyses · Sign in**.
- Signed in: **New Analysis · Recent Analyses · My Contracts · Account** (My Contracts moves out of the account menu).
- On small screens the links wrap as they do today, and "Recent Analyses" shortens to "Recent".

## 11. Saving to My Contracts

The existing transaction is reused unchanged for the one analysis row. It creates a new durable identity (contract/analysis/revision IDs) and moves that row's AI state, review events, runs and documents. It never re-runs AI and never uses allowance. The row becomes `migrated`, so it drops out of Recent. Change: **the cookie is cleared only when the session has no other active rows.** The migration is identity-changing (temporary ID → new revision ID), not a copy.

## 12. Security / access rules

New table `guest_sessions` has no browser access at all (same pattern as `guest_workspaces`: revoke anon/authenticated, service_role only). No existing RLS rule is relaxed, and storage paths are unchanged. The list function returns metadata for the caller's session only.

## 13. Existing workspaces

The migration creates one `guest_sessions` row for each active workspace. On the first request after release, the existing cookie is recognised as a legacy token: the server wraps the row into a session, and it appears in Recent. Nothing is lost, and nothing needs re-uploading or re-running.

## 14. Samples

Opening a sample from the chooser creates a temporary row seeded from the canonical sample draft, and it shows in Recent. The accounting inputs are copied from the frozen sample definition and are not changed. The Home page "Try the Sample" read-only preview keeps working. **Owner decision D4:** also make the Home button create a temporary analysis?

## 15. Exact files (planned)

- Migration: `guest_sessions`, `guest_workspaces.session_id`/`label_hint`/index, updated `arc_reserve_ai_allowance` (guest count by session; limits unchanged), maintenance cleanup, and the legacy backfill.
- `persistence/guest.ts`, `guest.handlers.ts`, `guest.store.server.ts`, `guest.functions.ts`: session cookie, derived per-analysis hash, create/resume by id, list, partial cookie clear.
- `ai/*` and `documents/*` callers: pass the derived per-analysis hash (the signature stays the same).
- `routes/analysis/route.tsx` (`a` param, identity key, entry redirect), `routes/analysis/new.tsx`, `routes/recent.tsx`.
- `AppHeader.tsx`, `AccountMenu.tsx`, `analysis-context.tsx` (resume by id, missing-item state), `GuestSavePanel.tsx` (after save → My Contracts).
- New SQL suite `supabase/tests/phase3dt_sessions.sql`, plus unit and screen tests.

## 16. Tests

G1–G7, A1–A6, S1–S3, I1–I6, N1–N5 and Q1–Q3 exactly as in the brief. Additions:
- two tabs on A and B autosaving without conflict;
- a legacy cookie upgrading into a session;
- a forged `?a=` from another session being refused;
- an expired session refusing every row.

## 17. Verification

- Focused unit, routing and SQL suites (local harness).
- Full `bun run verify`, then both GitHub jobs green.
- Frozen-state check: `.env` has the two public values, `^2.15.0`, lock at 2.15.0 Europe West 4, Genomix SHA unchanged.

## 18. Live acceptance

The guest and signed-in flows from brief section 33, after publish approval. No AI run beyond what the owner chooses.

## 19. Owner decisions needed before implementation

- **D1:** approve a database migration and Option A (session grouping), including the change to how `arc_reserve_ai_allowance` **counts** guest runs (per session instead of per analysis; amounts unchanged).
- **D2:** signed-in unsaved retention: keep 9 h (default), or set a longer period.
- **D3:** on sign-in, attach this browser's temporary session to the user (proposed), or leave it guest-only.
- **D4:** should Home "Try the Sample" also create a Recent entry, or stay a read-only preview?
- **D5:** is a cap on temporary analyses per session wanted? None is proposed; the AI allowance is unaffected.
