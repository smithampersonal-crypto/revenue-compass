# Cross-Run Structural Identity — Implementation Plan (Design Rev 3 + Amendment 3A)

Governing invariant: on same-source re-analysis, absent an explicit accountant structural edit, the canonical ID sets for promises, POs, VC components, consideration events and projected collections are invariant. AI may change alignments, review state, exact-match aliases and eligible untouched AI-owned fields only.

No code is written until each tranche is reviewed and committed in order. No schema migration; alignments live in the existing JSONB AI sidecar. No raw page text or prompt text is newly persisted.

## Where merge.ts must shrink, not grow

`merge.ts` keeps orchestration only. All new logic lands in focused pure modules it delegates to:

- `identity-facts.ts` (new) — build identity facts/signals from proposals and incumbents.
- `identity-graph.ts` (new) — candidate relation graph, sufficiency matrices, mutual uniqueness, alignment outcomes.
- `structural-firewall.ts` (new) — same-source zero-mutation gate, manual-first-run gate, omission symmetry.
- `alignment-state.ts` (new) — ProposalAlignment state, encode/decode, epoch reset.
- existing `billing-identity.ts` — adapted, economic design unchanged.

Each is pure: no clock, no randomness, no I/O, inputs never mutated.

## Tranche 1 — Production fixtures + alignment state model

Files: new `src/lib/arc/ai/__tests__/production-runs/{run1,runA,runB}.fixture.ts` (sanitized structural facts only — semantic keys, types, citation document/page identity, normalized descriptions, rates/units, billing terms; no contract prose), new `src/lib/arc/ai/alignment-state.ts`, new `src/lib/arc/ai/__tests__/alignment-state.spec.ts`; modify `src/lib/arc/ai/merge.ts` (type only), `src/lib/arc/ai/state-serialization.ts`.

Interfaces: `ProposalAlignment { proposalKey, canonicalIds[], relation: "exact" | "subsumes" | "split_from" | "unmapped", runId, materialFingerprint }`, `AlignmentRelationState`, `encodeAlignments/decodeAlignments`.

Tests first (red): fixtures load and assert Run 1 = 4 promises/3 POs/2 VC/2 CE/2 CC; Run A/B key, type, citation and decomposition drift are present in the fixture data; alignment state round-trips through `toPersistedAiState`; a pre-alignment sidecar decodes to empty alignments; Undo snapshot carries alignments.
Red condition: modules do not exist / alignments dropped by serializer.
Green gate: focused specs. Regression gate: serializer + tombstone suites. Checkpoint: commit; zero production merge behavior changed.

## Tranche 2 — Pure graph reconciliation engine

Files: new `src/lib/arc/ai/identity-facts.ts`, new `src/lib/arc/ai/identity-graph.ts`, new specs for each; `reconciliation.ts` retained only as thin compatibility surface for callers not yet migrated.

Decision: `reconcileByIdentity()` is replaced, not evolved — its scalar "first shared corroborator decides" rule cannot express 1:N/N:1. It stays exported until Tranche 3 removes the last caller.

Interfaces: `IdentityFacts { anchors, normalizedText, typeFacts, structuralMembership, terms }`, `CandidateEdge { proposalKey, canonicalId, signals, sufficiency }`, `resolveIdentityGraph(proposals, incumbents, rules): Map<string, AlignmentOutcome>`, `AlignmentOutcome = exact | subsumes | split_from | ambiguous | unmapped`.

Per Amendment 3A: document-ID mismatch is not a hard contradiction; anchor intersection (not equality) corroborates; accounting judgments (promise type, satisfaction pattern) are not identity gates but corroborating signals.

Tests first (red): page-3 vs pages-1+3 intersects → exact; `professional_service` ↔ `support` no longer blocks; 1 proposal covering 2 incumbents → subsumes; 2 proposals covering 1 incumbent → split_from; contended pairing → ambiguous; fabricated extra object → unmapped; input order never changes the result; no draft mutation inside the layer.
Green gate: graph specs. Regression gate: existing identity suites. Checkpoint: commit.

## Tranche 3 — Firewall + merge integration

Files: new `src/lib/arc/ai/structural-firewall.ts` + spec; modify `merge.ts` (delegate, remove inline reconciliation), `edit-reconciliation.ts` (shared classifier reuse), `identity-backfill.ts`.

Rules implemented: same-source run performs zero structural mutation — no mint, delete, merge or split; `subsumes`/`split_from` record topology only; `unmapped`/`ambiguous` mutate nothing and raise blocking review; provenance field merge runs only for `exact` alignments and only on untouched AI-owned fields; incumbents covered by a decomposition alignment are never reported omitted; a first AI run over manual structure is firewalled the same way.

Tests first (red): Run 1 → Run B produces identical canonical ID sets and 0 new rows; accountant-owned Phase L facts untouched; decomposition-covered incumbents raise no omission.
Green gate: merge specs. Regression gate: full `src/lib/arc/ai` suites. Checkpoint: commit.

## Tranche 4 — Structural review lifecycle

Files: modify `review-state.ts`, `review-normalization.ts`, `src/components/asc606-workflow/presentation.ts`, `src/routes/analysis/review.tsx` if navigation targets need anchors; specs alongside.

Reasons wired into existing R3 validation, fingerprints, carry/reopen, navigation and finalization blocking: `unmapped_ai_proposal`, `unsafe_semantic_relationship`, `ai_proposal_omitted`. No new manual identity-remapping UI. An unchanged material fingerprint carries a prior resolution forward; a changed structural proposal reopens.
Green gate: review specs. Regression gate: navigation/finalization suites. Checkpoint: commit.

## Tranche 5 — Billing under the graph

Files: modify `billing-identity.ts`, `merge.ts` billing passes, `tombstones.ts` only if the classifier needs the shared facts type.

Economic design unchanged. Schedule identity adopts anchor intersection and the new fact taxonomy so Run A's page-3 citation reconciles to Run 1's pages 1+3. Event/collection canonical IDs reused per deterministic schedule period; period-scoped tombstones and the actual-cash deletion guard untouched.
Green gate: billing-lineage, billing-deletion and legacy-upgrade suites all green unchanged plus the new drift case. Checkpoint: commit.

## Tranche 6 — Reset / bootstrap / source change

Files: modify `alignment-state.ts` (epoch), `workspace.handlers.ts`, `runs.store.server.ts`, `analysis-context.tsx` for the Reset action surface.

Behavior: empty draft with history is treated defensively (never a free bootstrap); explicit Reset Analysis atomically clears draft structure, provenance, tombstones, reviews, alignments and active source fingerprint/stale acknowledgement, opening a fresh epoch, while immutable `ai_runs` history is preserved; a changed source fingerprint stages unmatched proposals for accountant review instead of auto-creating contract modifications.
Green gate: reset/bootstrap specs. Regression gate: workspace + autosave suites. Checkpoint: commit.

## Tranche 7 — Production acceptance + property suite

File: new `src/lib/arc/ai/__tests__/production-runs-reconciliation.spec.ts`.

Cases: Run 1 → Run A; Run 1 → Run B; Run 1 → Run A → Run B. Each asserts 4 promises, 3 POs, 2 VC components, 2 consideration events, 2 projected collections, identical canonical ID sets, all Phase L accountant facts preserved, no false omissions. Adversarial: false subsumption rejected; contending proposals ambiguous; judgment/taxonomy drift tolerated; cross-document evidence drift tolerated; fabricated same-source object → blocking review, zero rows; tombstoned billing object stays deleted under a renamed alias. Property test: seeded perturbation of keys, types, citation pages and decomposition over the same source always preserves the canonical ID sets.

## How each observed live failure is prevented

| Failure | Prevented by |
| --- | --- |
| Semantic-key drift | Keys are aliases only; identity from facts (T2) |
| Page 3 ↔ pages 1+3 | Anchor intersection, not equality (T2/T5) |
| professional_service ↔ support | Judgment facts corroborate, never gate (T2) |
| 4 ↔ 3 promise decomposition | subsumes/split_from topology (T2/T3) |
| $1.35 usage citation drift | Terms corroborate when anchors shift (T2) |
| Billing schedule drift | Billing adopts the same facts (T5) |
| Duplicate canonical rows | Same-source firewall: zero mutation (T3) |
| False omission cards | Decomposition coverage suppresses omission (T3/T4) |
| Tombstoned billing returning | Period-scoped tombstones consulted before reuse (T5) |

## Final gate

Focused tests, full suite, typecheck, lint, production build, bundle audit, both GitHub CI jobs. GitHub green is not accepted as proof of the live regression: after deployment we Undo Run B and perform one controlled live Genomix re-analysis for confirmation.

## Risk areas

1. Alignment state size/back-compat in the JSONB sidecar (mitigated by T1 round-trip tests).
2. Removing `reconcileByIdentity` callers without silently changing billing behavior (T2 keeps it exported until T3).
3. Review fingerprint churn reopening resolved items (explicit T4 carry/reopen tests).
4. Property test flakiness — seeded and deterministic only.
5. Schema v5 is frozen; if any tranche appears to need a model-contract change, work stops and it is flagged rather than changed.
