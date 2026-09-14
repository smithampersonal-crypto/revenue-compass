# Phase 8 — Source Documents: acceptance record

Scope: private PDF storage for ARC contracts (8A–8G). ARC makes **no accounting
judgment** from a PDF; documents are evidence kept alongside the analysis.

Status legend: **Accepted** (verified automatically and, where stated, in a
hosted browser) · **Human** (must be confirmed by a reviewer).

---

## 8A Data foundation

| Requirement | Implementation | Evidence | Status |
| --- | --- | --- | --- |
| Documents, revision links, guest ownership, upload intents, deletion queue | `supabase/migrations/*` (8A) | `supabase/tests/phase8a_source_documents_schema.sql` | Accepted |
| Ownership chain document → contract → customer → owner | `source_documents` RLS policy | `phase8g_hardening.sql` 10 | Accepted |
| Guest tables and the deletion queue are server-only | grants + no policies | `phase8g_hardening.sql` 06, 07, 11 | Accepted |

## 8B Private PDF pipeline

| Requirement | Implementation | Evidence | Status |
| --- | --- | --- | --- |
| Private bucket, no public object access | `arc-source-documents` (private, 10 MB) | `phase8g_hardening.sql` 12, 13, 14 | Accepted |
| Server resolves and authorizes the path; browser names a document, never a path | `documents.handlers.ts` (`documentReadUrlHandler`), `storage.server.ts` | `__tests__/document-access.spec.ts` | Accepted |
| 15-minute signed read TTL | `SIGNED_READ_TTL_SECONDS = 900` | `document-access.spec.ts` | Accepted |
| Opaque paths `pending/<uuid>.pdf`, `documents/<uuid>.pdf`, never reused | `arc_prepare_source_document_upload` | `phase8b_document_lifecycle.sql` | Accepted |
| PDF only, ≤10 MB, ≤500 pages, unencrypted, extractable text, server-derived SHA-256, no OCR, validation text discarded | `validation.server.ts` | `__tests__/validation.spec.ts`, `upload-transport-integrity.spec.ts` | Accepted |
| Browser `File.size` diagnostic only; server validates returned bytes; one retry for short/empty or first `invalid_pdf`; semantic failures terminal | `documents.handlers.ts` | `upload-transport-integrity.spec.ts`, `retry-cleanup.spec.ts` | Accepted |
| Recovered upload yields exactly one document and one stored object | commit RPC + promotion | `phase8b_document_lifecycle.sql`, `retry-cleanup.spec.ts` | Accepted |
| Diagnostics hold no PDF bytes or contract text | `upload_diagnostics` fields | `upload-transport-integrity.spec.ts` | Accepted |

## 8C Authenticated documents UX

| Requirement | Implementation | Evidence | Status |
| --- | --- | --- | --- |
| Upload / View / Download / Add / Remove / metadata / archive / delete | `src/components/arc/documents/*`, `workspace.functions.ts` | `documents-handlers.spec.ts`, component specs | Accepted |
| Identity always server-derived, never browser-supplied | `caller-scope.ts` + `requireSupabaseAuth` | `__tests__/caller-scope.spec.ts`, `phase8g_hardening.sql` 15–19 | Accepted |
| Zero-customer "Upload Contract PDF" path | My Contracts actions | UI regressions (8E acceptance) | Accepted |

## 8D Revision provenance

| Requirement | Implementation | Evidence | Status |
| --- | --- | --- | --- |
| New revision inherits the prior finalized source set | `arc_start_amendment_revision` | `phase8d_revision_source_provenance.sql` | Accepted |
| Reset restores canonical inputs and the exact source set | `arc_reset_amendment_draft` | `phase8d_revision_source_provenance.sql` | Accepted |
| Discard removes draft associations only | `arc_discard_amendment_draft` | `phase8d_revision_source_provenance.sql` | Accepted |
| Finalize freezes the set (zero PDFs is valid) | `arc_finalize_revision` | `phase8d_revision_source_provenance.sql` | Accepted |
| Historical associations immutable; no individual hard delete; archive is presentation only | protection triggers | `phase8g_hardening.sql` 28, 29, 30 | Accepted |
| Lock ordering for finalize vs. document deletion | 8D migration | `phase8d_revision_source_provenance.sql` (structural, single-session harness) | Accepted |

## 8E Guest documents and migration

| Requirement | Implementation | Evidence | Status |
| --- | --- | --- | --- |
| Temporary workspace documents, 9-hour lifetime, HttpOnly credential | `guest-documents.functions.ts`, `guest.ts` | `phase8e_guest_documents.sql` | Accepted |
| One workspace cannot reach another's documents | guest RPCs | `phase8g_hardening.sql` 20, 21, 22 | Accepted |
| Migration keeps the same row, path, hash, metadata and associations | `arc_migrate_guest_workspace_by_token_v2` | `phase8g_hardening.sql` 23, 24 | Accepted |
| Retired credential loses access after migration | same | `phase8g_hardening.sql` 25 | Accepted |
| Lost response replays the same contract, no duplicate | same | `phase8g_hardening.sql` 26 | Accepted |
| Save under an existing customer or a new one | Save dialog + `_v2` RPC | `phase8e_acceptance.sql`, UI specs | Accepted |

## 8F Deletion and operations

| Requirement | Implementation | Evidence | Status |
| --- | --- | --- | --- |
| Every deletion path queues Storage durably before relational deletion | `before delete` triggers + lifecycle RPCs | `phase8f_maintenance.sql` | Accepted |
| Delete Draft keeps the customer, removes a never-finalized hierarchy | `arc_delete_initial_draft_contract` | `phase8f_maintenance.sql`, `phase8e_acceptance.sql` | Accepted |
| Discard Draft preserves finalized history and documents | `arc_discard_amendment_draft` | `phase8f_maintenance.sql` | Accepted |
| Migrated document survives guest expiry | guest cleanup | `phase8f_maintenance.sql`, `phase8g_hardening.sql` 27 | Accepted |
| Queue jobs terminal; already-absent resolves; failures stay durable | `arc_queue_storage_object`, worker | `phase8f_maintenance.sql` 28–31, `maintenance.spec.ts` | Accepted |
| Upload lifetimes: ARC intent 1 h · signed upload capability ~2 h · Storage cleanup ~2 h 15 m | `arc_cleanup_stale_upload_intents` | `phase8f_maintenance.sql` 32–34 | Accepted |
| Maintenance endpoint: constant-time secret, closed when unset, counts only | `src/routes/api/public/maintenance.ts` | `maintenance.spec.ts` | Accepted |

## 8G Hardening

| Requirement | Evidence | Status |
| --- | --- | --- |
| SECURITY DEFINER functions pin `search_path` | `phase8g_hardening.sql` 01 | Accepted |
| Trusted RPCs are service-role only | 02, 03, 04 | Accepted |
| Browser roles hold no `TRUNCATE`/`REFERENCES`/`TRIGGER` (narrowed in 8G) | 05 | Accepted |
| RLS enabled on every ARC table | 09 | Accepted |
| Browser bundle free of service-role key, maintenance secret, trusted RPC names, server-only stores and the PDF parser | `scripts/audit-bundle.sh` | Accepted |

---

## Hosted acceptance

| Journey | Status |
| --- | --- |
| Guest: fresh session → temporary analysis → upload text PDF → document appears → View succeeds | Accepted (hosted top-level run) |
| Authenticated migration: guest analysis with PDF → sign in → Save to My Contracts (existing or new customer) → reopen → View + Download the same PDF | **Human** — sign-in lives on an external Supabase project; no session can be created in the build environment |
| Authenticated direct: My Contracts → Add a contract → Upload Contract PDF → Save → reopen → View/Download | **Human** — same reason (the zero-customer variant is covered by automated UI tests) |

## Known environment limitations

- The SQL harness runs in a **single database session**. Lock-ordering and
  claim assertions are structural, not genuine multi-session races.
- `bun run db:test` requires a local Supabase database; in the build sandbox the
  SQL suites are confirmed through GitHub Actions.

## Manual production configuration still required

1. Enable `pg_cron` and apply `supabase/schedules/arc-hourly-maintenance.sql`
   (the authoritative hourly trigger for upload cleanup and guest expiry).
2. Set repository secrets `ARC_MAINTENANCE_URL` and `ARC_MAINTENANCE_SECRET`
   so `.github/workflows/maintenance.yml` can drain the Storage deletion queue,
   and set `ARC_MAINTENANCE_SECRET` in the deployed environment.
3. Supabase auth: leaked-password protection is currently disabled (project
   setting, unrelated to Phase 8).

See `docs/operations.md` for the full operational description.
