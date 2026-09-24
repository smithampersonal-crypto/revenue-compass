# Review & Finalize presentation refinement

## Scope
- Keep each evidence label and its existing **Open PDF** action together in a compact wrapping row.
- Replace the first expanded passed-checks view with grouped, accountant-facing summaries derived only from each result’s existing `category` field.
- Add a nested **Show technical validation details** disclosure containing the unchanged rule-by-rule messages and IDs for traceability.
- Preserve the source validation array, pass/fail state, severity, execution, and original order within each category and in technical details.

## Category presentation
Use only the engine’s supplied categories—never message text or rule IDs—to assign headings:
- `contract` → Contract setup
- `performance_obligations` → Performance obligations
- `allocation` → Standalone selling prices
- `revenue` → Revenue recognition

Accounting-period and horizon checks remain under Revenue recognition because the current trusted result type does not expose a separate category; splitting them would require inferring meaning from internal IDs or copy.

## Verification
- Extend focused presentation tests for compact evidence-row structure, wrapping behavior, grouped passed checks, hidden IDs in the first layer, technical traceability, and immutable ordering.
- Run the focused review/evidence tests.
- Verify Review & Finalize at desktop and narrow widths, including no horizontal overflow and unchanged PDF action behavior.
- Confirm the preview build is clean.
