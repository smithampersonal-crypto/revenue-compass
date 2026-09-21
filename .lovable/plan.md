# ARC v1 — Package 2A: Visual Identity & Spacing Hardening

## Scope

Refine ARC’s existing interface into one light-only, finance-forward visual system. Preserve all product behavior, accounting density, navigation, workflows, warning meanings, and accepted Package 2 documentation assets.

## Implementation

1. **Central light semantic palette**
   - Replace the current forced dark values in `src/styles.css` with a single light token set.
   - Use an off-white warm-neutral canvas, white cards/popovers, near-black text, `#DAD7CD`-family borders, `#3A5A40` primary actions, `#344E41` focus/strong emphasis, restrained `#588157` positive accents, and a pale `#A3B18A`-derived selected surface.
   - Keep neutral and disabled surfaces neutral rather than green.
   - Retain distinct accessible amber warning and red destructive tokens; do not alter their meaning or component logic.
   - Set `color-scheme: light`; remove the duplicate dark-only token block without adding theme switching or system preference logic.

2. **Shared surface and control hierarchy**
   - Preserve existing radii, control shapes, semantic utility classes, and component structure.
   - Tune shared button, navigation, input, focus, and selected-state presentation only where the new tokens do not provide sufficient contrast.
   - Keep focus indicators visibly distinct on white and pale-green surfaces.
   - Apply restrained borders and existing shadow conventions; add no gradients, glass effects, or decorative green regions.

3. **Spacing and desktop width**
   - Widen the shared analysis workspace and header alignment from `max-w-6xl` to `max-w-7xl`; keep Home at its current narrower composition.
   - Raise major shared workpaper section padding from 16px to 20px on suitable desktop surfaces while retaining compact mobile padding.
   - Keep nested judgment/input panels near 16px and leave table cell, journal-row, schedule-row, rollforward, badge, and button density unchanged.
   - Make only isolated spacing corrections revealed by visual inspection; do not normalize unrelated classes.

4. **Focused regression protection**
   - Reuse the existing app-shell, analysis-navigation, accordion, status, AI-review, and workpaper suites to protect behavior and semantic states.
   - Add a narrowly scoped visual-system regression only if inspection reveals an uncovered risk, such as loss of distinct primary/warning/destructive tokens; avoid broad utility-class snapshots.

## Manual Certification

Inspect the local production-equivalent preview using synthetic data on:

- Home.
- Horizon ASC 606 Analysis.
- Horizon Revenue Schedule plus at least one balances or journals surface if needed to validate density.
- Review & Finalize, including available normal, amber, and red states.

Check each at 1440px wide desktop, 1280px laptop/desktop, and one narrow viewport around 390px. Confirm no horizontal page overflow, no control collisions, usable long labels, compact tables, clear focus/selected states, and no leftover dark-theme fragments.

## Verification and Delivery

- Run relevant focused and adjacent UI/component tests.
- Run the complete application test suite, TypeScript check, lint, production build, and bundle audit.
- Inspect the final build log and the four required surfaces manually.
- Confirm the final diff contains no accounting, AI, identity, Safe Re-analysis, auth, persistence, database, sample-data, routing, or README screenshot changes.
- Run both GitHub Actions jobs if the environment provides access; do not change CI if it does not.
- Commit the final revision and create a clean repository ZIP excluding secrets, dependencies, build output, Git metadata, and private planning metadata.

## Explicitly Out of Scope

- Product behavior or information-architecture changes.
- Accounting, validation, finalization, AI, citation, identity, Safe Re-analysis, persistence, auth, RLS, database, quota, routing, PDF, API, or sample-data changes.
- Theme toggles, dark-mode maintenance, new fonts, new component systems, broad responsive redesigns, or unrelated styling cleanup.
- README prose or replacement/recapture/editing of the three Package 2 screenshots.
- Package 2B or Package 3 work.