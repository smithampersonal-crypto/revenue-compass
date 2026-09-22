# Package 2C-F.1 — Inline Provenance Presentation Refinement

## Scope
Refine only the accepted provenance presentation. Keep every provenance value, ownership rule, review rule, accounting value, and money-input behavior unchanged. Stop before Package 2C-H.

## Implementation
1. **Inline presentation context**
   - In `AiReviewTarget`, continue resolving the exact target’s open review item and field/object provenance exactly as today.
   - Provide only the ordinary field presentation label (`AI drafted` or `AI drafted · edited`) to descendants through a small React context.
   - Export one quiet, accessible marker used by label-bearing controls: unboxed Sparkles, plus PencilLine for edited content; exact `aria-label` and `title`; SVGs remain `aria-hidden`.
   - Keep unresolved yellow/red markers in their existing position and suppress provenance for that target.
   - Keep `Your value preserved` unchanged.

2. **Common labels**
   - Update `Field` so the marker follows its visible label on the same line.
   - Update `JudgmentControl` so the marker follows its legend on the same line.
   - Preserve label/input and fieldset/legend semantics, hints, keyboard access, and all existing values and handlers.

3. **Object and custom targets**
   - Stop rendering ordinary object-level AI provenance as a standalone badge; retain object provenance data and all object-level yellow/red review markers.
   - Step 2 Promise and Performance Obligation cards will therefore lose their floating object badge while their exact field labels and judgment legends retain provenance.
   - For non-`Field`/non-`JudgmentControl` targets, use the same marker only where an existing visible label is an obvious direct placement. Do not introduce a generalized layout framework. Composite/group targets without one canonical label will retain their provenance data and review anchors but will not gain a replacement standalone ordinary-AI row.

4. **Single workspace legend**
   - Add one restrained `AI drafted · Hover for provenance` legend beside the editable analysis heading.
   - Show it once only when the current workspace contains at least one `ai_generated_untouched` or `ai_generated_user_edited` field provenance entry; hide it for manual-only workspaces.

5. **Focused regressions**
   - Update the provenance component tests for inline Field and JudgmentControl placement, edited/untouched accessibility, manual omission, preserved-value behavior, review precedence, and removal of ordinary object badges.
   - Add a focused Step 2 presentation test covering Promise Name, Description / Interpretation, both distinctness judgments, and absence of floating/standalone badges.
   - Add workspace-legend present-once/manual-absent coverage.
   - Keep exact-target ownership tests and the Package 2C-G formatting/provenance regression passing.

6. **Tracking and frozen baselines**
   - Append only the accepted Package 2C-G and current Package 2C-F.1 entries to `roadmap.md`.
   - Restore `package.json` and `bun.lock` to the accepted 2.15.0 baseline if the platform changes them again.
   - Preserve the Genomix fixture and `.env` hygiene.

## Verification and delivery
- Run the focused provenance, Step 2, exact-target, and Package 2C-G provenance suites.
- Run full verification, typecheck, lint, production build, and bundle audit.
- Browser-smoke Horizon Step 2 at desktop size, checking inline markers, one quiet legend, no floating Promise/PO badges, review precedence, and console health.
- Produce a clean source ZIP and report changed files, behavior/semantic confirmations, test totals, smoke result, dependency and fixture hashes, hygiene, commit hash, and ZIP hash.
