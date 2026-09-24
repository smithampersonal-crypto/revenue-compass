# Review & Finalize presentation refinement

## Scope
- Keep each evidence label and its existing **Open PDF** action together in a compact wrapping row.
- Replace the first expanded passed-checks view with grouped, accountant-facing summaries assigned by a small explicit rule-ID mapping helper.
- Add a nested **Show technical validation details** disclosure containing the unchanged rule-by-rule messages and IDs for traceability.
- Preserve the source validation array, pass/fail state, severity, execution, and original order within each category and in technical details.

## Category presentation
Map known rule IDs directly—never parse message text, keywords, prefixes, or descriptions—to these headings and restrained summaries:
- Contract setup — Applicable contract-level checks passed.
- Performance obligations — Applicable performance-obligation checks passed.
- Standalone selling prices — Applicable SSP and allocation-input checks passed.
- Revenue recognition — Applicable recognition-method and timing checks passed.
- Accounting period — Applicable date-range and accounting-horizon checks passed.
- Other validation checks — Applicable additional checks passed.

Every passed result appears in exactly one category. Any future or unknown rule ID goes to **Other validation checks** rather than being omitted.

Render only categories containing passed results. Render **Show passed checks** only when at least one passed result exists.

Both **Show passed checks** and its nested **Show technical validation details** use native disclosures and start collapsed. The technical layer preserves the original rule-by-rule order, IDs, and descriptions.

## Verification
- Extend focused presentation tests for compact evidence-row structure, wrapping behavior, grouped passed checks, hidden IDs in the first layer, technical traceability, and immutable ordering.
- Add a conservation regression proving exact-once presentation grouping, no omissions or duplicates, unknown-ID fallback, and unchanged global ordering in technical details.
- Run the focused review/evidence tests, full test suite, typecheck, lint, production build, and bundle audit.
- Verify Review & Finalize at desktop and narrow widths, including no horizontal overflow and unchanged PDF action behavior.
- Confirm the preview build is clean.
