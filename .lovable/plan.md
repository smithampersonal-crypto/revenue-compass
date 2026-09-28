# Recruiter-v1 Horizon sample consistency patch (PLAN ONLY)

No implementation, publish, AI run or migration until approved.

## 1. Confirmed root cause

- `src/routes/analysis/documents.tsx` line 64: `persistence.mode === "guest"` returns `GuestSourceDocumentsWorkspace` first. The static Horizon card is only reached at line 75 for `mode === "sample"` (Home → Try the Sample).
- `createTemporaryAnalysis` (`guest.functions.ts` line 106) handles `sample:horizon` by seeding only the accounting draft (`createDemoDraftIfKnown`) through `createAnalysisHandler`. No `source_documents` row or `guest_source_document_selections` row is created.
- So the New Analysis Horizon analysis is a guest workspace with zero owned documents, and the guest view correctly reports "none". The trace in the brief is confirmed.

## 2. Proposed source-document lifecycle

The Horizon PDF becomes a **real guest source document owned by that one temporary workspace**. It goes through ARC's existing upload pipeline, run on the server inside the same Open-sample POST:

```text
click Open sample (POST createTemporaryAnalysis, origin sample:horizon)
  -> createAnalysisHandler            (unchanged: workspace + seeded draft)
  -> load canonical bytes             (public/samples/horizon-logistics-saas-order-form.pdf)
  -> verify pinned SHA-256            (a39c8883...9c70); mismatch = fail closed
  -> initiateUploadHandler            (existing intent, bound to this workspace's derived token hash)
  -> private storage put              (pending path in arc-source-documents, existing helper)
  -> finalizeUploadHandler            (existing server-side PDF read: size, pages, sha256)
  -> attach selection                 (existing arc_attach_guest_source_document)
  -> return analysisId
```

- Display name: `Horizon Logistics — SaaS Order Form & Billing Schedule`, with the original filename kept.
- The accounting draft is untouched ($153,000, schedules as accepted). There is no model call, no `ai_runs` row and no allowance change.
- Only `sample:horizon` gets a document. Other samples (internal fixtures), blank and upload origins are unchanged.

## 3. Representation and duplication

- There is still one tracked canonical file, `public/samples/horizon-logistics-saas-order-form.pdf`. No second fixture is added to the repository.
- Each temporary Horizon analysis gets its own private storage copy and its own `source_documents` row (`guest_workspace_id` = that workspace). The existing unique index on `(guest_workspace_id, sha256)` prevents a duplicate inside one workspace. Copies are never shared across workspaces, so there is no shared ownership.
- The copy is created only when Open sample is clicked, never on GET, loader or render.

## 4. How Save to My Contracts keeps it

No change is needed. The accepted save RPC (`arc_migrate_guest_workspace_by_token_v3`) already:
- moves the workspace's selected guest documents to the new contract;
- inserts `revision_source_documents` for revision 1;
- clears the guest selections.

The document therefore stays on the saved revision because the standard path carries it, with no sample-specific logic.

## 5. 9-hour cleanup

No change is needed. When the workspace expires, `arc_delete_expired_guest_workspaces` cascades that workspace's own document rows and queues the private objects for the existing storage-deletion worker (hourly maintenance). A document already moved to a saved contract no longer belongs to the guest workspace, so cleanup cannot touch it. Other workspaces have their own copies.

## 6. Security

- The per-analysis HMAC-derived credential, session ownership, 9-hour expiry, the private bucket, server-only document RPCs and save ownership checks are all unchanged.
- The copy lives in the private bucket and is read only through the existing signed guest read URL. The public sample PDF does not open any new read path for uploaded PDFs.
- The server never takes the bytes from the browser. It loads them itself and checks the pinned hash.

## 7. Files expected to change

- `src/lib/arc/persistence/guest.functions.ts`: after creation, call a new seeding helper only for `sample:horizon`.
- New `src/lib/arc/documents/horizon-sample-source.server.ts`: canonical path, display name, pinned SHA-256, and the server-side run of the existing initiate → put → finalize → attach steps.
- Tests (below). `documents.tsx`, the Home sample, the sample list, accounting, AI and migrations are unchanged.

## 8. Tests

New `src/lib/arc/documents/__tests__/horizon-sample-source.spec.ts` and `src/components/arc/new-analysis-horizon-source.spec.tsx`:
1. One click creates exactly one temporary analysis.
2. Its Source Documents list shows the Horizon display name.
3. The document is selected (included) immediately.
4. The read URL serves bytes whose SHA-256 equals the canonical file.
5. No `ai_runs` row is created and the allowance is unchanged.
6. Two Horizon analyses in the same session have distinct document rows and objects.
7. Saving creates revision 1 with the Horizon document linked.
8. Sibling Recent analyses are unchanged.
9. Expiring or deleting one workspace leaves the other workspace's copy and the saved contract's copy intact.
10. Home → Try the Sample still shows the same static card (existing test kept).
11. Blank temporary analyses and non-Horizon origins get no document.
12. Hash mismatch fails closed, and existing upload/manual tests still pass.

SQL: add `supabase/tests/phase3e_horizon_sample_source.sql` covering items 6, 7 and 9 against the existing RPCs (rolled back, synthetic data).

## 9. SQL/schema change

None expected. The existing tables and RPCs cover creation, selection, save migration and expiry.

## 10. Stop conditions

Stop and report before continuing if any of these happen:
- The finalize step cannot accept a server-placed pending object without an RPC change.
- The canonical bytes cannot be loaded reliably on the server without adding a second copy of the file.
- The save RPC turns out not to move guest selections to revision 1.
- Any part would touch accounting, allowance or access rules.

## Decisions needed

1. **Recent Analyses label.** Recent shows the first source document's name when one exists. A seeded document would change a Horizon row's source from "Sample — Horizon" to the document name. Choose: keep "Sample — Horizon" for `sample:horizon` rows (a small display rule in Recent), or accept the document name.
2. **Byte source on the server.** Choose: fetch the canonical file from the site's own address and check its pinned hash (no repository change), or bundle it into the server code at build time from the same tracked file (no network dependency).
3. **Failure behaviour.** If seeding fails, either (a) fail the whole Open-sample click and create nothing (recommended), or (b) create the analysis without the document.
