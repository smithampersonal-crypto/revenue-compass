# Package 2C-K — Narrow Visual Acceptance Patch

## Scope
Polish the existing ARC homepage, simplify Validation Checks for recruiter-facing review, and align analysis-summary metadata. Preserve all accounting, AI, validation, persistence, evidence, quota, authentication, and database behavior. Do not begin 2B.1 or Package 3.

## Implementation

### Homepage
- Keep the existing structure and visual system.
- Replace the hero support copy with the approved primary and secondary sentences, using restrained hierarchy.
- Keep all three entry paths unchanged; add “Start here” to the sample card and make only “Try the Sample” the primary forest-green action.
- Keep the cards equal-height through grid/flex layout and aligned action placement, without fixed heights.
- Rename the global navigation action from “Analyze” to “New Analysis” without changing its destination.
- Replace the three Why ARC descriptions with the approved architecture language, including “Traceable review.”
- Add the approved one-line description below “What ARC produces,” preserving the five outputs and their order.
- Modestly reduce only the excessive gap before Why ARC.

### Validation Checks
- Derive passed, blocking, and warning display groups from the existing validation result without mutating it.
- In the all-valid state, show “All validation checks passed” and “No blocking issues were identified.”
- In attention states, show actionable Blocking issues first, then Warnings.
- Put passed details and internal rule IDs inside a native, keyboard-accessible disclosure labelled “Show passed checks,” collapsed by default.
- Keep validation execution, rule IDs, severity, ordering, and blocking semantics unchanged.

### Analysis summary
- Render Customer and Performance Obligations in one metadata column.
- Render Contract and Transaction Price in the second metadata column.
- Preserve all other summary values, states, badges, actions, and modification metrics; let the columns stack naturally on narrow screens.
- Add stable presentation hooks only where needed for structural tests; do not use pixel-position assertions or spacer hacks.

## Regression coverage
- Update homepage tests for both approved hero sentences, “New Analysis,” “Start here,” primary sample action styling, preserved entry behavior, Why ARC copy, and the unchanged output sequence.
- Add Validation Checks tests for the all-pass summary, initially collapsed passed details, disclosure semantics/expansion, and blocking-then-warning ordering while confirming the supplied validation object is unchanged.
- Add analysis-summary tests for the two intended metadata columns and preservation of existing values/actions.

## Acceptance and verification
- Smoke-test homepage, analysis summary, and Validation Checks at desktop and 390px-like widths, checking alignment, wrapping, stacking, action usability, and horizontal overflow.
- Reconfirm the two earlier narrow-width corrections already present in 2C-K.
- Run focused presentation tests, then the full test suite, typecheck, lint, production build, and bundle audit.
- Restore and verify `@lovable.dev/vite-tanstack-config` at `^2.15.0` with lock resolution `2.15.0`; verify environment, planning, historical-plan, Wrangler, TypeScript-build metadata, and Genomix fixture protections/hash.
- Record final 2C-K results in the roadmap and produce the clean source archive/final report after all gates pass. The completed controlled Terra run remains valid; no additional live run or database run is required for this presentation-only patch.
