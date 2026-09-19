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

- Phase 8A — source document data foundation: private `arc-source-documents`
  bucket; `source_documents`, `revision_source_documents`,
  `guest_source_document_selections`, `document_upload_intents` and
  `storage_deletion_queue` tables with ownership RLS, explicit grants,
  duplicate constraints and immutability triggers (technical facts frozen;
  documents inside finalized history cannot be renamed or deleted, but can be
  archived); trusted lifecycle transactions `arc_prepare_source_document_upload`,
  `arc_commit_source_document_upload`, `arc_attach_source_document`,
  `arc_remove_source_document`, `arc_update_source_document_metadata`,
  `arc_set_source_document_archived`, `arc_stage_source_document_deletion` and
  the storage deletion queue claim/complete/release trio — all service-role
  only, each advancing the revision lock exactly once and idempotent on retry.
  Suites: `supabase/tests/phase8a_source_documents_schema.sql` (23 assertions)
  and `supabase/tests/phase8b_document_lifecycle.sql` (27 assertions), both
  executed green against the development project;
  `supabase/tests/phase7f_account_deletion.sql` extended with two document
  assertions and re-run green. No UI, server functions, or PDF parsing in this
  stage. No `src/lib/asc606*` or sample-fixture change.

- Phase 8A corrective patch: `source_documents` now rejects blank
  `original_filename` / `display_name`; `arc_prepare_source_document_upload`
  bounds validated facts at 10 MB and 500 pages exactly like the row
  constraints; `arc_commit_source_document_upload` re-checks that a guest
  workspace is still active and unexpired and only downgrades a `40001`
  concurrency conflict to "document accepted, selection failed" — any other
  association failure is now fatal. The private bucket configuration
  (private, 10 MB, PDF only) is declared in `supabase/config.toml`, because
  buckets cannot be created from a migration; the hosted project exposes no
  bucket content-type setting through the managed tooling, so server-side
  PDF validation in stage 8B stays the authoritative content gate.

- Phase 8A final lifecycle consistency patch: `arc_stage_source_document_deletion`
  now requires a guest credential that is still active and unexpired, the same
  9-hour boundary as prepare/commit; `arc_attach_source_document` and
  `arc_remove_source_document` still lock the revision and reject a stale
  expected lock first, but are genuine no-ops that return the existing
  `lock_version` when the requested end state already holds; guest
  auto-selection inside `arc_commit_source_document_upload` follows the same
  rule. The bucket assertion is renamed to state only what it proves: where a
  content-type restriction is configured it is exactly `application/pdf`; a
  NULL setting proves nothing and stage 8B must still validate the actual
  uploaded bytes independently of browser MIME metadata. Suites now
  `phase8a_source_documents_schema.sql` (23 assertions) and
  `phase8b_document_lifecycle.sql` (31 assertions).

- Phase 8A finalized upload retry patch: the finalized-intent branch of
  `arc_commit_source_document_upload` is pure recovery readback and now
  reconstructs authoritative association state per ownership mode — saved
  revision target (`revision_source_documents` membership, current
  `analysis_revisions.lock_version`, conflict when the target exists but the
  association is absent), guest workspace (`guest_source_document_selections`
  membership, current `guest_workspaces.lock_version`, conflict when the
  intended auto-selection is absent), and standalone contract-library upload
  (`associated = false`, `association_conflict = false`, `lock_version = null`).
  A retry never attaches, selects, or advances a lock. Guest authorization (the
  active, unexpired 9-hour credential) is still evaluated before the finalized
  readback. Two latent PL/pgSQL ambiguity faults on the guest commit path
  (`returning source_document_id`, `set lock_version = lock_version + 1`
  colliding with the OUT parameters) were fixed by qualifying the references.
  `phase8b_document_lifecycle.sql` is now 39 assertions (added 29–36).

- Phase 8B — private PDF upload / validation / access pipeline (no UI yet).
  `src/lib/arc/documents/validation.server.ts` judges the actual bytes with
  `pdfjs-dist` loaded inside the function: size, page count, decodability,
  encryption and a 50-character meaningful-text threshold, returning stable
  codes (`too_large`, `too_many_pages`, `invalid_pdf`, `password_protected`,
  `no_extractable_text`) and facts only — sha256, byte size, page count — never
  extracted text. `storage.server.ts` holds the private-bucket helpers
  (one-time signed upload target, download, retry-safe promotion, removal,
  15-minute signed read link). `documents.handlers.ts` is dependency-injected
  orchestration: initiation proves contract ownership (or an active, unexpired
  guest credential) and assigns `pending/<intent-id>.pdf` server-side;
  finalization downloads exactly the recorded pending object, validates it,
  discards invalid or duplicate blobs (immediate removal, else the 8A deletion
  queue), promotes new documents idempotently and lets the trusted 8A
  transactions decide recording, duplication and association; a finalized
  intent is pure read-back with no download, validation, promotion or lock
  movement. Read access resolves the document from the caller's own ownership
  or workspace and refuses foreign and unknown ids identically, leaking no
  path, filename or owner; signed links are ephemeral responses and are never
  stored. Server functions: `documents.functions.ts` (authenticated) and
  `guest-documents.functions.ts` (HttpOnly credential); `upload-client.ts`
  uploads only to the server-issued target with `upsert: false`.
  Verification: 697 tests across 65 files (32 in `src/lib/arc/documents`,
  including server-only isolation), typecheck clean, ESLint 0 errors, build OK,
  bundle audit clean. No `src/lib/asc606*` or sample-fixture change; no UI and
  no database change in this stage.

- Phase 8C — authenticated Source Documents workspace. The placeholder is
  replaced by two explicit surfaces for a saved contract analysis: "Selected
  for Revision N" (the exact association set of the loaded revision) and the
  "Contract Document Library" (every non-hidden contract PDF). Reads go through
  `workspace.store.server.ts`, which joins ownership explicitly and returns
  presentation metadata only — no storage object paths, no service-role
  material, no authorization internals. Mutations (`workspace.functions.ts`)
  are authenticated server functions that attach, remove, edit details,
  archive/unarchive and permanently delete through the trusted 8A operations,
  carry the expected revision lock version, advance the shared lock exactly
  once, and surface a stale lock as an authoritative reload rather than a
  claimed success. Uploads reuse the accepted 8B pipeline, including duplicate
  reuse and validation rejection. Documents used by finalized history are
  detail-locked and undeletable; archived documents stay visible inside the
  historical source sets that used them. Samples and non-contract contexts
  never reach the workspace and never gain persistent document ownership.
  Verification: 734 tests across 67 files (23 in the workspace spec), typecheck
  clean, ESLint 0 errors, build OK, bundle audit clean. No `src/lib/asc606*` or
  sample-fixture change; no database change in this stage.

- Phase 8D — revision source provenance. A new revision inherits the finalized
  revision's exact source-document associations inside the same trusted
  transaction that creates the draft, copying association rows only: no PDF,
  storage object, hash or path is ever duplicated, and a retried creation
  returns the existing draft without recopying or discarding draft-only
  changes. Reset restores the source revision's association set together with
  its canonical inputs, removing draft-only associations while leaving those
  PDFs in the contract library; discard removes only the draft's own
  associations. Finalization freezes the selected set, after which associations
  and the metadata of the documents they name are immutable, so each finalized
  revision keeps its own evidence set and one document can support several
  revisions without duplication. The UI re-reads the authoritative set after
  create, reset, discard and finalize rather than assuming one client-side.
  Lifecycle lock ordering: finalization and permanent document deletion both
  take the draft revision lock before any source-document lock, so the two can
  never deadlock, and a reset leaves the superseded revision lock behind before
  waiting on any document refetch, so no autosave can reuse it.
  Verification: 757 tests across 68 files, typecheck clean, ESLint 0 errors,
  build OK, bundle audit clean; `supabase/tests/phase8d_revision_source_provenance.sql`
  — 33 assertions, all passing against the ARC-development database. No
  `src/lib/asc606*` or sample-fixture change.

- Phase 8E — guest documents, unsaved-analysis uploads and migration. A
  temporary workspace now has its own Source Documents area: Upload, View,
  Download, Add, Remove and permanent Delete, presented as "Included in this
  analysis" and "Other uploaded PDFs" with no contract library before a
  contract exists. A shared upload dialog serves the authenticated workspace,
  the temporary workspace and the landing page, whose three entry paths are
  Upload a Contract PDF, Enter Contract Details Manually and Try a Sample
  Contract, with no extraction or AI claim. Guest document changes share the
  single temporary lock version with the accounting autosave through trusted
  service-role transactions: a stale lock is refused before anything is
  written, a repeated add or remove is a genuine no-op, and an ambiguous
  transport outcome always reloads the authoritative state instead of claiming
  a result. Saving to My Contracts moves every uploaded PDF to the new contract
  in the one transaction that creates it — the same rows, hashes, storage
  paths, filenames and metadata, no duplicated blobs — associates exactly the
  included documents with revision 1, retires the temporary credential, and
  replays idempotently if the response is lost.
  Verification: 767 tests across 69 files, typecheck clean, ESLint 0 errors,
  build OK, bundle audit clean; `supabase/tests/phase8e_guest_documents.sql`
  — 40 assertions, all passing against the ARC-development database. No
  `src/lib/asc606*` or sample-fixture change.

- Phase 8E acceptance — upload transport integrity. The browser's selected
  file size now travels with the upload intent as a transport expectation
  only: the server's own downloaded bytes remain authoritative for hash, size,
  page count and PDF validity. Before the PDF reader is asked, an empty or
  size-mismatched read-back is reported as "That upload did not finish" rather
  than as an unreadable document, and the PDF signature is looked for anywhere
  in the first 1,024 bytes. An incomplete or unreadable-PDF verdict is read
  back once more; password-protected, too large, too many pages and no
  extractable text are never retried. A successful second read continues
  through the same prepare/duplicate/promote/commit path — one intent, one
  document row, one permanent blob. Both attempts are recorded privately
  (declared size, observed size, SHA-256, signature present, code, attempt
  count — never text, never raw bytes), including a first failure that the
  retry recovered. Both reads failing still marks the intent terminal before
  cleanup, exactly as Phase 8B requires.
  Verification: 783 tests across 71 files, typecheck clean, ESLint 0 errors,
  build OK, bundle audit clean.

- Phase 8E acceptance — complete. Saving an unsaved analysis now offers an
  existing customer or a new one, verified against the caller's ownership in
  the trusted migration transaction (`arc_migrate_guest_workspace_v2` /
  `_by_token_v2`), with the response-loss retry still returning the original
  hierarchy. My Contracts offers "Upload Contract PDF" beside "Create
  manually", reusing the same temporary workspace and Phase 8B upload
  pipeline; the customer travels only as a preselection hint. Saved analyses
  offer a server-derived destructive action: "Delete draft" for a first draft
  with no finalized history (`arc_delete_initial_draft_contract`, which queues
  every stored and pending object path before deleting the contract and leaves
  the customer), and the existing "Discard draft" for amendment drafts.
  Verification: 794 tests across 73 files, typecheck clean, ESLint 0 errors,
  build OK, bundle audit clean, 17/17 assertions in
  `supabase/tests/phase8e_acceptance.sql`.

- Phase 8E final acceptance corrections.
  (A) "Upload Contract PDF" on My Contracts is now always available, including
  for an account with zero customers; it routes to the same
  `/analysis?upload=1` temporary workspace, omits the customer hint when no
  customer is selected (so the save panel defaults to creating one), and
  manual creation still requires a customer. UI regression:
  `src/components/arc/workspace-pdf-first.spec.tsx`.
  (B) Lock ordering: `arc_delete_initial_draft_contract` now locks every one
  of the contract's `document_upload_intents` rows in ascending id order
  BEFORE the draft revision, matching the intent → revision direction taken by
  `arc_commit_source_document_upload`; direction is contract → analysis →
  upload intents → draft revision → source documents, with eligibility
  revalidated after all locks and the durable deletion queue unchanged.
  Assertions 18–21 in `supabase/tests/phase8e_acceptance.sql` prove the shipped
  function body's lock order structurally plus a behavioural deletion with an
  in-flight upload. HARNESS LIMITATION: the SQL runner uses a single database
  session in one rolled-back transaction, so no real two-session race is
  scheduled; the cycle removal is proven structurally, not by deadlock.
  (C) Hosted acceptance: the embedded-vs-standalone difference is resolved and
  closed (pdf.js worker registration in the built output); no parser rule was
  changed. The guest half of the journey was executed against the production
  build running in the Cloudflare Workers runtime (`wrangler dev` over
  `dist/`): fresh guest → upload → document listed (4 pages, 47 KB) → View
  returns 200 `application/pdf`, 47,654 bytes, `%PDF-` header. The
  authenticated half (save to My Contracts, reopen, View + Download the
  migrated PDF) could not be executed from the build sandbox: identity is an
  external Supabase project and no browser session can be minted here. It
  requires a manual run on the published URL.
  Verification: 797 tests across 74 files, typecheck clean, ESLint 0 errors,
  build OK, bundle audit clean.

## Phase 9A — Guidance Registry & Deterministic Retrieval (complete)

- Master workbook copied unchanged to
  `guidance/Revenue_Compass_ASC606_Master_Library.xlsx`
  (sha256 86d1a19ec1d7d222c2d05e60bebb0f9c61784a0016e7828de3a702414906c8cf).
- `scripts/compile-guidance-registry.ts` compiles the Guidance Cards sheet into
  `src/lib/arc/guidance/registry.generated.ts` (`guidance:compile` /
  `guidance:check`). `exceljs` is a devDependency and never ships to the browser.
- `policy.ts` holds explicit ARC machine policy keyed by stable Item No.;
  `retrieval.ts` builds deterministic, explainable Guidance Packs
  (core > retrieved > dependency). No embeddings, vector store or OpenAI.
- Phase 9B (PDF evidence + exact AI preflight) implemented and patched; see below.

## Standing guardrails

- No accounting engine or sample fixture change.
- Service-role imports server-only; routine CRUD caller-scoped through RLS.
- SECURITY DEFINER functions: fixed search_path, execute revoked from
  public/anon/authenticated, granted to service_role only.
- Samples never autosave. Browser-supplied engine outputs are never authoritative.
- `supabase/migrations/` is the reproducible source of truth.
- Phase 8: stages 8A, 8B, 8C, 8D, 8E and 8F complete; 8G not implemented.
- 8F operations: hourly maintenance (stale uploads, 9h guest expiry, storage
  drain). Schedules live in `supabase/schedules/` and `.github/workflows/`.
- Phase 9: 9A guidance registry accepted; 9B PDF evidence + exact AI preflight
  accepted; 9C AI persistence, quotas and ownership boundaries accepted;
  9D Terra generative boundary accepted; 9E deterministic adapter, provenance,
  merge policy and projected collections accepted; 9F atomic orchestration,
  revision lifecycle and restore complete and awaiting acceptance; 9G not started.
- Approved recruiter-v1 sequence after 9A–9G: Resend + `ayden-rc.com` deployment
  integration, then 9H evaluation, security and hosted acceptance plus
  recruiter-demo polish. None of that is implemented in Phase 9F.

## Phase 9B — PDF evidence & exact AI preflight (complete, awaiting acceptance)

Acceptance patch applied. Seven review findings closed:

1. Preflight must share one canonical request envelope with the eventual 9D
   generative request (no reduced count-only payload).
2. Direct PDF evidence must request `detail: "high"`.
3. Downloaded PDF bytes verified against the authorized stored SHA-256.
4. Trusted ARC source identity separated from user-controlled filenames /
   display names.
5. Narrow Phase 9A retrieval false positives exposed by the full Genomix
   contract (e.g. cards 17, 40, 90).
6. Re-run the real/full Genomix acceptance case.
7. Roadmap status wording corrected.

Phase 9A and 9B accepted.

## Phase 9C — AI persistence, quotas & ownership boundaries (accepted by director, 2026-09-15)

Non-generative. Migration history: foundation
`20260915215119_0aa0698c-ceb3-4ec1-af3b-b640bd0ebe78.sql`; Phase 9C acceptance
patch `20260915221346_c2102180-d15d-47a3-93ec-56bc7fec3efa.sql`; final
CI/hardening micro-patch
`20260915223847_161e985e-9d02-4b7e-a2f9-18f71cce9eec.sql`.

The foundation migration adds
`ai_runs`, `ai_run_sources`, `ai_run_guidance`, `ai_analysis_state` and
`ai_monthly_usage` (service-role only, RLS on, no policies), the trusted
routines `arc_create_ai_run`, `arc_reserve_ai_allowance`,
`arc_mark_ai_run_failure`, a completed-provenance immutability trigger and
partial unique indexes giving one active run per revision and per temporary
workspace. SQL acceptance suite: `supabase/tests/phase9a_ai_foundation.sql`.

Server layer: `src/lib/arc/ai/runs.store.server.ts`, `runs.handlers.ts`,
`runs.functions.ts`. Exactly three browser-callable functions —
`startAiAnalysis`, `getAiRunStatus`, `getAiUsageSummary`. Allowances:
3 runs per nine-hour temporary workspace, 10 runs per account per UTC month,
consumed only at the reservation boundary.

Acceptance patch: quota provenance is
separated from the current owner target, so a guest-funded run may later be
re-homed once to a saved revision without rewriting its quota scope or debiting
the account's monthly allowance; parent lifecycle deletion (expired temporary
workspace, deleted contract, deleted account) cascades normally while update
provenance stays immutable; allowance may be reserved only from
`preflight_ready` with no OpenAI start recorded; failure marking validates the
stage/category matrix; run source history survives deletion of the live source
document; guidance card IDs are integers; AI sidecar source state is a
constrained enum. Run provenance (lock version, source-set fingerprint,
canonical inputs, AI sidecar snapshot) is derived entirely server-side in
`runs.store.server.ts` with `src/lib/arc/ai/source-fingerprint.ts`; the browser
supplies only the requested revision target.

Final CI/hardening micro-patch: a guest → revision re-home may change only
`revision_id`, `guest_workspace_id`, `owner_user_id` (plus the automatic
`updated_at`), with every other historical field — counts, failure metadata,
review outcome, result/usage provenance — explicitly protected; and
`arc_create_ai_run` rejects a null expected lock version for both owner scopes.
The obsolete "a consumed run cannot be deleted" assertion is replaced by a
dedicated deletable run, keeping the immutability target row alive.

## Phase 9D — Terra generative boundary (awaiting director acceptance)

Server-only. Strict semantic `AiContractAnalysis` schema (`src/lib/arc/ai/schema.ts`),
trust-tier instructions (`prompt.ts`), citation/Guidance validation (`citations.ts`),
hardened canonical request (`request-package.server.ts`) and the single-call
`TerraAnalyzer` (`terra.server.ts`). Developer-only live acceptance via
`bun run ai:phase9d:smoke` (requires `ARC_ALLOW_LIVE_PHASE9D=1`; never in CI).
No persistence, no quota reservation, no WorkflowDraft application.

Deviation: the live `responses.inputTokens.count` endpoint rejects `store` and
`background` (`400 Unknown parameter`). The counted body is the canonical object
minus exactly those two non-token-bearing control flags
(`COUNT_UNSUPPORTED_CONTROL_FLAGS`); the generative call sends the canonical
object itself.

Phase 9D accepted by the director (2026-09-15) with the citation & validation
acceptance patch.

## Phase 9F — atomic orchestration, revision lifecycle & restore (complete, awaiting acceptance)

Task 11 — trusted database routines: `arc_advance_ai_run_stage`,
`arc_record_ai_preflight`, `arc_apply_ai_run`, `arc_restore_pre_ai_run`,
`arc_set_ai_review_state`, `arc_affirm_ai_review_scope`, plus `ai_runs.restored_at`.
All are service-role-only with a fixed `search_path`; apply and restore are
atomic under the owner's optimistic lock and are idempotent on retry.

Task 12 — `src/lib/arc/ai/orchestrator.ts` (pure, dependency-injected) sequences
created → extracting → preflight_ready → analyzing → validating → applying →
succeeded. `created → extracting` is an exactly-once claim: the loser of a
concurrent start stops immediately. The allowance reservation itself enters
`analyzing`, so the charge and the stage commit together; there is never a
second generative call. The Terra boundary's `onResponseReceived` hook enters
`validating` as soon as the provider answers and before any parsing or local
validation, so an API failure is recorded at `analyzing` and a rejected response
at `validating`. The deterministic merge happens inside `applying`, against the
newest accountant draft reloaded immediately beforehand; a lost optimistic lock
(40001) re-merges and retries locally, at most three attempts, with no further
token count, allowance charge or model call. A failed application never restores
automatically — `arc_apply_ai_run` is atomic, so nothing partial exists, and
restore stays an explicit user action. `review_issue_count` records outstanding
items only. Production boundaries live in `orchestrator.server.ts`; the browser
surface is `executeAiAnalysis`.

Runtime durability, stated plainly: execution is a single in-request server
call. There is no background worker, no durable job queue and no automatic
resumption. If the request dies mid-run the run stays at its last committed
stage until a maintenance sweep or an explicit user action ends it; the database
routines guarantee that no partial accounting state can exist in the meantime.

Task 13 — lifecycle integration in SQL: the selected source set is frozen while
a run is active; changing it after a successful run marks the sidecar stale
without deleting AI work; amendment reset clears the draft sidecar; reset,
discard, initial-draft deletion and guest saving are refused while a run is
active; `arc_migrate_guest_workspace_v3` / `..._by_token_v3` re-home AI runs and
AI state to the saved revision with run ids, stages, fingerprints, guidance and
guest-funded quota scope intact.

Acceptance patch (2026-09-16): `ai_analysis_state.source_state` is TEXT, but the
two committed Phase 9F migrations assigned it JSONB. Those files are left
untouched; two later additive migrations
(`20260916040703_871cb27a-…`, `20260916041038_552539f0-…`) replace the affected
routines in place — plain-text source state in `arc_mark_ai_sources_stale`,
`arc_apply_ai_run` and `arc_restore_pre_ai_run`, an integer guidance card id in
`arc_record_ai_preflight`, and a qualified owner-lock bump in
`arc_affirm_ai_review_scope` — with signatures, lock order, ownership checks and
service-role-only grants preserved.

Citation mirror patch (2026-09-16): two live fictional runs failed local
citation validation with `excerpt_not_found` only — Terra saw the rendered PDF
but never ARC's own extraction, so visually correct excerpts were mechanically
wrong. `src/lib/arc/ai/citation-mirror.ts` now supplies an ephemeral ARC local
citation text mirror alongside (never instead of) each original PDF: per
physical page, an ARC-authored locator part (trusted documentId, physical page,
payload length) followed by a separate part holding `AiDocumentEvidence.pages[]
.text` byte for byte. No textual BEGIN/END sentinel is trusted and ARC never
parses delimiters out of page content, so contract text cannot escape into
ARC-authored metadata; the locator is trusted, the transcription is contract
evidence only. The mirror travels inside the one counted canonical request and
is cleared with the transient PDF bytes by `releaseRequestSensitivePayload`
(renamed from `releaseRequestBytes`) through references recorded at build time.
Prompt bumped to `arc.ai.prompt.v2`: PDFs remain the semantic/visual evidence,
text excerpts are copied only from the mirror, layout-dependent facts stay
visual. `validateAiCitations()` and `normalizeCitationText()` are unchanged.

Live gate (2026-09-16, run `6018af81-9763-4693-930f-4b8fa3b802dd`): with the
mirror in place the run passed schema, citation, Guidance and provenance
validation for the first time — `validating` completed with zero citation
issues on 4 pages / 37,094 input tokens — and then failed at `applying` with
`failure_code = merge_failed` (a non-`AiMergeError` exception inside
`mergeAiAnalysis`). Nothing was applied: `arc_apply_ai_run` is atomic, the
draft, AI state and documents are untouched, one allowance was consumed and
exactly one generative call was made. Because the run failed before
application, the model response was never persisted, so the exception cannot be
reproduced offline. `AiExecutionDeps.onMergeDiagnostic` (developer-only,
in-memory, never wired in production, error class and code frames only, nothing
persisted) was added so the next authorized run pinpoints the throw site. No
validator, prompt, schema or merge-policy change was made.

Coverage: `supabase/tests/phase9f_ai_lifecycle.sql` (53 assertions, run by the
database job with every other suite), the fake-model
`__tests__/orchestrator.spec.ts` (22 tests), `__tests__/citation-mirror.spec.ts`
(page fidelity, byte-for-byte preservation, framing-escape resistance), the
request-package mirror/release regressions, the prompt v2 regressions and the
`citations.spec.ts` mirror round-trip proofs (an exact mirror span verifies;
trailing punctuation, stitched cells, ellipses, wrong page and fabrication are
still rejected). No live OpenAI call was made in this patch. No Resend,
custom-domain, auth or email work.

### Live gate run 2 (2026-09-16) — citations clean, envelope defect found and fixed

Run `3e4e5a08-d912-4b99-8039-7857c156a0f1`: one generative call, 153 s, 4 pages,
37,094 input tokens, prompt `arc.ai.prompt.v2`, Guidance hash `352bcf79…5d56`.
Citation validation passed again with zero issues and empty bounded
diagnostics; schema, Guidance and material-provenance validation passed. The run
then failed at `applying` with `merge_failed`. The developer-only merge
diagnostic located the throw exactly: `TypeError` at `merge.ts:183`.

Cause: `runs.store.server.ts` handed the stored canonical ENVELOPE
(`{ schemaVersion, draft }`) to the orchestrator as if it were a bare
`WorkflowDraft`, so `draft.promises` was `undefined`. Fix: `loadExecutionContext`
now validates both `analysis_revisions.canonical_inputs` and
`guest_workspaces.draft_json` through `parseCanonicalInputs()` (the same reader
every other ARC path uses), and `applyRun` re-wraps with `toCanonicalInputs()`
before `arc_apply_ai_run`. No validator, prompt, schema or merge policy changed.
Regression: `__tests__/execution-context-envelope.spec.ts`.

Post-fix verification: 1,220 tests / 109 files pass, typecheck clean, lint 0
errors (10 pre-existing warnings), build OK, `audit:bundle` clean. No SQL
changed, so the database suites are unaffected. One allowance consumed
(1 of 10); nothing canonical was written. Phase 9F still awaiting acceptance;
Phase 9G not started.


### Phase 9F — ARC-owned citation anchors (Tasks 1–8 complete, awaiting live acceptance)

The model no longer transcribes excerpts. ARC segments each physical page into
deterministic, page-scoped anchors (`P0001-S0001`, ≤160 chars, preferred
boundary ≥80 chars), exposes them through the untrusted JSON mirror payload,
and the model selects an anchor range (≤3, one physical page) instead of
copying text. ARC materializes the excerpt byte-for-byte from local page text
before validation, so `validateAiCitations()` and `normalizeCitationText()`
remain unchanged and unweakened.

New modules: `citation-anchors.ts`, `citation-anchor-materializer.ts`; rewritten
`citation-mirror.ts` (trusted ARC locator part + JSON-framed untrusted payload,
no delimiter parsing); `schema.ts` provider transform `toAnchoredProviderSchema`
with exact citation-node replacement parity (fails closed on mismatch, zero
nodes, or a surviving provider-facing excerpt); `anchorStart`/`anchorEnd` are
required-but-nullable and the materializer enforces text vs visual nullability.
`outputSchemaVersion` → `arc.ai.schema.v2`, `promptVersion` → `arc.ai.prompt.v3`,
new Terra failure category `citation_anchor_failure` (bounded code + schema path
diagnostics only).

Instruction-path defects (patched before Task 9): the production
`createExecutionBoundaries().buildPackage` path never passed
`buildInstructions`, so the counted canonical request silently carried the
legacy `packageInstructions()` preamble instead of the trust-tier prompt. A
single shared `arcCanonicalInstructions()` (package Guidance, ARC source
descriptors, current/prior context, `AI_LIMITS.promptVersion`,
`AI_LIMITS.outputSchemaVersion`) is now used by the orchestrator boundary and
the preflight script, with a production-boundary regression
(`production-boundary-instructions.spec.ts`) asserting all five
`AI_PROMPT_SECTIONS`, prompt v3, schema v2, the anchor rules, and the absence of
the legacy preamble. The evidence section's remaining v2 excerpt-copy language
was replaced by anchor selection (text: smallest valid `anchorStart`/`anchorEnd`
range, ARC materialises the excerpt; visual: both anchors null), and the prompt
regressions now reject the stale phrases.

Verification: 1,258 tests / 114 files pass, typecheck clean, lint 0 errors
(10 pre-existing warnings), build OK, `audit:bundle` clean, `guidance:check`
116 approved cards, hash `352bcf79…5d56`. SQL unchanged; the database suites run
in CI. Preflight only (no generative call): Genomix fixture, 4 pages, 99 anchors,
**53,099 input tokens**, cap 200,000, truncation disabled, no source dropped.

Phase 9F still awaiting final live acceptance; Task 9 not run; Phase 9G not
started.



## Phase 9E — deterministic adapter, provenance, merge policy & projected collections (accepted)

Task 9 (cash basis) and Task 10 (adapter/merge/review state) are implemented
and verified. No live OpenAI call was made, no database RPC or SQL changed, and
no Phase 9F behaviour (run orchestration, apply/restore RPCs, quota, Analyze
button, polling, affirmation UI, guest migration, finalization gate, email) was
started.

New pure modules: `src/lib/arc/ai/identity.ts`, `adapter.ts`, `review-state.ts`,
`merge.ts`. New fixtures/specs: `__tests__/merge-fixtures.ts`, `identity.spec.ts`,
`adapter.spec.ts`, `review-state.spec.ts`, `merge.spec.ts`,
`merge-reanalysis.spec.ts`, plus Task 9 specs under persistence, workflow and
components.

Phase 9E accepted by the director (2026-09-16).

## Phase 9G Task 6 — Analyze Workspace UI

- [x] Add the single controller-driven Analyze/Re-analyze workspace action.
- [x] Render authoritative four-phase progress, allowance, loading, and safe notices.
- [x] Apply existing AI locks minimally to Finalize and source-document mutations.
- [x] Add component/provider RED→GREEN coverage and preserve Task 5 regressions.
- [x] Complete full verification, browser review, security audit, and repository ZIP.

## Phase 9G Task 9 — Final Presentation & Guidance Integrity Patch

- [x] Prove and move whole-run restore to Review & Finalize only.
- [x] Preserve evidence and Guidance on resolved review items.
- [x] Present approved Guidance subtopic and when-relevant content.
- [x] Fail closed when any unique trusted Guidance reference is unresolved.
- [x] Replace monthly restore wording with scope-neutral consumed-usage copy.
- [x] Run focused and full application/database/security verification.
- [x] Confirm both GitHub jobs — both jobs returned green (externally confirmed).
- [x] Produce the refreshed source ZIP.

## Phase 9G Task 10 — Final End-to-End Acceptance & Release Gate

- [x] Add the acceptance matrix (`src/lib/arc/ai/__tests__/phase9g-acceptance.spec.ts`):
      saved and guest happy paths, manual-only, zero-source Analyze, yellow and
      red lifecycles, malformed-payload fail-closed, evidence authorization and
      isolation, Guidance authority and completeness, source freshness and
      acknowledgment, quota (account and guest), the zero-cost auxiliary-action
      matrix, restore eligibility/first-run/acknowledged-state/single-flight,
      and account plus guest isolation — all against the real handlers, with no
      OpenAI call of any kind.
- [x] Add the release gate (`src/lib/arc/ai/__tests__/phase9g-release-gate.spec.ts`):
      frozen Task 9 migration SHA, no pending migrations, fixed `search_path` on
      every currently defined SECURITY DEFINER routine, service-role-only execute
      on the trusted AI routines, no browser storage of AI lifecycle state, no
      logging and no server-only imports from browser-safe AI modules, no focused
      or skipped specs.
- [x] Remove the redundant `supabase/pending/` copy of the promoted Task 9 migration.
- [x] Verification: 149 test files / 1,856 tests green, typecheck clean, lint clean
      (11 pre-existing shadcn fast-refresh warnings), production build OK,
      `audit:bundle` clean, `guidance:check` 116 approved cards, hash
      `352bcf79e7cff1753f353451d9b12bf7f7cb7840eae6fe7699fdcbace6425d56`.
- [x] Database: Docker unavailable locally, so the throwaway PostgreSQL harness
      replayed the entire migration history and ran all 21 SQL suites — all passed.
- [x] Cloud drift: the ten Phase 9 trusted routines are SECURITY DEFINER with
      `search_path = pg_catalog, public` and execute granted to `service_role`
      only; the deployed restore routine carries the approved Task 9 semantics.
      No Cloud mutation, no new migration, no OpenAI call, no Genomix run.
- [x] Confirm both GitHub jobs — both jobs returned green (externally confirmed).

## Phase 9G — COMPLETE

Frozen architecture: AI runs only on a deliberate Analyze/Re-analyze click; the
deterministic ASC 606 engines own every calculated figure; user edits are never
overwritten by an AI result; review state, provenance, evidence and Guidance are
server-owned and reach the browser only as safe projections; source freshness and
stale acknowledgment are authoritative and never block finalization; whole-run
restore is explicit, exact and offered only on Review & Finalize; allowance is 10
runs per account per UTC month and 3 per nine-hour guest workspace; auxiliary
review, evidence, Guidance, acknowledgment and restore actions never consume
allowance or start a run.

## Phase 9G-R — post-release refinement

### Task R1 — Accounting Correctness & Internal Consistency (awaiting acceptance)

Scope was limited to the four approved accounting-correctness gaps. No Cloud
change, no migration (frozen Task 9 SHA
`3013e5370b7a12e8d266ddf4332034968bc5cc3cefb66dcb307ac04db261c251` untouched),
no OpenAI call, no Genomix run, no R2/R3/R4 work.

- [x] Output schema `arc.ai.schema.v3` → `arc.ai.schema.v4`; prompt
      `arc.ai.prompt.v4` → `arc.ai.prompt.v5`.
- [x] Full-term fixed consideration: `deriveUnambiguousFixedBillingTotal()`
      derives the contract total from a single unambiguous fixed billing
      schedule and the canonical service period, in exact integer cents. When
      the model reports one PERIOD's fee as the total, ARC's derived total is
      authoritative and the note is ARC-authored; every other disagreement is
      left to the accountant. Milestone/usage-only, two independently
      schedulable fixed terms and a missing service period all refuse.
- [x] Contract reference: new optional `contractAssessment.contractReference`
      fact. It fills only a blank contract number, never overrides the
      accountant, and no longer blocks validation or the engine adapters — a
      reference is an administrative label, not an accounting input.
- [x] Manual facts: `manualAccountingFacts()` (extracted to
      `src/lib/arc/ai/manual-facts.ts`) omits untouched `false` structural
      defaults, so the analysis is never told the accountant concluded there is
      no variable consideration or modification when they simply have not said.
- [x] Variable-consideration allocation: structural proposal fields on the
      schema, mapped through the canonical performance-obligation map. A
      semantic key is never written into a canonical field; an unmappable
      specific target fails closed to the general treatment and raises an
      `unsafe_semantic_relationship` review item; an accountant's own
      allocation is preserved.
- [x] Tests: new `phase9g-r1.spec.ts` (26) and `manual-facts.spec.ts` (4) plus
      the synthetic Genomix benchmark fixture `r1-fixtures.ts`. Full
      `bun run verify` green: 151 files / 1,886 tests, clean typecheck and
      build, `audit:bundle` clean, 11 pre-existing shadcn lint warnings only.
- [x] Database: R1 changed no SQL, no schema, no RLS, no grants and no routine.

#### R1 acceptance patch

- [x] Fixed consideration precedence corrected: when the contract's billing
      schedule unambiguously determines the full-term total, ARC's deterministic
      total is canonical whatever the model reported (period fee, correct total,
      wrong total or nothing). The model's validated full-term conclusion is used
      only when no unambiguous schedule exists, and neither ever overwrites the
      accountant's own transaction price (preserved, exactly one focused review
      item). The transaction-price note is ARC-authored whenever ARC supplied the
      amount.
- [x] Prompt v5 semantics restored (no version bump): `fixedConsiderationInput`
      is the TOTAL fixed consideration enforceable over the complete current
      contract term, excluding variable consideration; the per-period amount
      belongs to the billing terms; ARC's deterministic total prevails.
- [x] Variable-consideration allocation is one user-ownable judgment group.
      `allocationTreatment`, target PO, `relatesSpecifically`,
      `consistentWithAllocationObjective` and `allocationRationale` each carry
      their own field provenance; ownership is collective, so an accountant edit
      to ANY of them preserves the whole judgment on re-analysis and raises
      exactly ONE focused difference. Unrelated VC fields (description,
      estimation) stay refreshable.
- [x] `supabaseAdmin.rpc.bind(supabaseAdmin)` in `autosave.store.server.ts` and
      `review-actions.store.server.ts` kept: a real runtime defect (detached
      `rpc` lost its receiver and threw "Cannot read properties of undefined
      (reading 'rest')"). Frozen behaviour is unchanged; a regression now proves
      the store calls the routine with the client as receiver.
- [x] Tests: new `phase9g-r1-acceptance.spec.ts` (23) covering the
      245K/490K/500K/null matrix, manual-price preservation, ambiguous-schedule
      fallback, missing-input failure, the five per-field allocation
      re-analysis regressions, untouched-group refresh, fail-closed target,
      manual-from-start protection and review-fingerprint coverage. Full
      `bun run verify` green: 152 files / 1,909 tests, clean typecheck and
      build, `audit:bundle` clean, 11 pre-existing shadcn lint warnings only.
      All 21 SQL suites replayed green (Docker unavailable); no SQL changed.

#### R1 provenance / review-reopen acceptance patch

- [x] Root cause: `compositeTargetGroup()` did not map `vc:<id>.allocation` to
      the canonical `allocation` material group, so the consolidated allocation
      review fingerprinted a non-existent `row["allocation"]` and a material
      allocation edit could fail to reopen a resolved item. One line added to
      the accepted composite-target classification path; no review state is
      special-cased anywhere else.
- [x] Allocation field provenance now uses the REAL canonical field names —
      `allocationTreatment`, `targetPoId`, `relatesSpecifically`,
      `consistentWithAllocationObjective`, `allocationRationale` — so Task 4
      detects an edit at autosave and provenance means the same thing
      everywhere. No merge-only aliases remain.
- [x] Tests: `phase9g-r1-acceptance.spec.ts` now 35, adding immediate
      edit detection for all five fields, resolved-review reopening for all
      five (one `review_item_reopened` intent, original severity restored, no
      inherited resolution, no unrelated item reopened), composite
      classification of the allocation target and fingerprint isolation from
      `description`, `estimationMethod` and `usagePeriods`. Full
      `bun run verify` green: 152 files / 1,921 tests; `audit:bundle` clean;
      11 pre-existing shadcn warnings. All 21 SQL suites replayed green; no SQL
      changed.

### Phase 9G-R Task R1 — ACCEPTED and frozen

R1, including the acceptance patch and the provenance / review-reopen
acceptance patch above, is accepted and behaviourally frozen. No further R1
change is planned.

### Phase 9G-R Task R2 — Assumption-first AI drafting & review triage (implemented, awaiting acceptance)

- [x] New persisted review state and severity `assumed`, reason code
      `routine_assumption`. Assumed is non-actionable and non-blocking: it can
      never be affirmed, never manually resolved, never carries a resolution or
      affirmation metadata, never inherits a prior yellow/red resolution and
      never blocks finalization. The trusted SQL routines already reject it
      (affirm requires severity `yellow`, manual resolution requires `red`), so
      R2 needed no SQL at all.
- [x] Classification precedence unchanged where it matters: deterministic
      blocking conditions, source conflict, engine-support gaps and genuinely
      missing user input all outrank assumption treatment. Genuine ambiguity
      stays yellow.
- [x] Strict persisted normalization: a malformed assumed row fails closed and
      the whole payload is treated as unreadable rather than partially exposed.
- [x] One definition of outstanding accountant work — yellow + red. The two
      legacy `state !== "resolved"` count paths (`outstandingIssueCount` in the
      orchestrator, `outstandingReviewIssueCount` in the workspace store) now
      count only actionable items, and the workspace handler derives
      `reviewIssueCount` from the same trusted partition it uses for
      `reviewItems` / `assumptionItems`. Finalization semantics unchanged.
- [x] Accountant edits to the underlying accounting silently drop the affected
      assumption: no review event, no manufactured affirmation, no block.
- [x] Schema `arc.ai.schema.v5`: variable-consideration initial estimate
      (`initialEstimateBasis`, `initialEstimatedAmountInput`,
      `initialIncludedAmountInput`, `initialEstimateRationale`) with strict
      validation — a zero-at-inception basis requires exactly zero amounts and
      every other basis requires null amounts, keeping usage-as-incurred
      structurally distinct from a zero estimate (R3 owns the schedule work).
      Provisional standalone selling price via
      `stated_contract_price_assumption` + `proposedSspAmountInput`, never
      recorded as observable.
- [x] Prompt `arc.ai.prompt.v6`: assumption-first drafting, positive Step 1
      defaults, collectibility / distinctness / practical-expedient / noncash
      defaults, zero-at-inception versus usage-as-incurred rules, relevance-gated
      additional topics, no volume forecasting.
- [x] Merge policy: routine Step 1 affirmations, routine no-financing /
      no-noncash / no-consideration-payable, service-credit zero at inception,
      one consolidated provisional-SSP review item at
      `step4.provisionalSsp` (never one per obligation), deterministic
      duplicate-topic and duplicate-issue filtering.
- [x] Accountant-facing read-only "Routine assumptions" group in the review
      panel: reason, section, evidence and Guidance access, optional navigation
      to the underlying accounting; no Confirm, no Resolve, no "next issue"
      participation, no event, and nothing rendered when there are none.
- [x] Dedicated R2 suites with true RED → GREEN evidence:
      `phase9g-r2.spec.ts` (31), `phase9g-r2-counts.spec.ts` (7),
      `phase9g-r2-genomix.spec.ts` (8) plus shared `r2-fixtures.ts`. Reverting
      the assumption classification and the count definition failed 11 of them.
- [x] Synthetic Genomix R2 benchmark (no model call): full-term fixed
      consideration preserved, allocation behaviour preserved, routine
      conclusions separated from a small meaningful actionable queue, the
      provisional price visibly provisional and consolidated, the genuinely
      missing standalone selling price still red, duplicates collapsed.
- [x] Full `bun run verify` green: 155 test files / 1,967 tests, clean
      typecheck and production build, `audit:bundle` clean, 11 pre-existing
      shadcn lint warnings only. `guidance:check`: 116 approved cards, hash
      `352bcf79e7cff1753f353451d9b12bf7f7cb7840eae6fe7699fdcbace6425d56`.
- [x] Database untouched: all 21 SQL suites replayed green on a throwaway
      PostgreSQL (Docker unavailable); no migration, no schema, RLS, grant,
      routine or Cloud mutation; the frozen Phase 9G Task 9 migration remains
      `3013e5370b7a12e8d266ddf4332034968bc5cc3cefb66dcb307ac04db261c251`.
- [x] No OpenAI call and no Genomix live-model run.

### Phase 9G-R Task R3 — NOT STARTED

R3 (variable-consideration schedules and usage engine work) and R4 (UX
compression) have not begun.

#### R2 acceptance patch — assumption-target navigation

- [x] `src/routes/analysis/index.tsx`: the one-shot `review=<id>` intent now
      resolves against `reviewItems` AND `assumptionItems`, so a "Go to …"
      action in the Routine assumptions group opens the right section and
      scrolls to the exact anchor instead of being discarded as stale. This is
      the only place the two queues are read together: assumptions stay out of
      actionable counts, accordion "AI review" counts, next-issue, finalization
      blocking, Confirm/Resolve and review events.
- [x] New regressions: `src/components/arc/phase9g-r2-assumptions-panel.spec.tsx`
      (5) and `src/routes/analysis/phase9g-r2-assumption-navigation.spec.tsx`
      (4). RED proof: reverting the resolver failed the assumption navigation
      test; restoring it returned green.
- [x] Full `bun run verify` green: 157 files / 1,976 tests, clean typecheck and
      build, `audit:bundle` clean, 11 pre-existing shadcn lint warnings only.
      All 21 SQL suites replayed green; no SQL, RLS, grant, RPC or migration
      change; frozen Phase 9G migration unchanged; schema v5 / prompt v6
      unchanged; no OpenAI call. R3 and R4 remain NOT STARTED. R2 remains
      awaiting acceptance.

#### Post-R2 live regression patch (Genomix Test 02) — awaiting acceptance

Narrow application-layer corrections only. No migration, no Cloud mutation, no
OpenAI call, no Genomix live-model run. Schema stays `arc.ai.schema.v5`, prompt
stays `arc.ai.prompt.v6`. R3 and R4 remain NOT STARTED.

- [x] Defect 1 — review navigation landed at the top of `/analysis`. Root
      cause: the production router runs with `scrollRestoration: true`, and the
      navigation that strips the one-shot `review` parameter reset the scroll
      the effect had just performed; the scroll also ran before the destination
      section had mounted its content. `src/routes/analysis/index.tsx` now
      expands the destination section first, defers the scroll across two
      animation frames with a bounded wait for the real destination element
      (exact anchor first, owning section only as the fallback), and passes the
      router's own `resetScroll: false` on both the consume and stale-intent
      navigations. A short-lived focus treatment (`.arc-review-focus` in
      `src/styles.css`, with "Review this item" / "Resolve this item" for
      actionable items only) marks the destination and clears itself; it
      mutates no accounting and no review state, and an assumption never gains
      an actionable label. JSDOM cannot reproduce router scroll restoration —
      real-browser verification is manual: open Review & Finalize on an
      analyzed workspace and use each of Step 3 / Step 4 / Step 5 "Go to
      section", an exact "Go to field", and a Routine assumption "Go to …",
      confirming each lands on and briefly marks the target.
- [x] Defect 2 — zero-at-inception routine assumptions were incomplete.
      `src/lib/arc/ai/merge.ts` now forces `most_likely_amount`, writes a single
      $0 most-likely outcome with no probability, a $0 included amount, the
      retained constraint rationale, and an effective date taken from an
      authoritative canonical date (contract execution date, otherwise the
      earliest obligation service start). With no defensible canonical date it
      fails closed on the missing date instead of inventing one, and it never
      overwrites an accountant-owned inception assessment.
- [x] Defect 3 — a red "unsupported recognition method" item survived a genuine
      cure. `src/lib/arc/ai/edit-reconciliation.ts` now clears it when that exact
      canonical obligation carries a recognition method the deterministic engine
      supports. No affirmation or manual-resolution event is fabricated; blank,
      invalid and unrelated edits do not cure it.
- [x] Defect 4 — guest autosave reported "The autosave store is unavailable".
      Root cause: `arc_save_draft_with_ai_reconciliation` takes `FOR UPDATE` on
      the owner row with no `lock_timeout`, so an abandoned in-flight autosave
      leaves the row locked; every later save blocks, holding pooled
      connections, until PostgREST returns `PGRST003 — Timed out acquiring
      connection from connection pool`. Application half landed here: SQLSTATE
      `55P03` is recognised as contention (not a stale lock), retried exactly
      once after a short bounded pause, and otherwise surfaced as the retryable
      "Still saving elsewhere" state with edits intact, plus structured
      server-side failure logging that never reaches the browser. The database
      half (adding `SET LOCAL lock_timeout`/`idle_in_transaction_session_timeout`
      to the existing routine) is PROPOSED AND UNAPPLIED, awaiting migration
      approval.
- [x] Defect 5 — a temporary guest workspace sat on "Opening the saved
      analysis…". `src/components/arc/RevisionLifecyclePanel.tsx` now shows
      stable "Temporary workspace — Save this analysis to your account before
      finalizing a revision." copy and never offers finalization; authenticated
      saved, finalized and superseded revisions are untouched.
- [x] New RED→GREEN suites (18 tests):
      `src/routes/analysis/post-r2-navigation-focus.spec.tsx` (4),
      `src/lib/arc/ai/__tests__/post-r2-zero-inception.spec.ts` (4),
      `src/lib/arc/ai/__tests__/post-r2-recognition-cure.spec.ts` (4),
      `src/lib/arc/ai/__tests__/post-r2-autosave-contention.spec.ts` (4),
      `src/components/arc/post-r2-guest-lifecycle.spec.tsx` (2). RED proof:
      neutralising each of the five fixes failed 11 of the 18 new tests;
      restoring them returned all 18 green.
##### Post-R2 acceptance patch (two final gates)

- [x] Gate 1 — zero-at-inception ownership. The complete $0 assumption is now
      drafted only when the MATERIAL inception estimation judgment is genuinely
      unclaimed: estimation method unclaimed or ARC-owned, and the assessment
      empty across included amount, outcome amounts, outcome probabilities,
      most-likely designation and constraint rationale, judged with field
      provenance where present. A manually supplied effective date alone is not
      ownership. Where the assessment is accountant-owned ARC preserves it and
      uses the existing manual-value-preserved / missing-input review
      semantics instead of forcing the zero structure.
      `src/lib/arc/ai/__tests__/post-r2-zero-inception.spec.ts` now carries 11
      tests (untouched → complete valid $0 most-likely; accountant-owned
      expected-value method preserved with no partial rewrite; accountant
      probability never erased; accountant constraint rationale never
      overwritten; most-likely designation never overwritten; manual date
      preserved; valid untouched zero assumption still passes
      `buildVariableConsiderationInput`; no defensible inception date still
      fails closed). RED proof: reverting the guard failed 4 of 11.
- [x] Gate 2 — staged autosave timeout migration, PROPOSED AND UNAPPLIED:
      `supabase/pending/20260919043000_post_r2_autosave_lock_timeout.sql`
      (SHA-256 `873a59fe573c22d41ac06e199e66588e3f63cac8f7aee7c2c072800f367fb3ef`).
      It is a `create or replace` of `public.arc_save_draft_with_ai_reconciliation`
      alone, reproducing the accepted Task 4 body byte-for-byte with exactly two
      added statements immediately after `begin`, before validation and locking:
      `set local lock_timeout = '3s';` and
      `set local idle_in_transaction_session_timeout = '15s';`. Signature,
      return shape, SECURITY DEFINER, `search_path`, ownership validation, scope
      locking, actor derivation, lock ordering, optimistic-lock behaviour,
      canonical write, sidecar write, review-event append semantics and
      privileges are unchanged; no table, schema, RLS, grant, trigger or data
      change. NOT Cloud-applied — awaiting byte-level review.
- [x] Gate 3 — dedicated SQL regression
      **Harness correction (final):** contention is no longer orchestrated with
dblink from inside PostgreSQL — dblink dials out from inside the database
container, where the host-facing disposable URL is unreachable. The competing
session is now a second, independent host-side psql session driven by
`scripts/post-r2-contention.sh`, with a deterministic ready signal (the owner
row's xmax), FIFO-controlled holder lifetime and trap cleanup. SQL assertions
live in `supabase/tests/concurrency/*.sql`; the suite file keeps the routine
surface/privilege and idle-timeout source assertions. Hosted verification of
the 15s idle bound after Cloud apply is unchanged.

`supabase/tests/post_r2_autosave_lock_timeout.sql` (17 assertions): the
      bounds exist and precede validation/locking; SECURITY DEFINER,
      `search_path` and service-role-only execution unchanged; a competing
      transaction holding the owner row makes the save fail in bounded time with
      SQLSTATE `55P03`; the canonical draft, owner `lock_version`, AI sidecar and
      review-event trail are all untouched by the timed-out save; after the
      holder releases, the same save succeeds, the lock advances exactly once and
      exactly one audit event is appended; a stale expected lock still raises
      `40001` and changes nothing. Contention uses a genuinely concurrent
      `dblink` session. The 15s idle bound is asserted from the routine's source
      rather than by a wall-clock sleep, which would be flaky in the harness; it
      is to be confirmed by controlled hosted verification after Cloud apply.
      RED proof: replaying without the staged migration, the contended save never
      returns `55P03` — it blocks until an externally imposed statement timeout
      (`57014`), and the three bound assertions are absent.
- [x] `src/lib/arc/ai/__tests__/phase9g-release-gate.spec.ts` now asserts exactly
      one staged migration awaiting acceptance and that it is not duplicated into
      `supabase/migrations/`, instead of asserting an empty staging directory.
- [x] Full `bun run verify` green: 162 test files / 2,001 tests, clean typecheck
      and production build, `audit:bundle` clean, 11 pre-existing shadcn lint
      warnings only. `guidance:check`: 116 approved cards, hash
      `352bcf79e7cff1753f353451d9b12bf7f7cb7840eae6fe7699fdcbace6425d56`.
- [x] All 22 SQL suites (21 existing + the new contention suite) replayed green
      on a throwaway PostgreSQL with the staged migration applied last (Docker
      unavailable); no schema, RLS, grant, routine or Cloud mutation; frozen
      Phase 9G Task 9 migration unchanged at
      `3013e5370b7a12e8d266ddf4332034968bc5cc3cefb66dcb307ac04db261c251`.
- [ ] Real-browser verification of the five navigation variants — NOT performed
      here: it needs an analyzed workspace with review items in the connected
      Cloud project, and seeding that data is a Cloud data change this patch is
      not authorized to make. Manual steps are recorded under Defect 1.
- [ ] Cloud apply of the staged migration — blocked on byte-level acceptance.
- R3 and R4 remain NOT STARTED.

### Post-R2 Database Hardening — non-retryable conflict SQLSTATE (staged, awaiting byte-level review)

Incident: a PostgREST backend retried ARC-authored SQLSTATE `40001` exceptions,
producing hundreds of thousands of "the analysis changed since it was loaded"
errors and driving database CPU from ~1–2% to sustained high usage. `40001`
means "the database could not serialize this transaction, retry"; ARC's own
optimistic-lock and business conflicts are permanent for the request that hit
them and must never be retried.

- [x] RPC audit against the effective catalog (not source history): 20 public
      routines raised an ARC-authored `40001`, and one of them
      (`arc_commit_source_document_upload`) also caught it from a callee. Every
      one is an ARC optimistic-lock / business conflict; none is a genuine
      PostgreSQL serialization failure. Routines: `arc_acknowledge_ai_stale_sources`,
      `arc_affirm_ai_review_item`, `arc_apply_ai_run`, `arc_attach_guest_source_document`,
      `arc_attach_source_document`, `arc_commit_source_document_upload`,
      `arc_discard_amendment_draft`, `arc_finalize_revision`,
      `arc_migrate_guest_workspace_by_token`(+`_v2`,`_v3`),
      `arc_protect_revision_immutability`, `arc_remove_guest_source_document`,
      `arc_remove_source_document`, `arc_reset_amendment_draft`,
      `arc_resolve_ai_review_issue`, `arc_restore_pre_ai_run`,
      `arc_save_draft_with_ai_reconciliation`, `arc_stage_source_document_deletion`,
      `arc_start_amendment_revision`.
- [x] Staged migration `supabase/pending/20260919060000_post_r2_conflict_sqlstate.sql`:
      `CREATE OR REPLACE` of exactly those 20 routines, generated from their
      current effective definitions, with `'40001'` → `'PT409'` and nothing else
      changed. Signatures, return shapes, SECURITY DEFINER, `search_path`,
      ownership validation, scope locking, actor derivation, lock ordering,
      optimistic-lock behaviour, canonical/sidecar writes, review-event append
      semantics and privileges are identical; no table, schema, RLS, grant,
      trigger, index or data change. The approved autosave timeout hardening
      (`lock_timeout` 3s, `idle_in_transaction_session_timeout` 15s) is retained
      verbatim, and `supabase/pending/20260919043000_post_r2_autosave_lock_timeout.sql`
      is left byte-identical.
- [x] Mapping for `arc_save_draft_with_ai_reconciliation`: `PT409` → stale
      optimistic lock / reload conflict; `55P03` → transient contention, exactly
      one bounded retry; genuine `40001` → ordinary save failure; anything else →
      ordinary save failure. `55P03` is never mapped to a stale-version conflict.
- [x] Application boundary: `classifyAutosaveSaveError()` in
      `src/lib/arc/ai/autosave.store.server.ts`, plus `PT409` in
      `revisions.handlers.ts`, `guest.handlers.ts`, `review-actions.handlers.ts`,
      `runs.store.server.ts`, `workspace.store.server.ts` and
      `guest-workspace.store.server.ts`. Raw database codes and messages stay in
      server logs only.
- [x] New suites: `supabase/tests/post_r2_conflict_sqlstate.sql` (8 assertions,
      catalog-level plus two behavioural stale-lock proofs) and updated
      `phase8b`, `phase8e_guest_documents`, `phase9f_ai_lifecycle`,
      `phase9g_autosave_reconciliation`, `post_r2_autosave_lock_timeout`.
      New application spec `src/lib/arc/ai/__tests__/post-r2-conflict-sqlstate.spec.ts`
      plus genuine-`40001`-is-not-a-conflict regressions in the finalize and
      amendment-reset handler suites.
- [x] RED proof: without the staged conflict migration the new SQL suite fails 5
      of 8 assertions and `phase8b_document_lifecycle.sql` aborts on an
      uncaught `40001`; with it applied, all 23 SQL suites pass.
- [x] CI harness fixed: `scripts/run-sql-suites.sh` now applies every
      `supabase/pending/*.sql` to the fresh disposable CI database, in filename
      order, before the suites run. The contention test keeps its genuinely
      authenticated second PostgreSQL connection over `dblink` and is not
      weakened to source inspection. No credential is embedded anywhere.
- [x] Gate: 163 test files / 2,009 tests green, clean typecheck and production
      build, `audit:bundle` clean; `guidance:check` 116 cards, hash
      `352bcf79e7cff1753f353451d9b12bf7f7cb7840eae6fe7699fdcbace6425d56`;
      23 SQL suites green; frozen Phase 9G Task 9 migration unchanged at
      `3013e5370b7a12e8d266ddf4332034968bc5cc3cefb66dcb307ac04db261c251`;
      schema `arc.ai.schema.v5`, prompt `arc.ai.prompt.v6`; no Cloud mutation.
- [ ] Cloud apply of both staged migrations — blocked on byte-level acceptance.
- R3 and R4 remain NOT STARTED.

## Post-R2 Database Hardening — Cloud apply (authorized, complete)

Both reviewed staged migrations were applied to the connected Supabase project
on 2026-09-19 (the conflict-SQLSTATE migration was submitted in four sequential
parts because of tool payload limits; the resulting catalog is identical to the
reviewed file). Hosted verification:

- catalog: autosave routine carries lock_timeout 3s + idle_in_transaction_session_timeout 15s,
  both set before validation/locking; 20 routines now raise PT409; zero effective
  public ARC routines raise or catch an ARC-authored 40001; no SECURITY DEFINER
  routine lacks a fixed search_path; RPC execute remains service-role only.
- A (stale version): HTTP 409 / PT409 in 0.50s, nothing written, single request, no retry storm.
- B (contention): competing lock held on a disposable workspace -> 55P03 in 3.59s
  (3s bound + round trip), nothing written, no review event, no 504/pool exhaustion;
  after release the same save succeeded once (lock 2 -> 3).
- C (idle bound): present in the hosted routine and applied in the same SET LOCAL
  block proven effective by B; a wall-clock idle test cannot be induced through
  PostgREST, which never leaves the routine's transaction idle.
- operational: 15 connections, 0 idle-in-transaction, 0 lock waiters, no ARC 40001
  recurrence, CPU at background level. Test fixture deleted.

R3/R4 not started.

## Post-R2 Database Hardening — repository normalization (post-Cloud)

Applied and verified on the connected Supabase project; nothing remains staged.

Retired pending files (applied to Cloud, hashes preserved for audit history):

- `20260919043000_post_r2_autosave_lock_timeout.sql`
  `873a59fe573c22d41ac06e199e66588e3f63cac8f7aee7c2c072800f367fb3ef`
  applied as `supabase/migrations/20260919181822_09396f1f-a301-46cb-892f-11307c442134.sql`
  (byte-identical, same SHA-256).
- `20260919060000_post_r2_conflict_sqlstate.sql`
  `a7b1db368695870992d396fbd019a09c972d5aea03330afc7160f2a1596f6f72`
  applied as four parts split on routine boundaries:
  `20260919182118_0f2b88d8-edf9-459f-bf74-6f62c6e32545.sql` `d28de23e70491040b6c4b573757b55cfbff3a7cdb51a1c7a157ccf1d31e40064`
  `20260919182256_bc74f2ad-8bdb-4c2c-a80e-44cd413c933b.sql` `525c40f5be0690bb1c51221d658ca88951334245cf3294420b5f7dcfc384854e`
  `20260919182452_33edf847-c3f2-4853-be19-334c3068831e.sql` `253c558c664ea6e127100ac1da0791677e6887d569eee9dd08efb93444727305`
  `20260919182906_7d2f5f4a-90a4-446c-b848-b25c6d0ec34e.sql` `33e4bbda628d4d2df91a0b7e7f8a1e1fb8717d082fcae70ed2f7cf1df8839421`

`supabase/pending/` now holds zero `.sql` files; the generic pending loop stays in
`scripts/run-sql-suites.sh` for future staged migrations but is a no-op, so the SQL
gate can no longer mask an incomplete applied history.

Release gate (`phase9g-release-gate.spec.ts`) moved to the post-Cloud state: no
pending SQL migration, the five applied files frozen by hash, migrations replayed in
deterministic filename order, dollar-quote terminator recognised as `$function$;` or
`$function$` on its own line, both unsafe forms (`errcode = '40001'` and
`exception when sqlstate '40001'`) checked against the latest effective definitions,
which must now be zero, and a retained safety gate that the conflict migration
redefined 20 routines whose effective definitions are on PT409.

Evidence: with the old terminator-only-with-semicolon parser two routines still read
as 40001 offenders (`arc_set_ai_review_state`, `arc_affirm_ai_review_scope`) through
statement bleed-through; with the fixed parser the effective offender set is empty.
Migration history alone (no staged files) rebuilt a fresh disposable PostgreSQL to the
accepted Post-R2 state: 23 SQL suites plus the host-side contention driver green.
Application gate: 163/163 files, 2,011/2,011 tests (the gate spec gained two cases),
typecheck, lint, production build and bundle audit green. Task 9 SHA unchanged
(`3013e537…`), schema `arc.ai.schema.v5`, prompt `arc.ai.prompt.v6`, no Cloud mutation,
R3/R4 not started.

## Phase 9G-R3 — Progressive / Provisional Accounting Engine (IN PROGRESS)

R1, R2, the Post-R2 live regression patch and the Post-R2 database hardening remain
ACCEPTED AND FROZEN. R4 NOT STARTED. No Cloud database mutation. AI contract unchanged:
schema `arc.ai.schema.v5`, prompt `arc.ai.prompt.v6`.

### R3 Part 1 — deterministic progressive result model (complete, gate green)

New pure module `src/lib/asc606-progressive/`:

- `types.ts` — `CalculationState` (`complete` / `provisional` / `pending` / `blocked`),
  `PendingReason` (`provisional_ssp_confirmation`, `awaiting_transfer_date`,
  `awaiting_progress_actuals`, `awaiting_usage_actuals`,
  `awaiting_variable_consideration_event`), `PendingComponent`, `BlockedComponent`,
  `ProvisionalNote`, `ProgressiveResult<T>`, `mergeCalculationState`.
- `allocation.ts` — `allocateProgressively`: a provisional SSP is a review state, not a
  missing fact. Allocation blocks only when an SSP required for the denominator is
  absent, nonnumeric, zero or negative. No duplicate hard "missing SSP" intervention is
  raised for a usable provisional SSP. Allocation arithmetic is still the approved
  Phase 1 engine — never re-implemented.
- `recognition.ts` — `generateProgressiveRevenueSchedule` plus `recognizeInputMeasure`.
  Adds over-time INPUT MEASURE recognition (cumulative units / total expected units,
  exact integer scaling, cumulative-difference period revenue) and pending point-in-time
  recognition with an unknown transfer date. Per obligation,
  `allocated = scheduled + pending + blocked` is asserted; one obligation's pending
  future fact never removes another obligation's rows.
- `reconciliation.ts` — `reconcileProgressive`: price ties to allocation, each PO ties to
  recognized + pending + blocked, scheduled revenue ties to the schedule total, no amount
  is counted in both the recognition and the external pending layer, and a partial result
  can never present itself as complete.

Tests: `src/lib/asc606-progressive/__tests__/progressive.spec.ts`, 21 cases covering
matrix items A1–A5, D19–D26, E27–E31, F32/33/36/39, G40–G43/G45, on the Genomix synthetic
benchmark ($490,000 -> $446,000 / $29,600 / $14,400).

Gate after Part 1: 164/164 test files, 2,032/2,032 tests, typecheck, lint, production
build and bundle audit green. Frozen Task 9 SHA unchanged.

### R3 Part 2 — NOT YET IMPLEMENTED

Outstanding R3 scope: workflow draft fields and adapters for input-measure and
pending-transfer facts; usage/overage contract-rule vs actual-activity separation;
`specific_series_period` realized-event targeting; progressive billing schedule,
contract balances and journal entries; review/provenance/fingerprint integration for the
new material facts; narrow significant-financing normalization; the minimum Step 4 /
Step 5 / Balances / Journals UI states; the integrated Genomix R3 workflow fixture; and
browser acceptance.

## Phase 9G-R3 — Part 1 foundation hardening (COMPLETE, gate green)

Narrow hardening of the accepted progressive/provisional architecture (no redesign):

1. **Allocation validated at the recognition boundary.** `generateProgressiveRevenueSchedule()`
   now validates each PO's `allocatedCents` with the canonical `isValidCents` money utility
   before choosing pending/complete behaviour. An invalid allocation blocks only that PO
   (`allocation.invalid`), is never carried into a pending bucket, and never reaches the
   schedule. Covered for negative, fractional, non-finite, NaN and out-of-range amounts.
2. **Unknown transfer date is explicit.** `transferDateUnknown === true` + no date →
   `awaiting_transfer_date`; valid date + not marked unknown → recognize; marked unknown +
   date supplied → blocked (contradictory); no date + not marked unknown → blocked
   (`recognition.point_in_time.date_missing`). An ordinary missing input is no longer
   silently converted into a future-event assumption. Part 2's adapter must set
   `transferDateUnknown` only when the accepted workflow facts support it.
3. **Exactly-one recognition result per allocated PO.** `reconcileProgressive()` no longer
   synthesizes a blocked bucket for a missing recognition row. Missing rows, duplicate rows
   and recognition without allocation are reconciliation failures; the amount is reported as
   `unresolvedCents` and `reconciled` is false.
4. **Detail arrays reconcile to the per-PO buckets.** Per PO: pending[] sum, blocked[] sum and
   revenue-schedule rows must each equal the corresponding monetary summary; duplicate
   pending/blocked component identities fail reconciliation.
5. **Exact money range guarantees.** `sumPendingCents`, `sumBlockedCents` and all
   reconciliation totals route through `sumCents` / `bigIntToCents` instead of `Number(bigint)`.
6. **externalPending is transitional only** — documented in `reconciliation.ts`. Nonzero
   included specific-series-period VC must be modelled by the deterministic VC layer in Part 2
   and reconciled together with the transaction price.

RED→GREEN evidence: `src/lib/asc606-progressive/__tests__/part1-hardening.spec.ts` (19 tests).
With the hardening reverted in place, 15 of 19 failed; with it restored, 19/19 pass.
Gate: 165 test files / 2,051 tests green, typecheck / lint / production build / bundle audit clean.
AI contract unchanged (arc.ai.schema.v5 / arc.ai.prompt.v6). No Cloud mutation. R4 not started.

### R3 Part 2 — NOT YET IMPLEMENTED
workflow draft fields/adapters; usage rule vs actual activity; specific_series_period realized
targeting; deterministic VC layer inside transaction-price reconciliation; progressive billing,
balances and journals; review/provenance/fingerprint integration; significant-financing
normalization; minimum R3 UI states; integrated Genomix R3 fixture; browser acceptance.

## Phase 9G-R3 — Part 2 (COMPLETE, gate green; awaiting independent review)

Stages A-G delivered on top of the accepted, frozen Part 1 foundation.

### Stage A — workflow facts + deterministic variable-consideration layer
- `src/lib/asc606-workflow/types.ts`: additive canonical draft facts only —
  `PoDraft.transferStatus`, `overTimeMeasure`, `totalExpectedUnitsInput`,
  `unitLabel`, `progressEvents[]`; `VcMeterDraft.includedQuantityInput`;
  `VcComponentDraft.seriesPeriods[]`, `realizedEvents[]`, `billOnRealization`;
  new `ProgressEventDraft`, `VcSeriesPeriodDraft`, `VcRealizedEventDraft`.
  No derived math is stored in the draft.
- `src/lib/asc606-progressive/variable-consideration.ts`: explicit deterministic
  VC layer with stable identities (`vc:<componentId>:<eventId>`), separating
  contractual rule, estimate, constraint/included amount, realized event,
  allocation treatment and target. `externalPending` is no longer the model:
  nonzero included VC is inside the transaction price and inside reconciliation.
- `src/lib/asc606-workflow/r3-adapter.ts`: draft -> engine input. `transferDateUnknown`
  is set only when the accountant actually recorded "not yet transferred".

### Stage B — specific_series_period + usage
- Series-period amounts bypass the general SSP pool and adjust only their own
  period; invalid parent/period/date fails closed. A $0 no-trigger estimate
  fabricates no period, no billing event and no probability, and leaves the
  fixed allocation unchanged.
- `usage.ts`: contractual rule (meters, rates, tier thresholds, billing cadence)
  separated from accountant-owned actuals; no actuals means no quantity, no
  invoice, no revenue and no error.

### Stage C — progressive billing / balances / journals
- `billing.ts`, `balances.ts`, `journals.ts`, `variable-recognition.ts`,
  `contract.ts`. Billing readiness is independent of recognition readiness;
  balances expose known billings, known revenue and the explicit unresolved
  amount; journals emit only known events and report pending accounting events.
- Contract-level reconciliation proves price -> allocation layers -> recognized
  + pending + blocked with no disappearance and no double counting.

### Stage D — review / provenance / identity
- `review.ts`: deterministic material-fact keys and fingerprints
  (recognition method, transfer status, input-measure denominator, progress
  events, VC treatment/target, series-period target, usage actuals, realized VC
  amounts), targeted diff, carry-forward of unrelated conclusions, orphan-detail
  rejection.

### Stage E — significant financing
- `financing.ts`: one-year-or-less + accepted expedient -> no adjustment;
  unconfirmed policy -> review matter only (Steps 4/5 still calculate);
  beyond one year -> fails closed. No present-value engine.

### Stage F — minimum UI
- `src/components/asc606-workflow/ProgressiveOutputs.tsx` plus R3 input controls
  in `Step5Recognition.tsx` (measure of progress, contracted units, transfer
  status). No R4 polish.

### Stage G — integrated Genomix acceptance
- `__tests__/genomix-r3.ts` + `__tests__/part2-r3.spec.ts` (32 tests).

### Gate
166 test files / 2,083 tests green; typecheck, lint (0 errors), production
build and bundle audit green; `bun run verify` green. RED->GREEN: routing the
series exception through the general pool fails 8 of the 32 Part 2 tests.
No DB-facing code changed, so no SQL suite run was required and the Cloud
database is unchanged. Schema `arc.ai.schema.v5`, prompt `arc.ai.prompt.v6`
unchanged. R4 NOT STARTED. R3 is not self-accepted.
