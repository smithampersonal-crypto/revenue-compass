# Package 2C-H — Progress Presenter Visual Refinement

## Scope
- Refine only the existing AI progress presenter and its focused presentation tests.
- Keep the four authoritative orchestration stages and all AI, accounting, persistence, review, security, and source behavior unchanged.
- Update the existing 2C-H roadmap wording narrowly; do not begin 2C-I.

## Implementation
- Replace equal-width fill classes with presentation metadata for each authoritative step:
  - Step 1: confirmed 0, activity 0–12
  - Step 2: confirmed 12, activity 12–82
  - Step 3: confirmed 82, activity 82–92
  - Step 4: confirmed 92, activity 92–100
- Render one continuous track containing two separate layers: a fixed solid confirmed fill and a clipped active-stage region.
- Animate only a light, translucent activity front inside the current stage span using narrowly scoped CSS. It will sweep, fade out before reset, and repeat without moving the confirmed boundary.
- Allow only a short CSS transition on the solid confirmed fill when the authoritative step changes; never move it from time or elapsed duration.
- Under reduced motion, disable the sweep and show a small static cue near the confirmed boundary rather than tinting the full unconfirmed stage span.
- Preserve the exact stage headlines, status semantics, single announcement, compact layout, and absence of percentages or time estimates.

## Verification
- Extend focused regressions for all checkpoint/range mappings, one track, separate layers, no timers, no visible percentages or ETA, and reduced-motion behavior.
- Keep provider/orchestration tests unchanged and run focused tests plus the full verification suite, typecheck, lint, production build, and bundle audit.
- Browser-smoke Step 2 at desktop and narrow widths, including repeated motion, fixed confirmed boundary, reduced motion, layout, and console health.
- Reconfirm dependency, fixture, planning-file, environment-file, and clean-archive baselines; produce a clean source ZIP.
