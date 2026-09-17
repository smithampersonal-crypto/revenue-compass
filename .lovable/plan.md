# Phase 9G Task 6 — Analyze Workspace UI

## Scope

Build the first production presentation for the accepted `analysis.ai` controller. Keep Tasks 1–5 frozen, add no review/provenance/stale-source UX, and stop after Task 6 verification.

## Implementation

1. **Add focused AI workspace components**
   - Add one layout-level Analyze/Re-analyze action area so it remains visible across all analysis sections.
   - Drive its label, requesting state, disabled state, allowance text, and click exclusively from `analysis.ai`.
   - Show a stable disabled loading placeholder until the authoritative workspace state is ready; do not flicker between Analyze and Re-analyze.
   - Keep samples, in-memory workspaces, and historical revisions outside the editable AI action surface.

2. **Render authoritative progress**
   - Add a compact four-step progress component consuming only `analysis.ai.progress`.
   - Render Preparing documents, Analyzing contract, Validating analysis, and Updating workspace with completed/current/upcoming states.
   - Use status semantics and explicit accessible state text; no percentage, timing estimate, animation, focus movement, or component-side lifecycle state.
   - An already-active run renders identically on first load and triggers no execution from the component.

3. **Render safe notices and allowance**
   - Present the full Task 3 deterministic failure object without rewriting or inspecting its cause.
   - Present Task 5’s approved controller message verbatim; a workspace-load error gets one Retry action wired only to `analysis.ai.refresh()`.
   - Show the authoritative remaining/limit count compactly. Zero remaining disables the CTA and shows a generic limit-reached explanation without calling Analyze.
   - Do not add polling toasts. Successful completion naturally removes progress and exposes Re-analyze after the controller adopts authoritative state.

4. **Preserve editing; wire only existing locks**
   - Keep accounting inputs, navigation, and autosave usable during an active run.
   - Minimally apply `analysis.ai.locks.finalize` to the existing Finalize action.
   - Minimally apply `analysis.ai.locks.sourceDocuments` to existing source upload, add/remove, metadata, archive, and delete entry points, including guards for already-open dialogs.
   - Do not alter finalization or source-document business logic.

## Test-first verification

1. Add RED component tests for initial Analyze, Re-analyze, requesting, all four progress phases, reconnect, success, safe failures, workspace conflict, authoritative allowance, zero allowance, loading/error retry, accessibility, and editable accounting fields during a run.
2. Add RED provider integration tests through the real `AnalysisProvider` and fake Task 5 ports for deliberate execution through all four phases, terminal success, and mount-time reconnect without execution.
3. Add focused lock regressions for existing Finalize and source-document controls.
4. Run focused Task 6, Task 5 controller/provider, Task 4 autosave reconciliation, Task 3 workspace boundary, and Phase 9F lifecycle/re-entrancy suites.
5. Run full verification, database suites, bundle audit, and Guidance check. Inspect the browser-reachable graph for server stores, Supabase admin, provider/OpenAI code, prompts, model identifiers, service-role material, raw persistence errors, and PDF text.
6. Verify the desktop and narrow layouts with browser screenshots, then package an updated repository ZIP.

## Guardrails

- No database migration or Cloud/schema/RLS/grant/RPC change.
- No real OpenAI call and no Genomix run.
- No Task 7 review controls, provenance markers, stale-source acknowledgment, review navigation, or finalization redesign.
- No changes to Task 5 lifecycle, polling, autosave, reconnect, or concurrency behavior.
- Stop for Phase 9G Task 6 implementation review and acceptance.
