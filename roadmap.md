# ARC Roadmap

## Phase 7 — Identity + Core Persistence Foundation

- [x] 7A Foundation: enums, tables, constraints, grants, RLS, trusted SECURITY DEFINER
      functions, generated types, database/security tests. draft → finalized →
      superseded lifecycle with `analyses.current_finalized_revision_id`.
- [x] 7A acceptance patch: least-privilege column grants on contracts/analyses/
      analysis_revisions, INSERT+UPDATE validation in the revision trigger, frozen
      ownership parents, pointer/supersession lineage triggers, lifecycle-shape check
      constraints, analyses row lock in finalization, adversarial privilege tests
      (`supabase/tests/phase7_privileges.sql`), service-role leakage test.
      Accepted.
- [x] 7B Identity: `/auth` sign-in (email magic link only — no passwords, no social
      login), `/auth/callback`, server-built callback URLs with ARC-local redirect
      validation (`ARC_SITE_URL` sets the deployed origin), verified-identity server
      function, `_authenticated` gate, `/workspace` + `/account`, session-aware
      header/account menu, bearer function middleware, root auth-state cache isolation
      (SIGNED_OUT and A→B identity change purge private cached data), dedicated
      duplicate-revision constraint test. Guest/sample use stays available without
      signing in. Magic link is ARC's authentication model; Google/social sign-in is not planned.
      **Accepted**, including the live magic-link round trip. Custom SMTP remains
      deferred to 7F.
- [x] 7C Persistence in the workspace: canonical persistence envelope
      (`arc.workflow.v1`) with Zod validation, caller-scoped workspace server
      functions (list/create customer, contract, analysis, seed draft revision),
      revision load + optimistic-lock autosave (`lock_version`), save-status
      indicator, read-only finalized/superseded revisions, `/workspace` customer
      and contract management. Samples never autosave; engine output is never
      persisted from the browser. Acceptance patch applied: queued autosave for
      edits made during an in-flight save, editing blocked while loading /
      after a failed load, read-only enforcement at `setDraft`, `resetAnalysis`
      and every input control, distinct save-failure (retry) vs conflict
      (reload) recovery, atomic contract creation through a SECURITY INVOKER
      transaction, runtime draft validation and strict schema-version equality,
      ambiguous `?sample=` + `?contract=` normalization, and source-controlled
      persistence + database regressions. Cache-authority patch applied: cached
      React Query revision data is never treated as a fresh authoritative load
      (no Saved, no editing, no lock version until the current identity's own
      load succeeds), background refetches never silently replace local work,
      the query cache is updated with each accepted save, explicit reload is a
      real loading boundary, and the read-only wrapper only re-enables controls
      it disabled itself. **Accepted.**

- [x] 7D Finalization snapshot + Review & Finalize lifecycle + revision history.
      Server-side snapshot builder (`ARC_ENGINE_VERSION = arc.engine.v1`) reruns the
      existing workflow, balance and journal engines on the authoritative persisted
      draft — the browser never supplies engine output and no accounting arithmetic
      was added in React, SQL or persistence code. `finalizeRevision` verifies the
      caller through RLS, checks the authoritative `persistence.lockVersion`, and
      commits through the trusted transactional `arc_finalize_revision`
      (supersession + pointer update atomic); a stale lock returns a conflict, an
      incomplete analysis returns engine-reported blocking issues. Finalized and
      superseded revisions load read-only and render from the recorded
      reconciliation snapshot only — never recalculated — with an explicit notice
      when the recording engine version differs from the current one. Revision
      history lists Draft / Finalized / Superseded with current-finalized marking
      and per-revision viewing; `startNewRevision` continues from the finalized
      snapshot as a fresh draft.

      7D remediation: finalization requires the complete workpaper (five steps,
      contract balances and the applicable reconciled ordinary or grouped
      journals), and a successful snapshot structurally always carries journal
      output. The saved workspace renders finalized and superseded revisions
      from the recorded `engine_outputs` in every parent area — ASC 606
      Analysis, Revenue Schedule, Contract Balances, Journal Entries and
      Review — through the same canonical components; a missing or unusable
      recording fails closed rather than recalculating. Finalization asks for
      confirmation ("Finalize analysis") and locks the whole workspace while the
      request is pending. Only the current finalized revision offers a new
      revision; it is created by the service-role-only
      `arc_start_amendment_revision` transaction, which seeds the draft from
      that revision, records `supersedes_revision_id`, reuses an existing active
      draft, and the UI then navigates to the returned draft.

      7D final acceptance patch: a finalized or superseded revision never
      passes its historical draft through the current workflow, balance or
      journal engines — recorded outputs only, and an unusable recording still
      does not recalculate. A finalization stale-lock conflict or transport
      error no longer restores the stale local draft as editable: both
      re-establish authoritative server state through an explicit reload, while
      a deterministic blocked result keeps the same saved draft open. Amendment
      provenance is decided inside the database transaction — the expected
      source revision is checked against `current_finalized_revision_id` under
      the same `FOR UPDATE` lock. Frozen-snapshot decoding validates every
      nested shape the historical renderers read and requires the stored row's
      `engine_version` / `schema_version` to match the snapshot's. Persisted
      summary labels read Draft Analysis · Saved / Finalized Analysis ·
      Revision N / Superseded Analysis · Revision N.
      7D decoder + coverage patch: frozen snapshots are decoded by a versioned
      strict Zod decoder for `arc.engine.v1` (`snapshot-schema.ts`) covering
      every structure the canonical historical workspace dereferences —
      workflow validation and totals, revenue schedule rows/per-PO/monetary
      fields, revenue sources and contract groups, variable consideration,
      material-right lifecycle, contract modifications, contract balances
      (ordinary and grouped) and journals (discriminated ordinary/grouped,
      entries, lines, reconciliation) — plus contradiction rejection
      (unfinalized workflow or balances, journals without matching balance
      analysis). Structure only; no accounting amount is recomputed. Production
      finalization and amendment logic is extracted into dependency-injected
      handlers (`revisions.handlers.ts`) that the `createServerFn` wrappers
      call, with direct tests for canonical-input reread, server-built
      snapshots, restricted browser input, stale lock and RPC error mapping,
      ownership, amendment source validation and exact RPC arguments. UI
      coverage added for successful finalization reload immutability,
      current-finalized new-revision navigation, superseded view-only history,
      and exact history revision links.

      Verification: 553 tests across 52 files, typecheck and build clean,
      ESLint 0 errors (8 pre-existing warnings). Database suites all green:
      privileges 23/23, revision lifecycle 20/20, RLS 12/12, duplicate revision
      2/2, 7C persistence 15/15, amendment RPC 12/12. No `src/lib/asc606*` or
      sample-fixture change.
      7D final renderer-integrity patch: the `arc.engine.v1` decoder now
      requires every workflow step key (1, 2a, 2b, 3, 4, 5, mod) in both
      blockingByStep and warningsByStep, types the optional revenue-source
      provenance fields, and validates the modification scope description,
      separate-contract test flag, mixed-allocation policy union and journal
      event-type enum that historical renderers dereference; unknown keys stay
      permitted for forward compatibility. Step 2 performance obligations no
      longer run workflow validation itself and instead renders the
      authoritative warnings supplied by the analysis context, so a finalized
      or superseded revision shows its recorded Step 2 warnings. Fail-closed
      regressions cover each newly required field, plus positive decoder
      coverage for Horizon (ordinary), Stellar and Meridian (grouped)
      finalized snapshots.

      Verification: 563 tests across 53 files, typecheck and build clean,
      ESLint 0 errors (8 pre-existing warnings). Database suites all green:
      privileges 23/23, revision lifecycle 20/20, RLS 12/12, duplicate revision
      2/2, 7C persistence 15/15, amendment RPC 12/12. No `src/lib/asc606*` or
      sample-fixture change.
      **Accepted.**

- [x] 7E Guest workspace (9-hour, HttpOnly credential only) + atomic migration.

      Bare `/analysis` resumes or opens a temporary workspace through
      server-only functions. Authorization is a 48-byte random credential
      carried in an HttpOnly cookie (`Secure`, `SameSite=Lax`, `Path=/`,
      `Max-Age=32400`); only its SHA-256 hash is stored, and the workspace id
      is never an authorization credential. Expiry is checked on every load
      and save; guest autosave uses the same optimistic lock-version
      behaviour as 7C. Samples stay fixture-backed and never autosave.

      Saving to an account is explicit: the panel takes customer name and
      contract number from the Step 1 draft, requires a contract title,
      blocks on a blank customer name, and preserves save intent through the
      magic-link round trip via `/analysis?save=1` without ever putting the
      credential in a URL. Guest → customer → contract → analysis →
      revision 1 is one trusted transaction
      (`arc_migrate_guest_workspace_by_token`, service-role only); on failure
      the temporary workspace stays active and authoritative, and the
      credential is cleared only after the transaction succeeds.

      Acceptance patch: saving to an account can only start from an exactly
      server-saved draft — a debounced or in-flight edit is flushed first and
      neither the magic-link round trip nor the migration proceeds until the
      server has accepted it. Migration carries the authoritative expected
      lock version, which the database checks under the guest row lock, so a
      second tab that saved again creates nothing. A committed migration whose
      response was lost is idempotently recoverable from provenance recorded
      on the guest row (same customer/contract/analysis/revision, no
      duplicates); another account is refused. The workspace is locked while
      the migration is pending. Store failures now throw instead of being read
      as "expired" or "conflict", so a lookup error never mints a replacement
      credential.

      Data-lifecycle patch: an active, unexpired workspace whose stored
      analysis cannot be parsed now fails closed as a load error — no second
      row, no replacement credential, the original stays reachable. Every
      accepted guest save writes draft, schema version and lock version in one
      optimistic update. `arc_expire_guest_workspaces()` marks past-expiry
      active rows expired; authorization still reads `expires_at` on every
      load and save, so cleanup timing never widens or narrows access.
      Physical deletion of long-expired rows is deliberately deferred to
      7F / operations retention — rows are marked, not removed. A lost
      migration response is reported as an unknown outcome, never a rollback:
      the workspace stays locked and a retry with the same expected lock and
      intent either completes the save or idempotently returns the already
      created contract/revision. Migration provenance foreign keys are now
      `ON DELETE SET NULL`, so deleting a saved customer/contract/analysis/
      revision is never blocked by a temporary-workspace row.

      Verification: 604 tests across 55 files, typecheck clean, ESLint 0
      errors (8 pre-existing warnings), build OK. Database suite
      `phase7e_guest_workspace.sql` keeps all 22 prior assertions and adds
      23–27 (cleanup expires only past-expiry rows and retains them;
      persistent chain deletable with a migrated guest row present; provenance
      cleared rather than blocking); verified against the project database in
      a rolled-back transaction. Earlier Phase 7 suites unchanged and last
      green at 7D acceptance.
      No `src/lib/asc606*` or sample-fixture change.
      **Accepted.**

- [x] 7F Hardening: account deletion, guest physical retention, service-role
      leakage audit, reproducible verification, end-to-end regression.
      Account Settings now carries an irreversible-action panel requiring the
      typed word `DELETE`. `deleteAccount` is signed-in only: the identity comes
      from `requireSupabaseAuth` plus a server-side `auth.getUser()`
      re-verification, never from browser input. It purges the deleting user's
      temporary-workspace rows first — `migrated_user_id = user` and the current
      browser's credential hash — through service-role-only
      `arc_purge_user_guest_data`, because deleting the auth identity would
      otherwise null `migrated_user_id` and orphan a copy of their contract
      draft. It then removes the Supabase auth user, which cascades
      customer → contract → analysis → revision (finalized and superseded
      revisions delete only on this path; the immutability trigger still blocks
      every other route). The handler proves the post-condition before reporting
      success, the guest cookie is cleared, and the browser then clears the React
      Query cache and signs out.
      Guest physical retention now uses the existing nine-hour lifetime as the
      boundary: service-role-only `arc_delete_expired_guest_workspaces()` deletes
      rows whose `expires_at` has passed, so idempotent migration recovery lasts
      exactly as long as the workspace did. Authorization remains `expires_at`,
      independent of cleanup timing. Scheduling documented in `docs/operations.md`
      (hourly `pg_cron` or external scheduler).
      Reproducible verification added: `bun run verify` (tests, typecheck, lint,
      production build, client-bundle secret audit), `bun run db:test`
      (`scripts/run-sql-suites.sh` against a local Supabase database) and
      `.github/workflows/verify.yml` with a pinned Supabase CLI — CI uses local
      infrastructure and no production service-role secret.
      Final acceptance patch:
      • Deletion completion is provable. Every post-condition query error is
        checked explicitly — an unreadable count is never read as zero. Outcome
        language is exact: "nothing has been removed" only before any
        destructive step, otherwise "deletion could not be fully confirmed".
        `guest_workspaces.migrated_user_id` is now `ON DELETE CASCADE` (the
        other `migrated_*_id` provenance keys stay `ON DELETE SET NULL`), so a
        workspace migrated after the purge disappears with the identity instead
        of becoming anonymous.
      • Every SQL suite now raises before rollback when any assertion is false,
        so `psql`, `bun run db:test` and CI all fail. `bun run db:test:gate-proof`
        runs a deliberately false assertion and succeeds only when the runner
        fails; proven against the project database (raised `P0001`).
      • Supabase CLI pinned as an exact dev dependency (`2.34.3`); `db:start`,
        `db:test` and CI all use the project-pinned CLI and the same runner.
      • `noStoreMiddleware` applies `Cache-Control: no-store, no-cache,
        must-revalidate, private` to every server-function response, ahead of
        the handler and without disturbing CSRF/auth middleware.
      • `src/lib/arc/__tests__/phase7-acceptance.spec.ts` is the source-controlled
        Phase 7 gate: samples are fixture-only, guest lifetime is nine hours to
        the boundary, guest saves move draft/schema/lock together, finalized and
        superseded snapshots read back verbatim, a foreign engine version fails
        closed, a new revision copies canonical input, documents stay Phase 8.
      Verification: 634 tests across 58 files, typecheck clean, ESLint 0 errors
      (8 pre-existing warnings), production build OK, bundle audit clean (no
      service-role env name, secret value, `service_role` JWT payload or admin
      client module in any client asset). Post-condition counts fail closed: a
      NULL/absent count throws rather than reading as zero, and any unknown
      outcome after the delete request uses the unconfirmed wording — "Nothing
      has been removed" survives only before any destructive step. Every SQL
      suite gates on `passed IS NOT TRUE` over `boolean not null` result
      columns, so FALSE and NULL both fail CI.
      `phase7f_account_deletion.sql` (19 assertions incl. the
      `migrated_user_id` cascade and the post-purge migration chain) ran 19/19
      green against the project database in a rolled-back transaction, and a
      deliberate NULL assertion raised `ARC SQL suite failed` as designed. The remaining Phase 7 suites run through the same pinned-CLI
      runner (`bun run db:test`) — this sandbox has no local Postgres/Docker, so
      they were last executed at 7E acceptance and now additionally carry the
      failure gate. Hosted browser acceptance against the development project is
      still outstanding: the hosted preview responds `401` behind editor gating
      from this environment, so hosted `Set-Cookie`/Network/Storage/Console
      evidence must be captured in a signed-in browser session. The exact HTTPS
      cookie contract (`__Host-arc_guest; Secure; HttpOnly; SameSite=Lax;
      Path=/; Max-Age=32400`, no `Domain`) is covered by a source-controlled
      regression. No `src/lib/asc606*` or sample-fixture change.
      Production prerequisite outside the codebase: custom SMTP for the
      magic-link sender.

- Amendment draft reset + discard (post-7D patch): trusted
  `arc_reset_amendment_draft` and `arc_discard_amendment_draft` transactions
  (service-role only, ownership + active-draft + source-provenance + expected
  lock version checked under one lock), caller-scoped server functions
  `resetAmendmentDraft` / `discardAmendmentDraft`, a `Reset to Revision N`
  action in the analysis summary, a destructive `Discard draft revision` action
  under Review & Finalize, and `supabase/tests/phase7g_amendment_lifecycle.sql`
  (17 assertions). Discarded revision numbers are reusable; finalized and
  superseded revisions remain immutable. No `src/lib/asc606*` or sample-fixture
  change.

## Standing guardrails

- No accounting engine or sample fixture change.
- Service-role imports server-only; routine CRUD caller-scoped through RLS.
- SECURITY DEFINER functions: fixed search_path, execute revoked from
  public/anon/authenticated, granted to service_role only.
- Samples never autosave. Browser-supplied engine outputs are never authoritative.
- `supabase/migrations/` is the reproducible source of truth.
- Phase 8 (documents/storage) not implemented.
