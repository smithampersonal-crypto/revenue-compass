# Package 2C-H — AI Progress Presenter

## Scope

Replace only the existing four-card AI progress display with one compact continuous bar. Preserve all accepted 2C-F.1 and 2C-G behavior, every authoritative AI stage and orchestration rule, and stop before 2C-I.

## Implementation

1. **Replace the four-card presenter**
   - Refactor `AiAnalysisProgress` to render one status headline, one outlined track, and one filled region.
   - Use the exact Title Case headline for each authoritative stage: `{Stage} · Step {n} of 4`.
   - Derive the fill width directly from the existing authoritative `progress.step`: 1 → 25%, 2 → 50%, 3 → 75%, 4 → 100%.
   - Expose stable semantic/data attributes for stage and step verification; show no percentage, ETA, elapsed-time estimate, icons, stage list, or segmented cards.

2. **Add restrained activity motion**
   - Add a CSS-only soft highlight inside the filled region while leaving its stage-derived boundary fixed.
   - Disable that animation under `prefers-reduced-motion`.
   - Use existing ARC primary, border, and warm-neutral tokens; keep the bar thin, rectangular, and width-safe on narrow screens.

3. **Preserve integration and accessibility**
   - Keep `AiAnalysisAction` behavior and its existing `ai.active && ai.progress` render gate unchanged.
   - Retain `role="status"`, `aria-live="polite"`, and accessible name `AI analysis progress`.
   - Announce the current stage and step once, without hidden duplicate stage lists.
   - Do not change `workspace-client.ts`, stage derivation, polling, retries, quota, locks, source handling, validation, model calls, or apply behavior.

4. **Focused regressions**
   - Update the component tests to prove all four exact headlines and fixed stage positions.
   - Prove exactly one track and one fill render, and that the old four-card/list presentation is absent.
   - Prove no visible percentages or timing/ETA copy.
   - Prove the presenter has no timer-driven advancement and that shimmer styling is confined to the filled region with reduced-motion disabled in CSS.
   - Keep provider/controller orchestration tests intact, including validation as a distinct phase and reconnect-without-execution behavior.

5. **Verification and delivery**
   - Visually inspect fixture-driven active states at desktop and narrow/mobile widths, including reduced motion, overflow, action controls, and console output.
   - Run focused AI progress/workspace tests, then the full suite, typecheck, lint, production build, and bundle audit.
   - Update `roadmap.md` only with Package 2C-H completion status.
   - Restore `@lovable.dev/vite-tanstack-config` to `^2.15.0` and `bun.lock` to resolved 2.15.0 if the platform auto-bump persists.
   - Confirm `.lovable/plan.md` remains ignored/untracked, the Genomix PDF hash remains unchanged, environment files are absent from source, then create a clean tracked-source ZIP and report the commit hash.

## Expected Files

- `src/components/arc/AiAnalysisProgress.tsx`
- `src/styles.css`
- `src/components/arc/ai-analysis-workspace.spec.tsx`
- Narrowly related progress/provider test files only if assertions require updating
- `roadmap.md`
- `package.json` and `bun.lock` only to restore the frozen dependency baseline if auto-bumped

## Guardrails

- No orchestration, controller, server, database, persistence, accounting, provenance, review, money-formatting, PDF/citation, or other presentation changes.
- No dependency additions and no generalized loading framework.
- No live Terra call.
- Stop after Package 2C-H verification and packaging; do not begin 2C-I.
