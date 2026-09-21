# ARC v1 — Safe Re-analysis Closure

Goal: a same-source re-analysis can never corrupt canonical accounting structure. When continuity is not cleanly exact, ARC declines structural application, preserves the existing analysis, and says so plainly.

Scope is deliberately narrow: one new pure safety gate, one integration seam in the existing orchestrator, one prior-evidence loading correction, one message, and focused tests. The accepted Tranche-2 matcher is used as-is and not reopened. The retired Tranche 3–7 roadmap is not implemented.

## Current Re-analyze control flow (traced)

```text
startAiAnalysisHandler        create run, snapshot fingerprint + pre-run state
executeAiRunHandler
  loadExecutionContext        draft, aiState, priorContext, priorAnalysis, lockVersion
  buildPackage                authorized sources, one canonical request, preflight
  recordPreflight             currentSourceSetFingerprint computed here
  reserveAllowance            the only allowance charge; enters "analyzing"
  analyzer.analyze            the single model call
  advanceStage -> applying
  loop (max 3):
    loadExecutionContext      newest draft
    mergeAiAnalysis           <-- structural application happens here
    applyRun                  atomic write; advances last_successful_run_id
  markFailure                 on any failure: nothing written, baseline untouched
```

Key existing facts this design relies on:
- `last_successful_run_id` advances **only** inside `applyRun`. A run that ends in `markFailure` therefore already leaves the reconciliation baseline untouched — no new lineage machinery is needed.
- `currentSourceSetFingerprint` is already computed in the orchestrator before the model call; `aiState.sourceSetFingerprint` holds the fingerprint of the last safely applied run.
- Prior immutable structured output is already read from `ai_runs.result_metadata` in `loadExecutionContext`.
- `failure-presentation.ts` already owns all accountant-facing failure copy and already has the headline "Re-analysis failed · Previous analysis preserved".

## Changes

### 1. Same-source gate + safety firewall (new pure module)

`src/lib/arc/ai/safe-reanalysis.ts` — pure, no I/O, no persistence.

`assessSafeReanalysis(...)` takes: current `AiContractAnalysis`, canonical `WorkflowDraft`, current `AiAnalysisState`, prior `AiContractAnalysis | null`, an explicit `priorAnalysisLoad` status, the current source fingerprint, and the baseline fingerprint. It returns one of:

- `{ outcome: "first_run" }` — no prior successful analysis: merge proceeds exactly as today.
- `{ outcome: "apply" }` — same source, prior evidence loaded, and **every** governed object kind resolves to mutually unique `exact` alignments with no omitted incumbents.
- `{ outcome: "decline", reason }` — everything else.

Decline reasons (internal codes only): `source_changed`, `prior_analysis_unavailable`, `decomposition` (any `subsumes`/`split_from`), `ambiguous`, `unmatched`, `omitted_incumbent`.

Facts are built with the accepted Tranche-2 builders (`promiseIdentityFacts`, `performanceObligationIdentityFacts`, `variableConsiderationIdentityFacts`, `billingTermIdentityFacts`) and resolved with `resolveIdentityGraph` + `canonicalGroupDecompositionRules`. Incumbent bounded excerpts come from the prior immutable analysis only; nothing is copied into `AiAnalysisState`, and no alignment is persisted.

**Non-circularity:** `owningObligationCanonicalId` for incumbents is derived from canonical PO→promise membership in the `WorkflowDraft` plus `objectProvenance`, never from the proposal under test. For proposals it comes from the new analysis's own declared obligation grouping. A dedicated test asserts this.

### 2. Orchestrator integration

In `orchestrator.ts`, inside the apply loop and immediately before `mergeAiAnalysis`, call the gate with `latest.*` and `currentSourceSetFingerprint`. On `decline`, call the existing `markFailure` with `failureStage: "applying"`, `category: "application"`, `code: "reanalysis_declined"` and return — no merge, no `applyRun`, so canonical inputs, sidecar, `last_successful_run_id` and billing all stay exactly as they were. The attempted run remains in immutable history. On `apply`/`first_run`, existing merge semantics run unchanged.

### 3. Prior immutable evidence is required for same-source re-analysis

`runs.store.server.ts`: when `lastSuccessfulRunId` is set, always attempt the `ai_runs.result_metadata` load (today it is skipped unless `priorAnalysisRequired`). `AiExecutionContext` gains `priorAnalysisLoad: "not_required" | "loaded" | "unavailable"` so the trusted layer — not the pure graph — reports whether the evidence really parsed. `unavailable` ⇒ decline. No fallback to semantic keys, descriptions or mutable sidecar state. `priorAnalysis` stays optional and the existing backfill path is unchanged.

### 4. Accountant-facing message

`failure-presentation.ts`: new category `structurally_declined`, mapped from `application`/`reanalysis_declined`. Copy: "The latest AI analysis described this contract differently, so ARC did not apply it." Impact keeps the existing preserved-analysis wording; next step points at manual review or a new analysis. Headline reuses "Re-analysis failed · Previous analysis preserved". No new UI component — `AiAnalysisNotice` renders it already.

## Tests (RED first, then minimal implementation)

New: `src/lib/arc/ai/__tests__/safe-reanalysis.spec.ts` and `src/lib/arc/ai/__tests__/genomix-safe-reanalysis.spec.ts`, plus additions to the existing orchestrator and failure-presentation suites.

- Exact continuity: canonical IDs reused, eligible AI-owned fields refresh, accountant edits and actuals survive, no duplicates.
- Decomposition firewall: 4→3 promise drift ⇒ decline; `subsumes` and `split_from` never mutate structure.
- Ambiguity: `ambiguous`, `unmatched`, apparent omission ⇒ decline, nothing deleted or minted.
- Prior result: fetched for same-source re-analysis; unavailable/malformed ⇒ fail closed; sidecar is not a substitute.
- Source change: changed fingerprint ⇒ decline, no cross-document reconciliation, no automatic contract modification.
- Lineage: a declined run leaves `last_successful_run_id` and the baseline untouched; the next re-analysis still compares from the last safely applied run.
- Canonical graph evidence: relation comes from independent canonical structure; no circular inference.
- Billing: no duplicate billing events or projected collections; unsafe billing continuity ⇒ existing structure preserved.
- Matcher invariants: Run 1 → Run B topology, order invariance, input immutability unchanged.
- Genomix integration regression: real canonical state (3 POs, 2 VC, 2 billing events, 2 projected collections, series conclusion, 2027-03-15 transfer, 300/150 hours, $1.35/sample, $1,500 SLA credit) + Hosted/Throughput drift ⇒ safe decline with every canonical fact byte-identical.

## Verification

Focused specs → adjacent suites → full test suite → typecheck → lint → production build → bundle audit. No database-facing change, so no SQL suite run is required. Both GitHub Actions jobs must be green on the final revision; CI itself is not modified.

## Explicitly not included

No migration, no RLS change, no persistence-schema change, no prompt/model/output-schema change, no AI-call or quota change, no accounting-engine or deterministic-math change, no auth or deployment change, no generalized tombstone or reset machinery, no changed-source matching infrastructure. If any of these turns out to be genuinely unavoidable, work stops and the blocker is reported before implementing it.

Stop after verification and await director acceptance.
