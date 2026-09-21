# ARC v1 — Package 2A.1: Horizon Sample Source Document

## Scope

Add the supplied synthetic Horizon order form as curated, read-only reference content on the existing Horizon Source Documents page. Keep it completely separate from ARC-managed uploads and all accounting, AI, persistence, and database behavior.

## Implementation

1. **Static sample PDF**
   - Preserve the supplied three-page PDF unchanged at `public/samples/horizon-logistics-saas-order-form.pdf`.
   - Confirm its synthetic disclosures, Horizon terms, billing schedule, metadata, and lack of executable PDF content before serving it publicly.

2. **Horizon-only reference card**
   - Add a small presentation component for “Horizon Logistics — SaaS Order Form & Billing Schedule.”
   - Show “Sample source document · Synthetic,” the requested description, and this compact disclosure: “The Horizon analysis is pre-populated for demonstration. This synthetic source document is provided so you can trace the underlying contract terms.”
   - Provide a normal static “View PDF” link to `/samples/horizon-logistics-saas-order-form.pdf` in a new tab.
   - Render this card only when the active sample is exactly `horizon`; retain the existing saved-analysis notice for every other sample.
   - Expose no upload, delete, replace, selection, download subsystem, or ARC-managed document actions on the Horizon card.

3. **Architectural boundary**
   - Do not call source-document server functions, create document records, use storage or signed URLs, or pass the PDF into AI, fingerprinting, provenance, citation, quota, freshness, guest migration, or Safe Re-analysis paths.
   - Leave guest and authenticated Source Documents workspaces unchanged.

## Technical Details

- Read the existing sample identity from the analysis context in the Source Documents route and branch before the current generic non-contract sample state.
- Reuse existing semantic colors, borders, typography, and button/link styling; no page redesign or new viewer system.
- Add focused route-level assertions for Horizon copy/link/read-only behavior and Redwood’s unchanged fallback. Re-run existing guest and authenticated Source Documents suites as adjacent coverage.

## Verification and Delivery

- Manually follow Home → Try the Sample → Source Documents → View PDF; confirm the PDF opens, is legible, and no console/page errors occur.
- Verify Redwood keeps the saved-analysis notice and an ordinary guest retains upload behavior; verify the authenticated workspace remains covered by its existing suite.
- Run focused tests, adjacent Source Documents tests, and the complete `bun run verify` chain from the final revision.
- Check both existing GitHub Actions jobs if the environment permits; do not change CI if unavailable.
- Capture the Horizon Source Documents page and create a clean repository ZIP excluding secrets, dependencies, build output, Git metadata, and private planning metadata.

## Explicitly Out of Scope

- Accounting or Horizon sample values; AI, citations, fingerprints, freshness, provenance, or Safe Re-analysis.
- Persistence, auth, database, RLS, storage, signed URLs, quotas, guest migration, or uploaded-document architecture.
- Other samples, navigation, routing concepts, README content/assets, Excel export, Package 2B, or Package 3.