# Package 2C-I — Contract Modifications + Contract Balances Polish

## Scope and boundaries

Implement presentation-only refinements for the Contract Modification and Contract Balances editors. Preserve deterministic accounting, canonical IDs and ordering, validation rules/severity, provenance, persistence, AI behavior, money parsing/blur formatting, authentication, and the frozen 2C-H progress presenter. Do not begin 2C-J.

Magic-link delivery remains a known pre-production limitation deferred to Package 3 production SMTP/Resend. Guest PDF upload is working. Neither workflow will be changed or made a 2C-I test dependency.

## Implementation

1. **Contract Modification header layout**
   - Restructure the existing effective-date and change-in-consideration fields into a responsive two-column grid.
   - Keep labels/helpers in a consistent header area so the date and amount/direction controls align vertically on desktop.
   - Stack the fields naturally on narrow screens without overflow.
   - Preserve all existing values, callbacks, AI review target keys, provenance markers, and `UsdMoneyInput` behavior.

2. **Deterministic friendly billing labels**
   - Add one small browser-safe presentation helper for labels derived from current array position: `Billing Event N` and `Cash Collection N`.
   - Derive aliases from the current rendered order only; never sort, persist, or substitute them for canonical IDs.
   - Add an ID-to-friendly-label lookup for presentation and issue grouping. Missing references display `Unavailable billing event` and are never reassigned.

3. **Billing and cash presentation**
   - Rename the input section to the existing structural term `Billing Schedule`.
   - Replace visible card headings and related-event option text with friendly labels.
   - Format a valid selector amount through the existing exact cents parser/formatter, for example `Billing Event 1 — $60,000.00`; omit the amount when unavailable or invalid.
   - Keep option values, React keys, test identifiers, review targets, state updates, deletion behavior, and all canonical IDs unchanged.
   - Omit optional Complete/Incomplete badges unless row-level status can be derived from existing findings without assumptions; current issue identifiers are mostly rule-level rather than row-qualified, so the default is to omit them.

4. **Validation presentation**
   - Add a narrow presentation adapter that maps existing issue message prefixes containing canonical billing/cash IDs to their friendly row labels and groups all matched findings beneath that row.
   - Preserve every issue object’s order, text content after the identity prefix, severity, blocking/warning list, and canonical metadata internally.
   - Leave global and engine-level findings ungrouped under their existing blocking/warning sections.
   - Where an engine message contains a known raw billing ID only as display copy, replace that occurrence at render time; unknown/orphan references remain explicit and are not given fabricated ordinals.

5. **Roadmap and repository hygiene**
   - Record Package 2C-I only in `roadmap.md`, including the known auth limitation and completion checks.
   - Restore and preserve `@lovable.dev/vite-tanstack-config` as `^2.15.0` with `bun.lock` resolving 2.15.0; do not accept the recurring 2.23.1 bump.
   - Keep `.lovable/plan.md` ignored and remove the temporary active plan before final packaging; preserve `.lovable/project.json` and historical `.lovable/plan/` files.
   - Keep `.env` untracked and exclude environment files, dependencies, build output, and Git metadata from the source archive.

## Tests

- Add focused component regressions for the responsive modification-header structure and canonical updates for date, amount, and direction.
- Add a two-event/two-collection fixture proving friendly visible headings, no raw IDs in recruiter-facing text, deterministic ordering, exact selector amount labels, canonical option values, and canonical selection updates.
- Add row-grouping coverage with multiple findings on one row, preserving all findings and severity, plus orphan-reference presentation.
- Preserve existing modification treatment/output and accounting-engine expectations unchanged; run representative balance, rollforward, reconciliation, journal, modification allocation, and revenue-schedule suites.

## Verification

- Run focused tests, then the full test suite, typecheck, lint, production build, and bundle audit.
- Browser-smoke an editable synthetic analysis at desktop and narrow widths with multiple billing events, cash selection, validation findings, comma-formatted money, and Contract Modification visible; verify no horizontal overflow or console errors and spend no Terra allowance.
- Inspect the final diff and build diagnostics, confirm canonical/accounting outputs did not change, verify the dependency baseline, `.lovable` history, Genomix PDF SHA-256 `7487979e42fb2dab23c6a6b4858806ae0d37831c63c0ddd98730fccf09fdd4c7`, and `.env` hygiene.
- Create a clean source ZIP, report its hash and final commit hash, then stop before Package 2C-J.
