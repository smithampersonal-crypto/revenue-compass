# ARC v1 — Recruiter First-Impression Hardening

## Scope
Implement only the three accepted recruiter-facing corrections. No accounting, AI, identity, persistence mechanics, database, authentication, sample-data, or navigation architecture changes.

## Changes
1. **Primary sample CTA**
   - Change the Home “Try the Sample” destination from `sample=redwood` to `sample=horizon`.
   - Keep Upload PDF and Start Manually unchanged.
   - Update focused Home-route coverage to verify all three destinations.

2. **Pristine manual starter state**
   - Add a presentation-only pristine-draft predicate based on the complete canonical empty draft shape, combined with manual origin.
   - Render a neutral “New Contract Analysis” state with: “Begin by entering the customer and contract terms in Step 1, or return Home to explore the sample contract.”
   - Do not show the empty draft’s outstanding-item count or zero-obligation metric in this one state.
   - Restore ordinary validation/status presentation after any meaningful draft input; leave samples and AI-populated drafts unchanged.

3. **Guest persistence wording**
   - Make the save-status presenter aware only of whether storage is temporary or account-backed.
   - For a saved guest workspace, show “Session saved” and “Changes are saved in this temporary workspace.”
   - Keep authenticated saved revisions at “Saved” / “All changes saved.”
   - Keep the separate guest save panel explicit that the analysis is not saved to My Contracts, without changing persistence behavior.

## Verification
- Add focused regressions for the Horizon CTA, pristine/manual transitions, sample and AI-populated behavior, guest session wording, My Contracts distinction, and authenticated saved wording.
- Run focused and adjacent suites, then the full test suite, typecheck, lint, production build, and bundle audit.
- Run both GitHub Actions jobs if the environment provides access; report the exact status without changing CI.
- Create a clean repository ZIP and report the commit SHA.
