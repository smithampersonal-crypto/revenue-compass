# Fix: "could not be read as a PDF" on a PDF that is actually fine

Scope: inside the open Phase 8E acceptance work. Phase 8F is not started.

## What I have established

- **Your PDF is valid.** Run through ARC's own checker: 47,654 bytes, 4 pages, text readable, accepted — three times in a row.
- **The same file already succeeded in ARC at 23:55** and failed at 00:26, so the problem is intermittent, not file-specific.
- **The rejected attempt left no evidence** — ARC deletes the file the instant it rejects it and records nothing about why.

Most likely the copy ARC read back from private storage was not the copy that was uploaded, and the generic "not a readable PDF" message hid that. The plan proves it rather than guessing.

## Step 1 — Declared size travels with the upload

The upload record gains a **declared size**, filled in from the size of the file chosen in the browser. It is strictly a transport-integrity expectation: it never decides anything about the document. The bytes the server reads back stay the only source of checksum, size, page count and validity.

## Step 2 — Distinguish an unfinished upload from a bad PDF

Before the PDF reader is asked:

- Compare bytes read back against the declared size. A mismatch (including empty) is an **unfinished upload**, not a format problem.
- Look for the PDF signature anywhere in the first 1,024 bytes — not only at byte zero.
- A correct size with no signature stays a **possible format problem**, not automatically a transport failure.

An unfinished upload shows "That upload did not finish — please try again," so the same file can be retried cleanly.

## Step 3 — One read-back retry

Read the bytes from private storage a second time when the first attempt is empty, short, size-mismatched, **or** rejected as an unreadable PDF. No retry for password-protected, too large, too many pages, or no extractable text — those are genuine decisions about the document.

If the second read validates, the upload continues straight through the existing path — same upload record, one document, one stored file, no duplicate. If both reads fail, the upload record becomes terminal first and the existing durable cleanup runs exactly as today.

## Step 4 — Keep diagnostics for both attempts

Recorded on the upload record even when the second attempt succeeds: declared size, observed size, server checksum, whether the PDF signature was present, the rejection code, and the attempt number — for both reads. Never any PDF text or raw bytes, and never shown to the visitor.

## Step 5 — Tests

1. Declared 47,654 bytes, short read back → unfinished upload, not a format rejection.
2. Short first read, complete valid second read → success.
3. Full-size header-valid first read rejected as unreadable, valid second read → success.
4. Identical full-size bytes rejected twice → genuine format rejection.
5. Password-protected and no-text → no retry.
6. Retry success creates exactly one document record and one stored file.
7. Diagnostics record the first-attempt failure even when the second succeeds.
8. The supplied Horizon/Vela profile (47,654 bytes, 4 pages) stays accepted.

Then the full run: application tests, type check, lint, build, bundle audit, and the existing database suites.

## Out of scope

No change to the ASC 606 engines or samples, to the accepted limits (10 MB, 500 pages, text-based), to the private-storage model, to duplicate detection, or to the other open Phase 8E acceptance items. Phase 8F is not begun.

## Technical notes

- Migration: `document_upload_intents` gains nullable `declared_byte_size bigint` plus diagnostics columns (`read_attempts int`, `diagnostics jsonb`). No grants change — the table stays server-only.
- `initiateDocumentUpload` / `initiateGuestDocumentUpload` accept `declaredByteSize` (positive int, ≤ `MAX_DOCUMENT_BYTES`); `initiateUploadHandler` stores it on the intent and never forwards it to `arc_prepare_source_document_upload`.
- New `upload_incomplete` failure code in `types.ts` with its own message; `validatePdfBytes` keeps its current contract, and the size/signature pre-check plus retry loop live in `finalizeUploadHandler` so both callers get them.
- Signature scan: `indexOf("%PDF-")` within the first 1,024 bytes.
- Retry re-calls `deps.storage.download`; the intent stays `pending` across both reads, so Phase 8B retry-safety, prepare/duplicate/promote/commit ordering and `discardPendingObject` behaviour are unchanged.
- Diagnostics written through a new store method in the failure and retry branches, before `markIntentFailed` / discard.
