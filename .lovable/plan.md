# ARC v1 — Package 2: Portfolio / README Packaging

## Scope

Replace the obsolete planning-oriented README with one concise, recruiter-first description of the ARC product that exists today. Add exactly three curated screenshots under `docs/assets/`. Do not change application behavior, product code, deployment, or architecture.

## Deliverables

1. **Recruiter-first README**
   - Lead with “ARC — Ayden’s Revenue Compass” and the approved portfolio-grade positioning.
   - Place the core control principle near the top: “AI interprets. Deterministic TypeScript calculates. The accountant remains authoritative.”
   - Remove obsolete MVP-planning history and describe only verified current capabilities.
   - Use restrained, credible language; avoid claims such as enterprise-grade, production-ready, complete, autonomous, or universal contract coverage.

2. **Three curated product screenshots**
   - Capture the recruiter entry point.
   - Capture ASC 606 analysis with source-linked evidence/citations.
   - Capture one strong deterministic/control output, selected from schedules, balances/journals, or Review & Finalize based on which reads most clearly at README size.
   - The screenshots may use different synthetic scenarios when that communicates the product more clearly—for example, Genomix for citations and Horizon for deterministic outputs.
   - Store only the final optimized images in `docs/assets/`; exclude private contract text, credentials, internal identifiers, and incidental browser chrome.

3. **Guided portfolio walkthrough**
   - Add a concise “5-Minute Demo” using Horizon: open the sample, inspect the five-step analysis, review source-linked conclusions, inspect allocation and recognition, review balances and journals, then visit Review & Finalize.
   - Keep the guide focused on what a recruiter should notice rather than documenting every screen or sample.

4. **Compact architecture and control story**
   - Add one GitHub-renderable Mermaid diagram covering PDF input, GPT-5.6 Terra interpretation, structured cited output, the canonical accountant-owned draft, deterministic TypeScript engines, review/finalization, and persistence/security boundaries.
   - Explain provenance, citations, accountant authority, fail-closed behavior, and Safe Re-analysis without exposing internal implementation detail.
   - Make Ayden’s contribution explicit: ARC is his portfolio project, designed and built to demonstrate ASC 606 technical accounting, accounting-systems design, deterministic calculation logic, and controlled use of AI.

## README Structure

1. ARC — Ayden’s Revenue Compass
2. Why I Built ARC
3. What ARC Does
4. The Core Control Principle
5. 5-Minute Demo
6. Accounting Capabilities
7. Architecture
8. AI Safety & Auditability
9. Quality & Testing
10. Technology
11. Scope

The permanent Live Demo section is deferred to Package 3. Do not add the temporary Lovable URL or a visible placeholder.

## Technical Details

- Inspect the live/local product before capture and use only synthetic sample data.
- Verify every accounting, AI, security, technology, and testing claim against the current repository and latest successful checks.
- Use the current verified test count only if it is re-run and still accurate; otherwise describe quality controls without a number.
- Keep Mermaid syntax native to GitHub Markdown and avoid a separate documentation subsystem.
- Limit changed files to `README.md` and three images under `docs/assets/`, unless an image optimization manifest already exists and is required by repository convention.

## Verification

- Review the rendered README structure, links, image paths, Mermaid syntax, spelling, and image legibility.
- Inspect all three final screenshots for sensitive or confusing content and confirm they represent current product behavior.
- Confirm the repository diff contains documentation assets only.
- Run a focused secret/material scan over the README and screenshots, plus the repository’s existing Markdown or formatting check if one exists.
- Create a clean repository ZIP and report the final commit SHA; report GitHub Actions exactly as available without changing CI.

## Explicitly Out of Scope

- Application code, UI behavior, features, samples, product tests, AI prompts/model/schema, Safe Re-analysis, identity logic, accounting engines, persistence, authentication, RLS/database, SMTP, domains, deployment, and additional documentation pages.
