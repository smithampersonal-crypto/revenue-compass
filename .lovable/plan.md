# Phase 9G — AI Controls, Review, Navigation, and Restore

Adopt the uploaded Phase 9G plan as authoritative. Implement Tasks 1–10 in order, strict TDD, pausing after each task with RED/GREEN evidence for your review gate.

## Ground rules carried into every task

- Phase 9F stays frozen in contract and behaviour, not in file list: `arc.ai.schema.v3`, prompt v4, citation-anchor and validation semantics, model configuration, the one-generative-call rule, and the deterministic accounting engines are unchanged. Task 1 may extend review-derivation and merge plumbing where the authoritative Phase 9G plan requires it.
- No OpenAI call of any kind during Tasks 1–10. The controlled Genomix walkthrough in the final acceptance checklist is requested separately after Task 10.
- AI never runs automatically — not from edits, source changes, affirmation, resolution, restore, or finalization.
- Quotas unchanged: 3 runs per 9-hour guest workspace, 10 per account per UTC month; Re-analyze counts exactly like Analyze.
- The browser may request a review action but never authors review arrays, timestamps, fingerprints, actor identity, acknowledgement fingerprints, or resolved state.
- No user-facing model names, prompts, schema versions, internal codes, or raw provider errors.
- No embedded PDF viewer, no public Guidance library: inline excerpt, signed PDF link at the cited physical page in a new tab, in-app Guidance card dialog.
- Existing Phase 9F review rows stay readable through explicit normalization.
- No rewriting of published Git history.

## Task sequence and stop points

Each task ends with: focused RED evidence, minimal implementation, focused GREEN evidence, the adjacent regression suite, a browser/server boundary review of the diff, a commit — then I stop and report.

1. **Pure review model and re-analysis carry-forward** — `reviewFingerprint`, typed resolutions (affirmed / manual red), `carryForwardReviewResolutions()`, `normalizePersistedReviewItems()` for legacy rows, validated citation material threaded into `mergeAiAnalysis()` review derivation.
2. **Server-owned review events, resolution RPCs, stale-source acknowledgement** — new migration written and fully verified locally, **not applied**. I stop with the migration diff, RLS/RPC changes, expected data impact, and verification results, and wait for your explicit approval before it touches the Cloud database.
3. **Safe AI workspace server API and failure-presentation registry** — `workspace.handlers.ts`, `workspace.store.server.ts`, `workspace.functions.ts`, `caller.server.ts`, deterministic safe failure copy.
4. **Edit reconciliation during autosave** — pure detection of direct user edits to reviewable targets, provenance clearing, user-edit resolution.
5. **`AnalysisContext` wiring** — nested `ai` object: workspace state, run control, polling/reconnect to an active run, quota, source locking.
6. **Deterministic review navigation and inline review infrastructure** — target→workflow registry, ordering (all red first, then yellow in workflow order), `ReviewStateField`, section summaries.
7. **Review state and provenance across Steps 1–5 and Additional Topics** — accessible, never color-only; provenance icon marks untouched AI-owned inputs only.
8. **A-lite evidence and in-app Guidance cards** — signed PDF page-fragment links, Guidance card dialog.
9. **Review & Finalize summary, exact stale-source gate, failure UX, restore** — grouped summary, acknowledgement bound to the exact current source fingerprint, single-confirmation restore of the most recent server-declared restorable run.
10. **End-to-end acceptance, security regressions, release gate** — full suite, typecheck, lint, build, bundle audit, Guidance validation, SQL suites, and the final acceptance checklist read back item by item.

## Verification per task

`bun test <focused specs>` for RED/GREEN; then the adjacent regression suite named by the task. At Task 10: `bun run test`, `typecheck`, `lint`, `build`, `audit:bundle`, `guidance:check`. Database suites need Docker, so they run in CI — I will ask you to confirm both GitHub jobs.

## Open item at the end

After Task 10 I will report the complete acceptance readback and then request authorization for one controlled fictional Genomix walkthrough. No generative call happens before that approval.
