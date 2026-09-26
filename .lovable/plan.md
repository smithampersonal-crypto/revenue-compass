# Package 3D-R — ASC 606 Analysis Accordion View-State Persistence (PLAN ONLY)

## 1. Verified root cause
Confirmed from the code. The open/closed map is local `useState` inside `Asc606AnalysisArea` (`src/routes/analysis/index.tsx:90`), starting from `{ "step-1": true }`. `/analysis/` is a child of the `/analysis` layout. Going to `/analysis/journals` (or any other workpaper) unmounts the component, so its state is lost. Coming back remounts it with the default again. The draft survives because it lives higher up, in `AnalysisProvider`, which is mounted by the layout (`src/routes/analysis/route.tsx`).

## 2. Current ownership
- **Steps 1–5:** the `open` record in `Asc606AnalysisArea`, changed by `toggle` (user clicks), `reveal` (the Additional Topics "Go to Step…" links) and the one-shot review-intent effect (line 158, `setOpen(... [sectionId]: true)`).
- **Additional Topics** (`topic-modifications`, `topic-variable-consideration`, `topic-material-rights`): the same `open` record. It is passed down as props to `AdditionalTopics`, which holds no state of its own.
- **`AccordionSection`:** stateless. Children stay mounted and are only hidden.
- **Analysis identity:** `route.tsx:93` builds `identity = sample|contract|revision` from the URL and uses it as the `key` on `AnalysisProvider`. Changing the analysis therefore already remounts the whole provider tree.

## 3. Proposed state owner
A new small presentation-only store: `AnalysisViewStateProvider` in `src/components/arc/analysis-view-state.tsx`.
- `AnalysisLayout` in `route.tsx` holds one `useRef<Map<string, Record<string, boolean>>>`. That layout stays mounted across every `/analysis/*` child and every identity change.
- The provider is rendered inside the keyed `AnalysisProvider` and receives `identity` plus that map. It exposes `open`, `setSectionOpen(id, next)` and `openSection(id)`.
- **First entry for an identity:** the map has no entry, so the state starts from the existing default `{ "step-1": true }`. That default moves unchanged into one exported constant.
- `Asc606AnalysisArea` swaps its `useState` for the hook. `toggle`, `reveal` and the review effect call the same operations as today. Nothing else changes.

Why not keep the state inside `AnalysisProvider` itself? That would lose retention per analysis (test F), and it would touch the file that owns accounting state. The separate store keeps accounting and presentation apart.

Lifetime: memory only. No storage, URL parameters, cookies, database or schema. A full refresh resets to defaults.

## 4. Identity and reset rule
The key is the existing `identity` string (`sample:…|contract:…|revision:…`). Nothing new or fuzzy is added.
- Different sample, contract or revision → different key → that analysis starts from the defaults.
- Returning to an earlier analysis in the same browser session → its earlier view state is restored from the in-memory map (the preference stated in the brief). A refresh clears it.
- Bare `/analysis` (the visitor's guest or blank workspace) is always one key. See risk (b).

## 5. Review-navigation precedence
Force-opening a section writes `open[sectionId] = true` into the shared store. That overrides a remembered "closed" for that section, and the section then stays open for the rest of the session. Nothing else in the review flow changes: the `?review=` one-shot effect, `consumedReviewRef`, `describeReviewTarget`, `scrollToReviewTarget`, anchors and focus all stay as they are.

## 6. Additional Topics
It already uses the same record, so it gets the same behavior automatically. `AdditionalTopics` keeps its current props. The `reveal` links write to the store.

## 7. Read-only / finalized analyses
Opening and closing sections is presentation only and is not gated by `canEdit`. Finalized or superseded revisions have their own `revision` in the identity, so they keep their own view state and behave the same way.

## 8. Files to change
- `src/components/arc/analysis-view-state.tsx` (new): provider, hook and default constant.
- `src/routes/analysis/route.tsx`: add the map ref in the layout and wrap the workspace in the provider, passing `identity`.
- `src/routes/analysis/index.tsx`: replace the local `useState` with the hook.
- `src/components/arc/analysis-view-state.spec.tsx` (new): the tests in section 9.
- `roadmap.md`: add a 3D-R section.

The existing `AdditionalTopics` unit test renders the component directly with props, so it needs no change.

## 9. Regression tests (jsdom plus the real route tree, following `analysis-accordion.spec.tsx`)
- **A.** Open Steps 2, 3 and 4 → Journal Entries → back → all three open.
- **B.** Open Step 3 → close it → Revenue Schedule → back → Step 3 closed.
- **C.** Mixed set {1 closed, 2 open, 5 open} survives a round trip through all six areas.
- **D.** Open Contract Modifications, close Step 1 → navigate → back → both kept. Variable Consideration and Material Rights are checked with a draft that shows them.
- **E.** Leave Step 3 closed → go to `/analysis?review=<id targeting a Step 3 field>` with a mocked ready AI workspace (the existing ai-review-navigation spec harness) → Step 3 opens and the exact anchor gets focus → Journal Entries → back → Step 3 still open.
- **F.** Customize the view in `?sample=meridian` → switch to `?sample=apex` → defaults (only Step 1 open) → back to meridian → the customized state is restored within the session.
- **G.** Snapshot the draft JSON, the AI sidecar or workspace reference, and autosave calls (the save server function mocked) → toggle and navigate → no change to the draft, no autosave call, and review fingerprints unchanged.
- **H.** A read-only historical revision (existing mocked-load harness): toggles work and are kept across navigation.
- The full `bun run verify` must pass, including the existing accordion, review-navigation and focus specs unchanged.

## 10. Boundaries confirmed
No changes to: accounting engines, AI schema v7 / prompt v11, 3D-Q billing evidence, Safe Re-analysis, provenance or fingerprints, the persistence schema, database or RLS, auth, quotas, PDF handling, calculation gating, or the 3D-P UI. No AI run, no publish, no 3E. The frozen `.env`, build-tool pin and Genomix hash will be restored and checked before the report.

## 11. Risks and ambiguities
- **(a)** A contract URL without `revision` (latest) and the same contract with an explicit `revision=` produce different keys, so the view state is not shared between them. This is conservative and never leaks between analyses.
- **(b)** Saving a guest or blank analysis adds `contract` to the URL. That changes the key, so the accordion resets to defaults once at that moment. The existing provider already remounts on that change, so this matches today's identity rule. It can be accepted as-is, or (as an option) the in-memory entry could be carried over on that single transition. Owner decision needed.
- **(c)** The in-memory map grows by one small entry per analysis visited in a session. It is negligible and clears on refresh.
