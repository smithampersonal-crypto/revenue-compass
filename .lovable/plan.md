# Fix: "could not be read as a PDF" on a PDF that is actually fine

## What I have established

- **Your PDF is valid.** I ran the exact file through ARC's own PDF checker: 47,654 bytes, 4 pages, text readable, accepted — three times in a row. Nothing is wrong with the document.
- **The same file already succeeded in ARC at 23:55** (stored at the same 47,654 bytes) and failed at 00:26, so this is intermittent, not file-specific.
- **The rejected attempt was recorded against a temporary workspace, not a saved contract.** So "signed in vs guest" is probably not the real difference — both attempts used the same upload route.
- **The rejection left no evidence.** ARC deletes the uploaded file the instant it rejects it and records no reason, no byte count, no checksum. That is why the cause cannot be named yet.

The most likely explanation is that the copy ARC read back from private storage was not the copy you uploaded — short, empty, or not yet fully stored — and the generic "not a readable PDF" message hid that. The plan proves or disproves this rather than guessing.

## Step 1 — Never report a transport problem as a bad PDF

Before the PDF reader is even asked, check the bytes ARC read back:

- Compare the number of bytes read back with the size the upload recorded. A mismatch is an upload problem, not a format problem.
- Check the bytes begin with a PDF marker. If they do not, this is a transport problem.
- In either case, show "That upload did not finish — please try again." and let the visitor retry the same file cleanly, instead of the misleading format message.

## Step 2 — Retry the read-back once before rejecting

If the bytes read back look wrong, fetch them once more from private storage before deciding anything. A file that is momentarily not fully visible then reads correctly and the upload simply succeeds.

## Step 3 — Keep evidence when an upload is genuinely rejected

Record on the upload record, inside the existing failure path: the rejection reason, the exact bytes received, whether the PDF marker was present, and the checksum. Private, never shown to the visitor. If this ever happens again, the record says immediately whether the bytes arrived intact.

## Step 4 — Tests and verification

- A test proving truncated or empty read-back bytes produce the upload-failure message, not the format rejection.
- A test proving a first bad read-back followed by a good one succeeds without a duplicate document.
- A test proving your actual PDF's byte profile is accepted.
- Full run: application tests, type check, lint, build, bundle audit; plus the existing database suites.

## Out of scope

No change to the ASC 606 engines or samples, to the accepted limits (10 MB, 500 pages, text-based PDFs), to the private-storage model, to duplicate detection, or to the Phase 8E acceptance-patch work still open.

## Technical notes

- `validatePdfBytes` in `validation.server.ts` returns `pdfValidationFailure("invalid_pdf")` for any `pdf.js` load error; the new size/header pre-check happens in `finalizeUploadHandler` before validation, returning a distinct `upload_incomplete` code rather than overloading `invalid_pdf`.
- Expected size comes from the intent row's recorded upload size where present, otherwise from `storage.objects.metadata->>'size'` via the existing server storage module — no new browser-supplied facts.
- Retry re-calls `deps.storage.download` once; the intent stays `pending` across the retry, so existing retry-safety and duplicate rules are untouched.
- Diagnostics are new nullable columns on `document_upload_intents`, written in the existing failure branch before `discardPendingObject`.
