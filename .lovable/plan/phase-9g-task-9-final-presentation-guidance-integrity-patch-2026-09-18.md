# Phase 9G Task 9 — Final Presentation & Guidance Integrity Patch

## Scope
Patch only the five approved application gaps. Keep the deployed restore migration, database security, evidence-link authority, restore sequencing, Tasks 1–8, and Task 10 untouched.

## Implementation
1. **Restore placement**
   - Remove the restore action from the shared analysis layout.
   - Mount the single action on Review & Finalize after the AI review queue.
   - Add route-level regression coverage proving it is present only on `/analysis/review` and absent from analysis, schedule, balances, journals, and documents.

2. **Resolved review support**
   - Reuse the existing citation and guidance presentation for resolved items.
   - Preserve reason and resolution summary/note while withholding Confirm and Resolve actions.
   - Keep evidence and guidance calls bound to the current review fingerprint and existing server boundary.

3. **Complete approved guidance presentation**
   - Use “ASC 606 Guidance” as the dialog heading.
   - Render subtopic and When relevant alongside the already-approved accountant-facing fields.
   - Add UI regressions for both fields and for resolved-item evidence/guidance.

4. **Fail-closed guidance completeness**
   - Deduplicate the server-trusted guidance references.
   - Require the approved registry to resolve every unique reference; otherwise return the existing neutral unavailable error.
   - Add server regressions for complete, partial, duplicate, and empty resolution.

5. **Scope-neutral restore confirmation**
   - Retain the exact replacement and post-run edit-loss warning.
   - State that source documents and history remain unchanged and consumed AI usage is not refunded.
   - Add saved/guest wording regressions that reject “monthly”.

## Verification and Delivery
- Capture RED failures before implementation, then run focused Task 7–9 and freshness/controller suites GREEN.
- Run `bun run verify`, `bun run db:test`; if Docker is unavailable, replay all migrations and run all 21 SQL suites with the throwaway Postgres harness.
- Run the bundle audit, verify the frozen migration checksum remains `3013e5370b7a12e8d266ddf4332034968bc5cc3cefb66dcb307ac04db261c251`, and inspect the affected browser flows.
- Check both GitHub jobs if accessible; report any external blocker without claiming acceptance.
- Produce a refreshed source ZIP excluding dependencies, generated output, secrets, and Git metadata, then stop for final Task 9 acceptance.
