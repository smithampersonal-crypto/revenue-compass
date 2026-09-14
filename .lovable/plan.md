# Fix: "could not be read as a PDF" when uploading while signed in

## What the records show

I checked the real upload records and the file store for tonight's attempts:

- The rejected attempt (00:26) went through the **temporary-workspace** upload route, not the signed-in contract route — its record has no contract attached. So the two attempts you compared may have used the *same* code path, and the difference is something else.
- The same file name uploaded successfully at 23:55 (47,654 bytes) and again earlier at 23:18.
- For the rejected attempt no stored file remains, because ARC deletes the uploaded file as soon as it rejects it. That deletion is also why we currently cannot tell *why* it was rejected: no size, no reason, nothing kept.

So right now the evidence cannot distinguish "the file arrived damaged or incomplete" from "the PDF reader genuinely refused these bytes". The plan closes that gap first, then fixes the proven cause.

## Step 1 — Reproduce directly (fastest route)

Send me the exact PDF you uploaded. I will run it straight through ARC's PDF checker in isolation. Two outcomes:

- It is rejected → the fault is in the PDF reader configuration, and I fix that.
- It passes → the file was damaged in transit during the signed-in upload, and Step 2's evidence pins down where.

## Step 2 — Keep evidence when an upload is rejected

Today a rejection leaves no trace. Change that, minimally:

- Record on the upload record: the rejection reason, the exact number of bytes ARC received, whether the bytes began with a valid PDF marker, and the checksum.
- Keep the rejected file for a short quarantine period instead of deleting it immediately, still private, still queued for deletion afterwards, so the bytes ARC actually received can be compared against the file on your machine.

This is deliberately additive: no change to what is accepted, to storage privacy, or to the temporary-workspace flow.

## Step 3 — Fix the proven cause

Two candidates, and the evidence from Steps 1–2 decides which:

- **Damaged/short upload:** the byte count will not match your file. Fix at the upload boundary: confirm the stored object's size against the browser's file size before validating, and fail with a clear "the upload did not finish, please try again" instead of a misleading "not a readable PDF".
- **Reader rejects a valid PDF:** the byte count matches. Fix in the PDF reader's server configuration (the exact reader error name will be in the recorded reason).

## Step 4 — Regression test and verification

- A test that proves a short/truncated upload reports an upload failure, not a PDF-format rejection.
- A test covering whichever cause is proven, using the real validator.
- Full run: application tests, type check, lint, build, bundle audit.

## Out of scope

No changes to the ASC 606 engines or samples, to accepted PDF limits (10 MB / 500 pages / text-based), to the private-storage model, or to any Phase 8E acceptance-patch work already in progress.

## Technical notes

- Evidence source: `document_upload_intents` joined to `storage.objects`; the 00:26 row is `state = failed`, `contract_id IS NULL`.
- Rejection currently returns `pdfValidationFailure("invalid_pdf")` from `validatePdfBytes` in `validation.server.ts`; `discardPendingObject` in `documents.handlers.ts` removes the blob immediately afterwards.
- Diagnostics belong on the intent row (new nullable columns) written inside the existing failure branch, before discard — never surfaced to the browser.
- Quarantine reuses the existing `storage_deletion_queue` semantics rather than adding a second cleanup mechanism.
