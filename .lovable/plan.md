# Cross-Run Structural Identity — Implementation Plan (Corrected)

Design Revision 3 + Amendment 3A are frozen. This revision folds in all ten repository-review corrections.

Governing invariant: on same-source re-analysis, absent an explicit accountant structural edit, the canonical ID sets for promises, POs, VC components, consideration events and projected collections are invariant. AI may change alignments (ephemeral), review state, exact-match aliases and eligible untouched AI-owned fields only.

## Accepted corrections (binding)

1. **Alignments are ephemeral.** `ProposalAlignment[]` lives only inside the pure `GraphReconciliationResult` during an apply/merge. It is never added to `AiAnalysisState`, never passed through `toPersistedAiState`, and needs no column. Durable consequences persist through what already exists: 1:1 alias continuity in `objectProvenance`, unresolved structural conclusions in `reviewItems`, immutable proposal history in `ai_runs.result_metadata`. Re-analysis recomputes topology from canonical state + current proposal, so Undo restores nothing extra. No `alignment-state.ts` persistence module — only a small pure types/helpers file.
2. **Alignment vocabulary frozen:** `"exact" | "subsumes" | "split_from" | "ambiguous" | "unmatched"`. `unmapped_ai_proposal` stays a review reason code, never a relation. The earlier "unmapped" relation spelling is removed.
3. **Citation overlap is corroboration, never sufficient identity.** No test or rule encodes `page intersection => exact`.
4. **Fixtures keep bounded validated citation excerpts** from the immutable Run 1 / A / B structured outputs — only the excerpts the engine's normalized equality/strict-containment needs, never page corpus or prompt text — preserving the real equality/containment relationships. No hand-authored convenience drift.
5. **Reset needs a trusted atomic server operation** (Tranche 6), not a client draft clear.

## Where merge.ts must shrink, not grow

`merge.ts` keeps orchestration only and delegates to new pure modules:

- `src/lib/arc/ai/identity-facts.ts` — build identity facts from proposals and incumbents.
- `src/lib/arc/ai/identity-graph.ts` — candidate relation graph, sufficiency matrices, mutual uniqueness, decomposition.
- `src/lib/arc/ai/structural-firewall.ts` — same-source zero-mutation gate, manual-first-run gate, omission symmetry, exact-match field-merge eligibility.
- `src/lib/arc/ai/alignment-types.ts` — pure relation/result types only.

All pure: no clock, randomness or I/O; inputs never mutated; input ordering cannot change outcomes.

---

## Tranche 1 — Bounded production fixtures + pure types

Create: `src/lib/arc/ai/__tests__/production-runs/{run1,run-a,run-b}.fixture.ts`, `.../production-runs/index.ts`, `src/lib/arc/ai/alignment-types.ts`, `src/lib/arc/ai/__tests__/production-runs/fixtures.spec.ts`.

Fixtures carry semantic keys, promise types, citation document/page identity, the bounded validated excerpts required for equality/containment, normalized descriptions, VC rate/unit terms and billing terms from Runs 1/A/B as recorded.

RED: fixture modules absent; assertions on Run 1 = 4 promises / 3 POs / 2 VC / 2 CE / 2 CC and on the real A/B drift (key rename, page 3 vs 1+3, `professional_service` ↔ `support`, 4↔3 decomposition, billing term rename) fail.
Minimal: author fixtures + types. GREEN: fixtures spec. Regression: full suite unchanged (no production behavior touched). Checkpoint: commit.

## Tranche 2 — Pure identity facts, candidate graph, decomposition

Create: `identity-facts.ts`, `identity-graph.ts`, `__tests__/identity-facts.spec.ts`, `__tests__/identity-graph.spec.ts`. Modify: `reconciliation.ts` (kept exported as a compatibility surface until Tranche 3 removes its last caller — it is replaced, not evolved: the scalar first-corroborator rule cannot express 1:N/N:1).

Interfaces: `IdentityFacts { anchors, boundedExcerpts, normalizedText, judgmentFacts, structuralMembership, terms }`; `CandidateEdge { proposalKey, canonicalId, signals, sufficiency }`; `resolveIdentityGraph(proposals, incumbents, rules): GraphReconciliationResult` with `alignments: ProposalAlignment[]`. Per Amendment 3A: document-ID mismatch is not a contradiction; judgments (promise type, satisfaction pattern) corroborate, never gate.

RED tests, exactly as required: page 3 vs pages 1+3 **plus** matching contractual/economic/graph evidence → exact; same page/paragraph but objectively different deliverables → no exact match; taxonomy drift alone identifies nothing; false subsumption rejected or ambiguous; contention → ambiguous; permuted input ordering yields identical results; no draft mutation in this layer.
GREEN: graph/facts specs. Regression: existing identity + reconciliation suites. Checkpoint: commit.

## Tranche 3 — Tombstone matching migration + firewall + merge integration

Create: `structural-firewall.ts`, `__tests__/structural-firewall.spec.ts`, `__tests__/tombstone-drift.spec.ts`. Modify: `merge.ts`, `tombstones.ts`, `edit-reconciliation.ts`, `identity-backfill.ts`, `reconciliation.ts` (retire scalar path), `state-serialization.ts` only if the tombstone record shape changes shape-compatibly.

Deleted-object recognition migrates off `signaturesIdentify()` onto the same facts/sufficiency engine for promise, PO, VC, billing-event and projected-collection tombstones, keeping fail-closed semantics: unique deleted identity → suppress the renamed proposal; multiple plausible → blocking ambiguity, nothing created; never resurrect because the model changed key, page set, taxonomy or decomposition.

Firewall rules: same-source run performs zero structural mutation; `subsumes`/`split_from` record topology only; `ambiguous`/`unmatched` mutate nothing and raise blocking review; incumbents covered by a decomposition alignment are never reported omitted; first AI run over manual structure is firewalled identically.

Positive field-merge tests (required): an `exact` alignment retains the canonical ID, accountant-owned/user-edited values survive, and an eligible untouched AI-owned field does update; `subsumes`, `split_from`, `ambiguous`, `unmatched` never fan fields into canonical rows.

RED: Run 1 → Run B currently mints duplicate POs/VCs; tombstone drift cases resurrect deleted rows.
GREEN: firewall + tombstone-drift specs. Regression: all `src/lib/arc/ai/__tests__` suites. Checkpoint: commit.

## Tranche 4 — Structural review lifecycle

Modify: `review-state.ts`, `review-normalization.ts`, `review-presentation.ts`, `review-dto.ts`; tests extend the existing `__tests__/review-state.spec.ts`, `__tests__/review-presentation.spec.ts`, `src/routes/analysis/ai-review-navigation.spec.tsx`, `ai-exact-target-coverage.spec.tsx` rather than creating parallel infrastructure.

Reason codes `unmapped_ai_proposal`, `unsafe_semantic_relationship`, `ai_proposal_omitted` join existing R3 validation, fingerprints, carry/reopen, navigation and finalization blocking, reusing the existing manual_red / red-resolution machinery. **Review identity may not use `semanticKey`**: `targetKey` and material fingerprint derive deterministically from canonical anchors plus the proposal's material economic facts (anchors, bounded excerpts, terms, structural relationship); `semanticKey` is display/diagnostic only.

Required tests: same economic proposal with only a semantic-key rename → prior accountant disposition carries; materially changed economic scope/terms/relationship → review reopens. No new manual identity-remapping system.
GREEN: review specs. Regression: navigation + finalization suites. Checkpoint: commit.

## Tranche 5 — Billing lineage under the same matcher

Modify: `billing-identity.ts`, billing passes in `merge.ts`; extend `__tests__/billing-lineage-identity.spec.ts`, `__tests__/legacy-billing-tombstone-upgrade.spec.ts`, `src/components/asc606-workflow/billing-event-deletion.spec.tsx`.

Economic design is not reopened. Schedule identity adopts the new facts taxonomy so Run A's page-3 citation reconciles to Run 1's pages 1+3 when corroborating economic evidence agrees. Event/collection canonical IDs reused per deterministic schedule period; period-scoped tombstones and the actual-cash deletion guard unchanged.
GREEN: new drift cases. Regression: every existing billing lineage/deletion/legacy-upgrade test green unchanged. Checkpoint: commit.

## Tranche 6 — Atomic reset, manual-first, source-change

Create: one narrow SQL routine migration adding `arc_reset_ai_analysis(...)` (no table or RLS redesign), `supabase/tests/phase9h_reset_epoch.sql`. Modify: `workspace.store.server.ts`, `workspace.handlers.ts`, `autosave.store.server.ts`, `restore.handlers.ts` as needed, `src/components/arc/analysis-context.tsx` for the Reset action.

The RPC authorizes and locks the owned revision or guest workspace, checks the expected lock version, writes empty canonical inputs, atomically clears/resets the mutable `ai_analysis_state` (provenance, tombstones, reviews, `last_successful_run_id`), clears active source fingerprint/state and stale acknowledgement, increments the authoritative lock version, preserves immutable `ai_runs`, returns the new lock version, and is idempotent/response-loss safe. Includes security and rollback review.

Also: empty draft with history is treated defensively (never a free bootstrap); a changed source fingerprint stages unmatched proposals for accountant review rather than auto-creating contract modifications.
GREEN: reset specs + SQL suite. Regression: workspace, autosave, restore suites. Checkpoint: commit.

## Tranche 7 — Production acceptance + property suite + full gates

Create: `src/lib/arc/ai/__tests__/production-runs-reconciliation.spec.ts`.

Sequential cases Run 1 → Run A, Run 1 → Run B, Run 1 → Run A → Run B, each asserting 4 promises, 3 POs, 2 VC components, 2 consideration events, 2 projected collections, identical canonical ID sets, all Phase L accountant facts preserved, no false omissions for decomposition-covered incumbents. Adversarial: false subsumption, contending proposals, judgment/taxonomy drift, cross-document evidence drift, fabricated same-source object → blocking review and zero rows, billing tombstone invariance. Deterministic seeded property test: perturbing keys, judgments, citation pages and decomposition over the same source always preserves the canonical ID sets.

Final gate: focused tests, complete existing suite, typecheck, lint, production build, bundle audit, both GitHub CI jobs. GitHub green is not accepted as proof of the live regression — after deployment we Undo Run B and run one controlled live Genomix re-analysis.

---

## Prevention of the observed live failures

| Failure | Prevented by |
| --- | --- |
| Semantic-key drift | Keys are aliases; identity from facts (T2) |
| Page 3 ↔ pages 1+3 | Anchors corroborate alongside economic evidence (T2/T5) |
| professional_service ↔ support | Judgments corroborate, never gate (T2) |
| 4 ↔ 3 promise decomposition | subsumes / split_from topology (T2/T3) |
| $1.35 usage citation drift | Terms corroborate when anchors shift (T2) |
| Billing schedule drift | Billing uses the same matcher (T5) |
| Duplicate canonical rows | Same-source firewall: zero mutation (T3) |
| False omission cards | Decomposition coverage suppresses omission (T3/T4) |
| Tombstoned billing returning | Tombstone matching migrated to facts engine (T3/T5) |

## Frozen scope

Accounting engines, GPT-5.6 Terra, prompt v8, schema v5, PDF ingestion limits, quotas, table schema and RLS are unchanged. The only database change is the narrow reset routine in Tranche 6. If any tranche appears to need a model-contract change, work stops and it is flagged.

## Risk areas

1. Retiring `signaturesIdentify()` without weakening fail-closed deletion (T3 tombstone-drift tests run before the property suite).
2. Review fingerprint churn reopening resolved items (explicit carry/reopen tests, T4).
3. Reset RPC concurrency and idempotency under lock-version contention (SQL suite, T6).
4. Fixture excerpt scope — bounded validated excerpts only, verified by a privacy assertion that no page corpus or prompt text enters the repo or the database.
5. Property test must be seeded and deterministic.
