# ARC v1 — Safe Re-analysis Closure

## Package 1 — Recruiter First-Impression Hardening

- [x] Route the Home sample CTA to Horizon without changing other entry paths
- [x] Show the neutral starter state only when a manual draft has no meaningful contract/accounting input
- [x] Clarify temporary guest-session saving while preserving My Contracts messaging and authenticated copy
- [x] Run focused and full verification, package the repository, and report CI availability

## Package 2 — Portfolio / README Packaging

- [ ] Replace the obsolete planning README with recruiter-first product documentation
- [ ] Make Ayden’s authorship and contribution explicit in the purpose and architecture narrative
- [ ] Capture three synthetic recruiter-story screenshots; scenarios may differ for clarity
- [ ] Add the Horizon 5-minute walkthrough, compact architecture diagram, controls, scope, and verified quality claims
- [ ] Verify documentation-only scope, package the repository, and report CI availability

- [x] Pure safety firewall `src/lib/arc/ai/safe-reanalysis.ts` (same-source gate + exact-continuity decision)
- [x] Early changed-source short circuit BEFORE `reserveAllowance` / `analyzer.analyze` (no quota, no Terra call)
- [x] Defensive fingerprint re-check at the apply firewall
- [x] Prior immutable `ai_runs.result_metadata` required for same-source re-analysis; `priorAnalysisLoad` status; fail closed
- [x] Non-circular canonical relations: parent POs resolved independently first; only an exact proposal-PO → canonical-PO mapping may supply child relation evidence; same rule for VC targets; otherwise omit
- [x] `first_run` narrowed: empty canonical draft only; non-empty accountant draft with no prior successful run must not get structural-bootstrap permission — fail closed
- [x] `reanalysis_declined` failure code + `structurally_declined` presentation copy
- [x] Tests: safe-reanalysis unit, orchestrator integration, Genomix regression, circular-inference regression
- [x] Full verification: 194 files / 2542 tests, typecheck clean, lint 0 errors, production build OK
- [ ] GitHub Actions rerun — blocked: `gh` CLI unavailable in this sandbox
