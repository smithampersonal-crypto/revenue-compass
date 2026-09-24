# Package 2C-J — Review & Finalize Polish

## Scope

Implement only the accepted 2C-J presentation tranche. Preserve all review derivation, evidence authorization, finalization, accounting, persistence, AI, auth, and prior 2C-F–2C-I behavior. Do not begin 2C-K.

## Implementation

1. **Group evidence at the trusted projection boundary**
   - Replace the browser citation row shape with a narrow grouped presentation shape produced from each persisted review item.
   - Group only by trusted `documentId + pageStart + pageEnd`, preserving first-group order.
   - Retain one original persisted citation index for the existing evidence action.
   - Preserve distinct validated excerpts in original order and retain evidence-mode information internally.
   - Keep document IDs, filenames, paths, URLs, and signed-link material out of the browser DTO.

2. **Polish evidence rows without changing link behavior**
   - Render `Source Evidence · Page N` / `Source Evidence · Pages N–N` with a restrained file icon and aligned `Open PDF` action.
   - Give repeated buttons page-aware accessible names while keeping visible text exactly `Open PDF`.
   - Render each distinct excerpt directly beneath its grouped row.
   - Preserve pending/disabled state, `aria-busy`, review fingerprint, original citation-index authorization, disposable tab behavior, and server-returned physical `#page=` fragment.

3. **Remove repeated review headings**
   - Add one pure presentation helper that returns a single label when section and target labels match, otherwise `Section · Specific target`.
   - Apply it consistently to outstanding, routine-assumption, and resolved review items without changing target classification or navigation.

4. **Strengthen destination focus presentation**
   - Keep the existing exact-anchor lifecycle and 3.5-second removal timer unchanged.
   - Restyle `.arc-review-focus` with a pale amber surface and stronger amber ring suitable for an accounting workpaper.
   - Add one non-looping CSS ring/shadow flourish; disable only the animation under reduced motion while retaining the static highlight and existing action labels.

5. **Regression and smoke coverage**
   - Add projection tests for same-document grouping, distinct excerpts, ranges, different-document same-page separation, original citation index, and browser-boundary secrecy.
   - Update panel tests for exact copy, accessible names, pending behavior, heading deduplication across item states, and unchanged evidence action behavior.
   - Extend focus tests for yellow/red labels, assumptions, exact target, unchanged removal timing, CSS flourish existence, and reduced-motion fallback.
   - Browser-smoke a synthetic mixed review state at desktop and reduced motion; verify grouping, copy, heading cleanup, destination treatment, and console cleanliness.

6. **Verification and delivery**
   - Update `roadmap.md` for 2C-J only.
   - Restore `@lovable.dev/vite-tanstack-config` to `^2.15.0` with lock resolution `2.15.0` if the platform bump remains present.
   - Run focused tests, full tests, typecheck, lint, production build, and bundle audit.
   - Verify Genomix hash and repository/archive hygiene, then produce a tracked-source-only ZIP and report its SHA-256 and recorded commit hash.

## Expected production files

- `src/lib/arc/ai/review-dto.ts`
- `src/lib/arc/ai/review-presentation.ts`
- `src/components/arc/AiReviewPanel.tsx`
- `src/styles.css`
- Narrow focused test files and `roadmap.md`
- `package.json` / `bun.lock` only to restore the frozen dependency baseline

No database, persisted review-state, evidence handler contract, or analysis-route lifecycle change is planned.
