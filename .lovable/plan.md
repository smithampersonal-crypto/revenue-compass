# ARC v1 — Package 2C: Recruiter Presentation Polish + AI Accounting Labels

## Scope and confirmed baseline

Package 2C is a presentation and AI-contract refinement only. Current inspection confirms:

- The strict AI contract is `arc.ai.schema.v5`; Promises and Performance Obligations carry only long-form `description` values (`src/lib/arc/ai/schema.ts`). The prompt default is `arc.ai.prompt.v9` (`src/lib/arc/ai/config.server.ts`).
- The merge currently writes `aiPromise.description` to `PromiseDraft.description` and `aiPo.description` to `PoDraft.name` (`src/lib/arc/ai/merge.ts`). Promise drafts have no separate display name (`src/lib/asc606-workflow/types.ts`).
- Prior immutable runs are parsed with the current parser in `src/lib/arc/ai/runs.store.server.ts`; a direct v6-only parser would therefore make valid v5 baselines unavailable and break Safe Re-analysis.
- Canonical drafts are stored as validated JSON under `arc.workflow.v1`. An optional Promise field can be backward-compatible without SQL, provided the runtime schema explicitly accepts and validates it (`src/lib/arc/persistence/schema.ts`).
- Current identity uses semantic structure, source evidence, detailed descriptions, canonical relationships, and deterministic topology. Current object edit fingerprints also include Promise description and PO name; presentation-label ownership must be separated from those object/material projections.
- The requested presentation issues are present in the named UI surfaces: fixed two-row narrative fields, repeated text provenance, long PO names in Step 4 labels, engine-oriented headings, internal balance-row IDs, repeated citation rows, and the four-panel AI progress display.

## Implementation tranches

Each tranche is independently reviewable. Do not begin a later tranche until the preceding tranche is accepted.

### 2C-A — AI Accounting Label Contract

1. Introduce `arc.ai.schema.v6` as the only schema for new generations; retain a strict, explicit v5 parser for immutable historical results.
2. Add required `accountingLabel` to v6 Promise and Performance Obligation objects:
   - string, trimmed/nonblank, maximum 80 characters;
   - no heuristic vocabulary, title-case, word-count, or semantic-key validation;
   - strict-object and all-properties-required guarantees remain intact.
3. Update prompt default to `arc.ai.prompt.v10`. In the trusted task rules, require a neutral, contract-supported, accounting-friendly noun phrase, normally 2–8 words, without dates, rationale, marketing copy, IDs, or semantic keys. Include the approved good and bad examples while preserving all v9 citation-anchor rules unchanged.
4. Keep both detailed `description` fields unchanged in purpose and content.
5. Add version-aware parsing:
   - live/provider output must validate strictly as v6;
   - immutable `schemaVersion: arc.ai.schema.v5` results validate against the frozen v5 shape;
   - normalize a valid v5 result into an internal compatibility representation with absent/inert presentation labels;
   - reject unknown versions or malformed v5/v6 payloads; never rewrite `ai_runs`, weaken v6, or synthesize labels from legacy descriptions.

### 2C-B — Canonical, Persistence, and Accountant Authority

1. Add optional `PromiseDraft.displayName?: string`; keep `description` as the detailed interpretation. New manual Promise factories may omit it; UI fallback is `displayName?.trim() || description`.
2. Add `displayName` as an optional validated string in canonical JSON persistence. Old `arc.workflow.v1` drafts remain readable; present malformed values fail closed. Keep the workflow schema version unless implementation proves serialization incompatibility—current JSON architecture does not require SQL or a bulk data migration.
3. First AI application:
   - Promise `displayName ← aiPromise.accountingLabel`;
   - PO `name ← aiPo.accountingLabel`;
   - detailed Promise description remains in `PromiseDraft.description`;
   - detailed PO description remains in immutable AI output, review material, citations, and provenance context rather than being copied into `PoDraft.name`.
4. Add presentation-only field provenance keys for Promise `displayName` and existing PO `name`. Use a narrow label merge policy:
   - untouched AI-owned labels may refresh on same-source re-analysis;
   - manual-from-start or accountant-edited labels are preserved;
   - a preserved label difference does not raise/carry a material accounting-review item;
   - provenance still records AI-drafted versus edited state.
5. Remove PO `name` from AI object edit fingerprints and never add Promise `displayName`; retain detailed Promise `description` and all actual accounting fields. This prevents a label-only edit from marking the whole object materially modified while field provenance still protects the edited label.

### 2C-C — Identity Firewall Verification

Audit and lock explicit exclusions in:

- `src/lib/arc/ai/identity.ts`
- `src/lib/arc/ai/identity-facts.ts`
- `src/lib/arc/ai/reconciliation.ts`
- `src/lib/arc/ai/identity-backfill.ts`
- `src/lib/arc/ai/identity-graph.ts`
- `src/lib/arc/ai/safe-reanalysis.ts`
- `src/lib/arc/ai/merge.ts`
- `src/lib/arc/ai/review-state.ts`
- `src/lib/arc/ai/orchestrator.ts`

`accountingLabel`, Promise `displayName`, and PO presentation `name` will be absent from identity facts/signatures, semantic matching, exact/subsumes/split resolution, graph membership, tombstones, source fingerprints, omission rules, structural topology, material review projections, and accounting readiness. Existing detailed descriptions remain only where already accepted as weak corroboration/material interpretation. No identity algorithm or Safe Re-analysis rule changes.

### 2C-D — Deterministic Display Labels and Step 2

1. Add one browser-safe presentation helper (new `src/lib/asc606-workflow/display-labels.ts`) that formats:
   - over-time: `Name · M/D/YYYY–M/D/YYYY` only when both valid structured dates exist;
   - point-in-time: `Name · M/D/YYYY` only when a valid structured recognition date exists;
   - missing/inapplicable dates: `Name` only;
   - no prose parsing or inferred dates.
2. Use the assigned canonical PO’s recognition fields when presenting a Promise; use the PO’s own fields for PO headings.
3. Step 2 Promise editor: separate **Name** (`displayName`) from **Description / Interpretation** (`description`), preserving both and avoiding a material redesign. Assignment lists and headings use the concise fallback label.
4. PO editor and downstream display surfaces use the centralized concise label/date formatter where context permits.
5. Update curated sample presentation names through the same fields. Horizon becomes exactly **Hosted SaaS Access**, **Implementation Training**, and **Premium Support**; economics, dates, SSPs, allocation, billing, collections, and schedules remain unchanged. Apply similarly concise names to other curated samples only where this is a direct wording-only substitution.

### 2C-E — Narrative Fields and Step 4

1. Add a reusable `AutoGrowTextarea` alongside shared workflow fields. On mount and each value change, reset height, measure `scrollHeight`, and expand. Keep a compact minimum; cap only pathological content (with scrolling after the cap), never ordinary AI output. Preserve controlled value, change handler, disabled/read-only behavior, validation, and provenance wrappers.
2. Apply only to long-form accounting narratives:
   - Step 1 criterion rationale;
   - Promise material-right and distinctness rationales;
   - PO classification rationale;
   - transaction-price notes, variable-component description/trigger/allocation rationale, estimate constraint rationale/evidence;
   - SSP basis/documentation;
   - recognition rationale;
   - variable-consideration resolution rationale;
   - modification approval, scope-change, SSP, allocation-policy, distinctness, and recognition rationales.
   Keep short notes, resolution-dialog notes, names, dates, amounts, quantities, and selectors unchanged.
3. Redesign each Step 4 PO card with one concise formatted heading, then aligned **SSP (USD)** and **SSP Basis / Documentation** controls. Remove the PO prose from the SSP label. Use stable grid tracks so cards align despite narrative height.
4. Rename the output heading to **Transaction Price Allocation**. Supporting copy may retain the deterministic/read-only explanation.

### 2C-F — Provenance and Presentation Copy

1. Replace repeated provenance text with a compact Sparkles-style marker in `AiReviewTarget`; expose “AI drafted” or “AI drafted · edited” through visible/assistive label and tooltip. Manual and prior-finalized content remain unmarked; review/resolve markers still take precedence.
2. Standardize approved structural titles to Title Case, including:
   - Revision Lifecycle, Revision History, AI Review;
   - Promised Goods and Services, Performance Obligation N, Assign Promises;
   - Transaction Price, Allocation Inputs, Transaction Price Allocation, Recognition Judgments;
   - Revenue Schedule, Contract Balances, Journal Entries, Source Documents, Review & Finalize;
   - Billing Schedule, Cash Collections, ASC 606 Reconciliation, Contract Modifications;
   - related structural output titles such as Variable Consideration, Material Rights, Progressive Results, Engine Validation, and Journal Reconciliation.
3. Remove parenthetical/internal implementation wording from headings: “(engine output)”, “(engine-derived)”, “Engine allocation…”, and “read-only” in titles. Keep plain-language supporting text that deterministic engines own calculations.
4. Keep ordinary field labels and helper text in sentence case; do not mechanically title-case all strings.

### 2C-G — Money Input Formatting

1. Extend the existing exact money-input module—do not create another parser—with a display formatter that first uses `parseUsdToCents`, then emits grouped dollars and exactly preserved cents on blur.
2. Invalid, blank, and incomplete edits remain untouched; typing is never reformatted; no cursor jumps, floating-point conversion, or rounding.
3. Apply a shared money-input blur handler/component to fixed consideration, SSP/economic-benefit inputs, billing events, cash collections, modification consideration and SSP inputs, variable-consideration outcome/included/resolution amounts, VC rate amounts, and material-right exercise consideration. Exclude quantities, percentages, dates, IDs, and read-only calculated output.

### 2C-H — AI Progress Presenter

Replace `AiAnalysisProgress`’s four cards with one compact status line—e.g. **Analyzing Contract · Step 2 of 4**—and a four-segment bar. Map only the existing `AiWorkspaceProgress` step/label; completed, active, and future segments get semantic states, with restrained active animation disabled under reduced motion. No percentage, timing, polling, retry, stage-transition, or run-semantic changes.

### 2C-I — Contract Modifications and Contract Balances

1. Locally correct the Contract Modification desktop grid so the effective-date and consideration controls share a control baseline. Keep amount plus Increase/Decrease together; move helper copy below the control row; preserve responsive stacking.
2. Contract Balances presentation:
   - rename **Consideration events (billing events)** to **Billing Schedule** and use the approved concise explanation;
   - card headings become **Billing Event N** and **Cash Collection N** with no IDs;
   - related-event options become `Billing Event N — $formatted amount` while option values retain canonical IDs;
   - add Complete/Incomplete badges only if derivable from the already-returned validation result, with no new workflow state.
3. Add a pure presentation grouper that maps every existing balance validation issue to its friendly row and combines missing fields into one sentence per row. Preserve the complete underlying issue set and blocking/warning meaning; do not alter accounting validation or suppress unmatched global issues. Heading: **Complete These Items to Finish the Contract-Balance Workpaper**.

### 2C-J — Review & Finalize Polish

1. Evidence rows:
   - label **Source Evidence · Page N** (or Pages N–M for a legitimate legacy range);
   - action **Open PDF**;
   - remove visible evidence-mode wording while retaining internal mode and navigation behavior;
   - use explicit flex/gap layout.
2. Deduplicate within each review item by `(documentId, physical page)`, retaining the first citation index for the existing secure open action. Current anchored citations are single-page; a legacy multi-page citation remains one truthful range row. Do not mutate citations, anchors, excerpts, or immutable metadata.
3. Render the category once in Title Case. When section and target collapse to the same phrase (notably Additional Topics Applied), suppress the duplicate rather than changing review meaning.
4. Strengthen the existing `arc-review-focus` lifecycle without changing routing/selection or ~3.5-second cleanup: pale amber background, stronger amber border/ring, one short pulse/flourish, then static highlight until removal. Under `prefers-reduced-motion: reduce`, show the stronger static state with no animation. Preserve contextual “Review this item” / “Resolve this item” labels.
5. Replace raw engine-check IDs/PASS tokens on Review & Finalize with grouped accountant-facing presentation only where an existing result is already available; retain every check and status.

### 2C-K — Verification and controlled live acceptance

Run focused tests per tranche, then the complete repository verification and bundle audit. Run both GitHub Actions jobs if available; do not change CI.

Use only accepted synthetic data:

- Fresh Genomix upload: observe all four progress stages; verify concise Promise/PO labels, detailed interpretations, deterministic dates, accessible provenance markers, expanded narratives, unchanged outputs.
- Same-source re-analysis: rename one label as accountant-owned; confirm it survives, no duplicates/topology changes occur, and label variation causes no material review reopening or structural decline.
- Horizon: verify the three approved names and deterministic date suffixes; reconcile outputs against the unchanged baseline.
- Step 4: verify one concise heading per PO, aligned inputs, fully visible documentation, and Transaction Price Allocation.
- Contract Balances: verify friendly row/selector labels, no `ce-*`/`cc-*`, grouped findings, and comma-formatted amounts.
- Review & Finalize: verify Title Case, evidence spacing/deduplication, no visible “Visual source evidence” or duplicate category, and one-shot/reduced-motion focus behavior.
- Contract Modification: verify aligned desktop controls, safe mobile stacking, and money formatting.

## Expected file surface

**AI contract and compatibility**
- `src/lib/arc/ai/schema.ts`, `prompt.ts`, `config.server.ts`, `terra.server.ts`, `runs.store.server.ts`
- likely new `src/lib/arc/ai/legacy-schema-v5.ts` or equivalent versioned-schema module
- AI fixtures and focused specs under `src/lib/arc/ai/__tests__/` for schema, prompt, adapter/merge, provenance, legacy runs, identity, Safe Re-analysis, and structural backstop

**Canonical and presentation helpers**
- `src/lib/asc606-workflow/types.ts`, `index.ts`, `presentation.ts`, `money-input.ts`
- new `src/lib/asc606-workflow/display-labels.ts`
- `src/lib/arc/persistence/schema.ts` and persistence compatibility specs
- `src/lib/demo-scenarios.ts`

**UI**
- `src/components/asc606-workflow/fields.tsx`, Step1–Step5 files named above, `ContractModifications.tsx`, `BillingAndBalances.tsx`
- `src/components/arc/AiReviewTarget.tsx`, `AiAnalysisProgress.tsx`, `AiReviewPanel.tsx`, `ReviewFinalizeView.tsx`, `RevenueScheduleView.tsx`, `RevisionLifecyclePanel.tsx`, `AdditionalTopics.tsx`, `ContractBalancesView.tsx`
- `src/lib/arc/ai/review-presentation.ts`, `src/routes/analysis/index.tsx`, `src/routes/analysis/documents.tsx`, and `src/styles.css`
- focused component specs adjacent to these surfaces; no README screenshot changes

The exact diff should stay within this surface; any newly discovered file must be justified before inclusion.

## Test matrix

- **Schema/prompt:** v6 required bounded labels; v10 exact rules/examples; descriptions unchanged; blank/overlong/extra fields rejected; v5 accepted only by legacy parser.
- **Mapping/persistence:** Promise display name and PO name map from labels; detailed descriptions remain; old drafts load; present malformed display names fail closed; new drafts round-trip.
- **Authority/provenance:** untouched labels refresh; edited/manual labels survive; no material review item from label-only drift; marker accessibility and manual-content exclusion.
- **Identity/firewall:** label changes leave identity facts/signatures, material fingerprints, topology, omission, and structural decisions byte-equivalent; no duplicate/merge/split/decline.
- **Legacy:** immutable v5 prior result remains usable for same-source re-analysis without rewrite.
- **Display dates:** over-time, point-in-time, missing, invalid, and irrelevant cases; no invented suffix.
- **Auto-grow/layout:** initial measurement, changes, compact minimum, deliberate cap, unchanged value/provenance, Step 4 single heading/alignment, modification desktop/mobile alignment.
- **Money:** `505001.96 → 505,001.96` on blur; exact cents unchanged; commas round-trip; invalid/blank/incomplete untouched; no on-change loop.
- **Progress:** every existing stage maps correctly; no percentage; terminal/failure behavior unchanged.
- **Balances:** no visible internal IDs; friendly relation values; grouped output accounts for every source issue.
- **Evidence/review:** visible copy, layout, dedup key behavior across same/different documents, unchanged underlying citations, single category, focus duration, one-shot animation, reduced motion.
- **Headings:** approved structural inventory is exact; forbidden heading phrases absent.

## Migrations, rollback, and risks

- **Expected migrations:** none. No SQL, storage, RLS, auth, quota, or historical-row rewrite. The optional Promise field is an additive JSON change under the existing workflow envelope.
- **Primary risk:** parsing prior v5 output with the new v6 parser. Mitigation: frozen strict v5 parser plus explicit version dispatch and Safe Re-analysis regression.
- **Authority risk:** using object fingerprints for labels would reopen or freeze unrelated accounting. Mitigation: field-level label provenance and explicit exclusion from object/material fingerprints.
- **Identity risk:** accidentally passing labels into description-based identity builders. Mitigation: keep detailed descriptions as the only existing prose input and assert label-variation invariance at every firewall layer.
- **Formatting risk:** blur formatting could alter invalid work-in-progress or cents. Mitigation: reuse exact parser; format only successful parses; preserve all other strings.
- **Presentation grouping risk:** hiding a validation issue. Mitigation: map one source issue to exactly one grouped fragment and assert source/grouped issue-count parity.
- **Rollback:** each tranche is separable; version defaults can roll back without deleting v6 records because the compatibility parser remains version-aware. UI tranches are presentation-only and independently revertible.

## Optional Presentation Findings — Not Yet Approved

These are observed but excluded unless separately approved:

1. Several raw HTML action buttons remain beside design-system buttons across workflow editors, producing small interaction-style differences.
2. “Billing & Contract Balances” and “Billing, receivables and contract balances” coexist as names for the same workpaper family; Package 2C only changes the explicitly approved headings.
3. Some output sections use dashed wrapper panels around supporting analyses while most sections use the shared Section treatment.
4. Several helper sentences still use “engine” in body copy. They support the accepted deterministic-control story, so this plan removes the term only from structural headings and raw validation presentation.
5. The Source Documents route currently uses sentence-case `Source documents`; this plan changes the structural title only, without redesigning the accepted Package 2A.1 card.

## Frozen systems

No changes to deterministic accounting engines, allocation/recognition/balance/journal/modification/variable-consideration conclusions, identity algorithms, Safe Re-analysis rules, citation-anchor semantics, fingerprints, document/storage architecture, persistence/database architecture, RLS, authentication, quotas, SMTP, domains, Excel export, Package 2A visual tokens, Package 2A.1 behavior, Package 2B screenshots/README, or Package 3. The sole AI expansion is additive `accountingLabel` for Promise and PO proposals.
