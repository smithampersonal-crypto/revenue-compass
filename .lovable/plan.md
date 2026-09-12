# Phase 8 — Source Documents + Private Storage

Adopt the uploaded Phase 8 implementation plan as the controlling specification, executed in the seven reviewed stages it defines. This plan covers the first stage in detail (Phase 8A, Tasks 1–2) and records the remaining stages as the agreed sequence.

## Stage sequence (one review gate each)

1. **8A Data foundation** — Tasks 1–2: schema, private bucket, RLS/grants, immutability triggers, trusted lifecycle RPCs, SQL suites.
2. **8B Private PDF pipeline** — Task 3: server-only PDF validation + SHA-256, signed upload intent, promotion, signed read.
3. **8C Authenticated documents UX** — Task 4: Source Documents view, upload/add-existing dialogs, lock-version adoption.
4. **8D Revision provenance** — Task 5: create / reset / discard / finalize source-set semantics.
5. **8E Guest documents & migration** — Task 6.
6. **8F Deletion & operations** — Task 7: durable Storage deletion queue, guest expiry, account deletion, protected hourly worker route.
7. **8G Hardening & acceptance** — Task 8: full verification, docs, hosted acceptance.

No stage starts until the previous one is reviewed and its Critical/Important findings are closed.

## Stage 8A scope (this implementation)

Test-first, red → green, exactly as the uploaded plan specifies.

- New SQL suite `supabase/tests/phase8a_source_documents_schema.sql` written first and run RED, using the existing `arc_test_results(assertion text, passed boolean not null)` + `passed is not true` gate pattern; the 18 listed assertions (bucket privacy, owner/other-user/anon RLS, no direct DML for `authenticated`, contract XOR guest ownership, per-owner SHA-256 duplicate rules, cross-contract association rejection, technical-metadata immutability, finalized-history metadata lock with archive still allowed, finalized source-set immutability, draft mutation permitted from trusted context).
- Migration `20260912180000_phase8_source_documents_schema.sql`: private `arc-source-documents` bucket (10 MB, `application/pdf` only), tables `source_documents`, `revision_source_documents`, `guest_source_document_selections`, `document_upload_intents`, `storage_deletion_queue`, plus ownership/immutability triggers, RLS policies, explicit GRANTs, indexes and duplicate constraints.
- Migration `20260912181000_phase8_document_lifecycle.sql`: trusted `SECURITY DEFINER` functions `arc_prepare_source_document_upload`, `arc_commit_source_document_upload`, `arc_attach_source_document`, `arc_remove_source_document`, `arc_stage_source_document_deletion`, and the queue claim/complete/retry primitives — each with a fixed `search_path`, internal ownership derivation, and execution revoked from `public`/`anon`/`authenticated` unless intentionally caller-scoped.
- Second SQL suite `supabase/tests/phase8b_document_lifecycle.sql` covering the RPC behaviors (duplicate-safe commit, idempotent re-commit, attach/remove draft-only rules, hard-delete staging restricted to documents never used in finalized history, queue claim/retry).
- Regenerate `src/integrations/supabase/types.ts` after the migrations.
- Update `roadmap.md` with the Phase 8 stage list and 8A status.

No UI, no server functions, no PDF parsing in this stage.

## Invariants held throughout

- `src/lib/asc606*` engines and sample fixtures are never modified.
- Phase 7 persistence, revision lifecycle, finalization snapshots, auth and account deletion behavior are preserved; document associations live beside `canonical_inputs`, never inside them.
- Service-role material stays server-only and `bun run audit:bundle` stays clean.
- Finalized and superseded revision source sets remain database-enforced immutable.

## Technical notes

- The `pdfjs-dist` parse boundary (stage 8B) must run inside server handlers only and be checked for Cloudflare Worker compatibility before it is adopted; if the bundled build is not Worker-safe, that is escalated at the 8B gate rather than worked around in the client.
- `FEATURES.SOURCE_DOCUMENTS` stays `true`; `src/routes/analysis/documents.tsx` keeps its current placeholder until stage 8C replaces it.
- Database suites need `SUPABASE_DB_URL`/local Supabase. Where the sandbox cannot run them, the suites are still committed and run against the remote project, and any unexecuted suite is reported explicitly in the stage report.
- Each stage report returns: files changed; new/modified SQL functions and tables; focused test counts; verification status; environment limitations; confirmation that engines and fixtures were untouched.
