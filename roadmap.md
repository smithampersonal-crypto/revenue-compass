# ARC v1 — Safe Re-analysis Closure

## Package 1 — Recruiter First-Impression Hardening

- [x] Route the Home sample CTA to Horizon without changing other entry paths
- [x] Show the neutral starter state only when a manual draft has no meaningful contract/accounting input
- [x] Clarify temporary guest-session saving while preserving My Contracts messaging and authenticated copy
- [x] Run focused and full verification, package the repository, and report CI availability

## Package 2 — Portfolio / README Packaging

- [x] Replace the obsolete planning README with recruiter-first product documentation
- [x] Make Ayden’s authorship and contribution explicit in the purpose and architecture narrative
- [x] Capture three synthetic recruiter-story screenshots; scenarios may differ for clarity
- [x] Add the Horizon 5-minute walkthrough, compact architecture diagram, controls, scope, and verified quality claims
- [x] Verify documentation-only scope, package the repository, and report CI availability

## Package 2A — Visual Identity & Spacing Hardening

- [x] Replace the forced dark palette with one light-only finance-forward semantic token set
- [x] Keep the interface white-first; derive restrained light tints rather than applying every source hex at full strength
- [x] Preserve green product identity while keeping amber warnings and red blocking states distinct
- [x] Increase breathing room only where it improves usability; preserve nested and table density where padding would reduce working width
- [x] Widen the analysis workspace at desktop sizes while preserving centered responsive layouts
- [x] Certify Home, Analysis, deterministic output, and Review & Finalize across three viewport widths
- [x] Run focused and full verification, package the repository, and report CI availability

## Package 2A — Narrow Acceptance Patch

- [x] Correct the visual-system test's final newline only
- [x] Give solid destructive controls a light foreground while retaining dark text on pale danger notices
- [x] Add the smallest focused regression for the destructive-token split
- [x] Capture an existing warning/blocking state and run the complete combined verification
- [x] Package the clean patched repository and report CI availability

## Package 2A.1 — Horizon Sample Source Document

- [x] Add the supplied synthetic Horizon order form as a public static sample PDF without altering it
- [x] Show one read-only reference card only for `sample=horizon`, with compact pre-populated-demo disclosure
- [x] Keep the reference outside uploads, persistence, storage, AI, fingerprints, provenance, quotas, and Safe Re-analysis
- [x] Add focused Horizon/non-Horizon regressions while preserving guest and authenticated document behavior
- [x] Certify the Home → Horizon → Source Documents → View PDF flow and unchanged comparison flows
- [x] Run focused, adjacent, and full verification; package the clean repository; report CI availability

## Package 2B — README Screenshot Refresh

- [x] Replace the three accepted README screenshots in place using current synthetic application states
- [x] Preserve README prose, structure, image paths, and the Entry → AI evidence/control → deterministic output narrative
- [x] Optimize and inspect the three PNGs for README-scale legibility, visual consistency, and privacy
- [x] Confirm no application source, visual system, Package 2A.1 behavior, or product logic changed

## Package 2C-A — AI Accounting Label Contract

- [x] Add strict schema v6 accounting labels for AI Promises and Performance Obligations
- [x] Update the trusted prompt to v10 while preserving the complete v9 citation contract
- [x] Add frozen strict v5 parsing and explicit immutable-run version dispatch without rewriting history
- [x] Add focused schema, prompt, and legacy parsing regressions
- [x] Record the approved legacy-v5-to-v6 same-source transition cases for 2C-B/2C-C without implementing them in 2C-A
- [x] Run focused and relevant full verification, package the clean repository, and stop for independent acceptance

### Package 2C-A — Narrow Acceptance Patch

- [x] Restore `@lovable.dev/vite-tanstack-config` to the accepted `^2.15.0` baseline in `package.json` and `bun.lock`
- [x] Add `.env` / `.env.*` ignore rules (allowing `.env.example`) and exclude environment files from clean source archives
- [x] Make the prompt version code-authoritative (`AI_PROMPT_VERSION`) and remove the `ARC_AI_PROMPT_VERSION` relabelling seam
- [x] Add a hand-authored literal historical v5 fixture with rejection, dispatch, no-label-synthesis and fail-closed regressions
- [x] Untrack the previously committed `.env` — deleted and committed on GitHub `main` by the repository owner; `git ls-files .env` now returns nothing and the ignore rules prevent recommitting

## Package 2C-B — Canonical Presentation Labels

- [x] Add optional `PromiseDraft.displayName` while `description` stays the detailed interpretation
- [x] Accept `displayName` in canonical persistence validation backward-compatibly (absent loads, malformed fails closed)
- [x] Map AI Promise `accountingLabel` to `displayName` and AI PO `accountingLabel` to `PoDraft.name`
- [x] Keep the detailed PO interpretation in the immutable run result and AI review/provenance material
- [x] Presentation-label provenance: untouched AI labels refresh, manual and accountant-edited labels survive
- [x] Exclude the presentation PO `name` from the material accounting-edit projection so a rename is never a material edit
- [x] Legacy v5 to first v6 transition regressions: label refresh, edited-name survival, new promise label, stable IDs/topology, no material review item
- [x] Full verification: 204 files / 2627 tests, typecheck clean, lint 0 errors, production build and bundle audit clean

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
