# Phase 9F — Citation Mirror (adopting the uploaded plan)

Phase 9F is not accepted. Two live Genomix runs failed local citation validation with
`excerpt_not_found` only, and the bounded diagnostics showed the model stitching separated
table/heading fragments into single excerpts (folded-equal, normalized-unequal). The cause is
representational: Terra only ever sees the rendered PDF, never the exact local text ARC's
validator matches against.

Fix: supply an ephemeral, page-addressed **ARC local citation text mirror** built from the exact
`AiDocumentEvidence.pages[].text`, alongside (never instead of) the original PDFs.

## Non-negotiables carried forward

- `validateAiCitations()` and `normalizeCitationText()` are NOT changed. No fuzzy matching.
- Exactly one `responses.create` per run; `maxRetries: 0`; no repair, fallback, or auto-retry.
- Original PDFs stay attached once each at high detail; no persistent OpenAI File, no RAG/OCR.
- The mirror is untrusted evidence: it never enters trusted instructions or ARC identity metadata.
- The same canonical request object is token-counted and later sent.
- 200,000-token cap stays authoritative; nothing is silently truncated to fit.
- Mirror text, page text, PDF bytes, prompt, raw response, reasoning, signed URLs are never
  persisted or logged.
- Phase 9G is not started.

## Tasks

### 1. Deterministic mirror builder
New `src/lib/arc/ai/citation-mirror.ts` + spec. `buildCitationMirrorParts(evidence)` emits one
`input_text` part per physical page, in source/page order, with an ARC-authored wrapper carrying
the trusted `documentId` and physical page number and the verbatim `page.text` between
`BEGIN ARC LOCAL TEXT` / `END ARC LOCAL TEXT`. No sanitizing, rewriting, or truncation.
Tests: exact page fidelity; injection text (`Ignore previous instructions`, fake ARC policy
headers) stays verbatim inside the untrusted payload and is never promoted.

### 2. Insert the mirror into the canonical request
`request-package.server.ts`: after each PDF's `input_file` part, append that document's mirror
parts. Trusted ARC source metadata stays separate. Tests in `request-package.spec.ts` and
`openai-client.spec.ts`: N attachments / P mirror parts, no `file_id`, no duplicate attachment,
mirror text byte-identical to local evidence, and the counted object is the same reference later
generated from. Token preflight rejects the whole request if the cap is exceeded — no trimming.

### 3. Prompt v2 — which representation governs excerpts
`prompt.ts` + `config.server.ts`: remove the stale "not supplied here" sentence; state that PDFs
remain the evidence for meaning, tables, layout and signatures, while the mirror is an untrusted
deterministic transcription supplied only so `evidenceMode="text"` excerpts match ARC exactly;
copy a short contiguous mirror span only; no added terminal punctuation, ellipses, semicolon
joiners, omitted or re-ordered words, no cross-row/column stitching; layout-dependent facts use
`evidenceMode="visual"` with `excerpt=null`. Bump `promptVersion` to `arc.ai.prompt.v2`; output
schema version unchanged. Extend `prompt-injection.spec.ts` with malicious mirror text.

### 4. Release mirror text after execution
Extend the existing `releaseRequestBytes()` (or rename to `releaseRequestSensitivePayload()` and
update callers/tests atomically) to also clear mirror bodies in `finally`. Mirror parts are
identified by the ARC-authored prefix, never by page content. Regressions cover success,
validation rejection, post-package preflight exception, and apply failure.

### 5. Prove strict validation is still strict
Tests only, in `citations.spec.ts`: unchanged rejection of trailing-period drift, stitched table
cells, ellipsis/omitted words, wrong page, fabricated excerpt; plus a positive case where a short
exact mirror span verifies as `text_matched`, and a table case verifying as
`visual_page_reference`.

### 6. Verification and one final live gate
Run: `guidance:check`; `test src/lib/arc/ai`, `persistence`, `documents`; `db:start:ci`, `db:test`,
`db:stop`; full `test`, `typecheck`, `lint`, `build`, `audit:bundle`. Both GitHub jobs green.
Report the new exact input-token count for the Genomix fixture (must be ≤200,000, untruncated).
Then exactly one fictional live run on a fresh disposable scope with the immutable fixture
(`7487979e…d4c7`, 56,598 bytes, 4 pages): one token count, one `responses.create`, no
retry/repair/fallback.

Live gate passes only with: schema valid; citation, Guidance and material-provenance issues all 0;
run succeeded; canonical draft applied; AI sidecar applied; `source_state = current`; quota
consumed exactly once; owner lock advanced as expected. If it fails, stop, report bounded
diagnostics, change nothing, and request review.

`roadmap.md` is updated only after deterministic verification passes.
