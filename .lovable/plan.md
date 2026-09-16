# Phase 9F — ARC-Owned Citation Anchors (Tasks 1–8)

Adopting the attached design spec and implementation plan verbatim as the authoritative Phase 9F
citation architecture. Terra stops writing quotation text; it selects ARC-generated anchors, and ARC
materializes the exact excerpt from its own local page extraction before the unchanged strict
validator runs.

## Non-negotiables

- `validateAiCitations()` and `normalizeCitationText()` are not changed.
- No generative OpenAI call in this work. Task 9 is not started; Phase 9G is not started.
- Original PDFs stay attached exactly once at `detail: "high"`; no OCR, RAG, embeddings, tools,
  persistent Files, repair, fallback or automatic retry.
- One canonical request object is both token-counted and sent; 200,000-token cap authoritative, no
  truncation of anchors, pages or Guidance.
- Page text, anchor views, PDF bytes, prompt, raw response and reasoning are never logged or persisted.
- ARC engines remain authoritative for all math.

## Tasks (TDD: failing test first, then implementation)

1. **Deterministic anchors** — new `citation-anchors.ts` + spec. Lossless segmentation of
   `AiDocumentEvidence.pages[].text`: backward search in [80,160] for newline → sentence → clause →
   whitespace, else hard cut at 160. IDs `P0001-S0001`. Tests: exact concatenation reconstructs page
   text, stable IDs, Unicode/whitespace preserved, empty page → zero anchors.
2. **Anchored mirror** — `citation-mirror.ts` emits, per page, an ARC-authored locator part plus one
   `JSON.stringify`-serialized untrusted payload of `{ anchorId, text }` entries. No second raw
   mirror. `payloadParts` references preserved for release. Hostile text (fake JSON, fake anchor IDs,
   quotes, backslashes) stays inside `text` values.
3. **Provider-facing schema** — internal `AiCitation` unchanged. Add `AiAnchoredCitation` and
   `aiAnchoredContractAnalysisJsonSchema`, built by deep-cloning the internal strict JSON schema and
   structurally replacing every citation node's `excerpt` with `anchorStart`/`anchorEnd`. Bump
   `AI_OUTPUT_SCHEMA_VERSION` to `arc.ai.schema.v2`; point `arcStructuredOutput()` at it.
   The transform first counts the internal citation schema nodes by an independent traversal, then
   requires exact parity between that count and the number of nodes it replaced: any mismatch (or a
   count of zero, or any surviving provider-facing `excerpt`) throws and fails closed rather than
   emitting a partially transformed schema. Regressions cover parity, zero-node rejection, and a
   deliberately mismatched fixture.
4. **Materializer** — new `citation-anchor-materializer.ts`: builds the anchor index from evidence,
   walks the raw model object, converts only provider-shaped citation objects into internal
   excerpt citations, and fails closed with bounded issue codes (`anchor_unknown`,
   `anchor_page_mismatch`, `anchor_document_mismatch`, `anchor_range_reversed`,
   `anchor_range_too_large`, `anchor_text_requires_single_page`,
   `anchor_visual_must_not_select_text`, `anchor_excerpt_too_long`, `anchor_selector_missing`).
   Diagnostics carry schema path and anchor IDs only. Invariant test: every successful text
   resolution parses internally and yields zero citation issues from the unchanged validator.
5. **Pipeline** — `terra.server.ts`: JSON.parse → materialize → existing `parseAiContractAnalysis()`
   → existing `validateAiCitations()`. New `citation_anchor_failure` Terra category with at most 40
   `code at path` diagnostics; no merge/apply reached on failure; still exactly one provider call.
6. **Prompt v3** — remove the copy-exact-characters instruction; instruct anchor selection (smallest
   contiguous range, one physical page, tables/layout stay visual with null anchors). Bump
   `promptVersion` to `arc.ai.prompt.v3`. Injection regressions for contract text asserting fake
   anchor IDs or instructing ARC to ignore anchors.
7. **Boundary regressions** — tests only: unchanged validator still rejects punctuation drift,
   stitched cells, wrong page and fabricated excerpts; anchored text verifies as `text_matched`,
   tables as `visual_page_reference`; adapter/merge fixtures carry excerpts and no anchor fields;
   `releaseRequestSensitivePayload()` blanks anchored payloads on success and failure.
8. **Verification and report** — `guidance:check` (116 cards, approved hash); AI, persistence and
   documents suites; `db:start:ci`, `db:test`, `db:stop`; full `test`, `typecheck`, `lint`, `build`,
   `audit:bundle`. Then a preflight-only Genomix token count (no `responses.create`), proving
   ≤ 200,000 with no truncation. Roadmap updated to record schema v2 / prompt v3 and that Phase 9F
   still awaits final live acceptance.

## Stop condition

After Task 8 I return the completion report, the exact Genomix preflight input-token count, and the
CI status, then stop and wait for your explicit authorization of Task 9. No generative call is made
before that authorization.
