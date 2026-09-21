# ARC v1 — Safe Re-analysis Closure

- [ ] Pure safety firewall `src/lib/arc/ai/safe-reanalysis.ts` (same-source gate + exact-continuity decision)
- [ ] Early changed-source short circuit BEFORE `reserveAllowance` / `analyzer.analyze` (no quota, no Terra call)
- [ ] Defensive fingerprint re-check at the apply firewall
- [ ] Prior immutable `ai_runs.result_metadata` required for same-source re-analysis; `priorAnalysisLoad` status; fail closed
- [ ] Non-circular canonical relations: parent POs resolved independently first; only an exact proposal-PO → canonical-PO mapping may supply child relation evidence; same rule for VC targets; otherwise omit
- [ ] `first_run` narrowed: empty canonical draft only; non-empty accountant draft with no prior successful run must not get structural-bootstrap permission — fail closed
- [ ] `reanalysis_declined` failure code + `structurally_declined` presentation copy
- [ ] Tests: safe-reanalysis unit, orchestrator integration, Genomix regression, circular-inference regression
- [ ] Full verification: focused, full suite, typecheck, lint, build, bundle audit; both GitHub jobs green
