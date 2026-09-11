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
      signing in. Google/social login is a future enhancement, not recruiter-ready v1.
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
      **Awaiting review — do not start 7E.**

- [ ] 7E Guest workspace (9-hour, HttpOnly credential only) + atomic migration.
- [ ] 7F Hardening: account deletion, bundle/network service-role leakage audit,
      end-to-end regression, completion report.

## Standing guardrails

- No accounting engine or sample fixture change.
- Service-role imports server-only; routine CRUD caller-scoped through RLS.
- SECURITY DEFINER functions: fixed search_path, execute revoked from
  public/anon/authenticated, granted to service_role only.
- Samples never autosave. Browser-supplied engine outputs are never authoritative.
- `supabase/migrations/` is the reproducible source of truth.
- Phase 8 (documents/storage) not implemented.
