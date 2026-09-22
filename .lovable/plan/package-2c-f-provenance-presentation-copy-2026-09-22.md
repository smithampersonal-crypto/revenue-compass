# Package 2C-F — Provenance + Presentation Copy

## Scope

Implement only the accepted 2C-F presentation tranche. Preserve schema v6, prompt v10, provenance derivation and ownership, review behavior, AI merge and identity, Safe Re-analysis, canonical data, persistence, accounting, validation logic, authentication, quotas, and citation/PDF behavior. Do not begin 2C-G.

## Implementation

1. **Compact provenance marker**
   - Update `AiReviewTarget` to render restrained Lucide icon markers for untouched and accountant-edited AI provenance.
   - Keep the exact semantic strings `AI drafted` and `AI drafted · edited` as both `aria-label` and native `title`; hide the individual icons from assistive technology.
   - Keep those phrases out of visible field-adjacent text, visually distinguish edited provenance, and preserve review-marker precedence.
   - Leave manual content unmarked and retain visible `Your value preserved` semantics.
   - Preserve exact field/object lookup rules and canonical target anchors.

2. **Recruiter-facing structural copy**
   - Apply the specified Title Case mappings in contract balances, variable consideration, material rights, core reconciliation, contract modifications, revenue schedule, progressive outputs, grouped journals, combined balances, Step 4, Step 2, Review & Finalize, analysis status, and journal validation where the current headings exist.
   - Remove implementation-oriented suffixes only from structural headings, including `(engine output)` and `(read-only)`.
   - Use `Validation Checks`, `Validation Checks Passed`, `Validation Checks Require Attention`, `Validation checks require attention`, and `Journal Validation Checks` in the requested visible presentation locations.
   - Preserve field labels, table data labels, explanatory prose, raw validation tokens, engine messages, and source-derived content unless explicitly mapped.

3. **Focused regression coverage**
   - Update `AiReviewTarget` tests for icon presence, exact accessible names/tooltips, absence of visible repetitive provenance text, manual-state behavior, preserved override behavior, review precedence, and field/object isolation.
   - Update exact-target route tests to query the marker inside the canonical target rather than relying on `textContent`, without weakening sibling/parent isolation coverage.
   - Add focused semantic assertions for the required output headings, Step 4 copy, Review & Finalize validation copy, and journal validation copy.
   - Keep existing deterministic accounting expectations unchanged and use existing regressions to confirm allocation, schedules, balances, journals, reconciliation, and validation invariance.

4. **Verification and delivery**
   - Run focused provenance, exact-target, heading, validation-copy, and output-presentation tests.
   - Run the full normal verification suite: all tests, typecheck, lint, production build, and bundle audit.
   - Smoke-test the Horizon sample in the browser and inspect the relevant headings and provenance presentation at desktop and mobile widths.
   - Inspect the final diff for presentation-only scope and restore the frozen dependency baseline if platform tooling changed it: package range `^2.15.0`, lock resolution `2.15.0`.
   - Confirm `.env` remains untracked/ignored, update the roadmap, create and inspect a clean source ZIP excluding secrets, Git metadata, dependencies, and build output, and report the final commit hash.

## Acceptance boundaries

- No broad title-case rewrite, field-label rewrite, layout redesign, money-format change, evidence-panel change, highlight change, validation-token regrouping, model call, dependency addition, or database change.
- No accounting or provenance semantics change.
- Stop after Package 2C-F and await acceptance before any later tranche.
