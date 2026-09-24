# Package 2B.1 — Final README Screenshot Refresh

## Scope
Documentation and presentation only. Preserve the accepted Package 2C-K application unchanged and stop before Package 3.

## Screenshot set
Capture the live Horizon experience at one consistent high-resolution desktop viewport, without browser chrome or fabricated content:

1. **Landing / entry experience** — final ARC branding, hero, Sample → Upload → Manual card order, and accepted CTA hierarchy.
2. **ASC 606 analysis workspace** — a populated Horizon analysis step showing accountant-facing contract facts, judgments, and performance-obligation structure.
3. **Deterministic accounting output** — the strongest legible populated output view, favoring the revenue schedule/allocation context and preserving the accepted accounting values.
4. **Review & Finalize / AI evidence** — final review controls, compact provenance, Source Evidence + Open PDF, and accountant-facing Validation Checks with technical details collapsed.

## README and asset changes
- Replace the three obsolete PNGs under `docs/assets/` with final-state captures and add one stable workspace PNG.
- Keep the README narrative and section structure; change only image placement, paths, concise alt text, and any narrowly necessary caption text.
- Remove only superseded screenshot files that are unreferenced and clearly obsolete; preserve unrelated assets.
- Optimize images for README-scale clarity without altering or compositing the UI.

## Verification
- Inspect every captured image for stale UI, clipping, private data, transient states, implementation IDs, and inconsistent dimensions.
- Render the README and inspect it visually at normal GitHub content width; verify all four paths load and remain legible.
- Confirm no application source or behavior changed and run documentation-appropriate repository checks.
- Recheck `@lovable.dev/vite-tanstack-config` is `^2.15.0` with lock resolution `2.15.0`; restore only those package files if the platform auto-bumped them.
- Confirm the Genomix SHA-256 and repository hygiene requirements.
- Update only the Package 2B.1 completion state in `roadmap.md` after all checks pass.
- Confirm the final GitHub app and database jobs are green; do not rerun Terra or the local database solely for screenshots.

## Delivery
- Remove `.lovable/plan.md` from the final tracked/delivered source.
- Produce and inspect a clean source ZIP excluding all forbidden transient files.
- Report exact changed/added/removed files, screenshot purpose, README changes, checks, dependency/hash/hygiene results, final commit, ZIP file count and SHA-256.
