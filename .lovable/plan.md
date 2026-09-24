# Package 2C-K final narrow acceptance patch

## Scope
- Restore `@lovable.dev/vite-tanstack-config` to range `^2.15.0` with lock resolution exactly `2.15.0`, then re-check both after all package/build steps.
- Remove the temporary `.lovable/plan.md` from delivered source while preserving `.lovable/project.json`, historical `.lovable/plan/`, and the ignore rule.
- Contain the Billing Schedule table in its section with horizontal scrolling; preserve all columns, labels, values, order, IDs, and accounting behavior.
- Make long Review & Finalize `Go to …` controls wrap within their cards without truncation; preserve full labels, state semantics, and navigation behavior.
- Preserve the approved homepage, validation, evidence, journal, currency, and all 2C-A through 2C-J presentation and behavior.

## Regressions
- Add a focused structural test proving the Billing Schedule table has horizontal-overflow containment.
- Add a focused Review & Finalize test with a deliberately long destination label, proving safe width, normal wrapping, automatic height, full copy, and unchanged item-ID callback.

## Verification and delivery
- Run focused presentation tests, the full test suite, typecheck, lint, production build, and bundle audit.
- Smoke-test desktop and approximately 390px views for Billing Schedule containment, long `Go to …` wrapping, unchanged homepage, Review & Finalize, validation presentation, and journal geometry.
- Re-check dependency versions, approved currency copy, Genomix SHA-256, and repository hygiene after the final build.
- Update only the Package 2C-K roadmap status after verification, preserving the completed Terra and GitHub/database evidence and leaving 2B.1, Package 3, and production readiness incomplete.
- Create and inspect a clean source ZIP excluding dependencies, build output, Git data, secrets, transient plans, and diagnostics; report its file count and SHA-256 plus the final repository commit hash.
- Stop after this patch; do not begin 2B.1 or Package 3.
