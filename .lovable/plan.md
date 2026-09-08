# ARC UI/UX Restructuring — Implementation Plan

Ayden's Revenue Compass (ARC) — ASC 606 Analysis Platform.
Scope: information architecture, navigation, presentation and component structure only. No accounting engine changes.

## 1. Current-state assessment

Routes
- `src/routes/index.tsx` — landing page: title, "Start Blank Analysis", grid of 5 sample cards, demo-mode note.
- `src/routes/analysis.tsx` — the entire workspace. Holds one `useState<WorkflowDraft>` draft, a `StepKey` state, a `showStepIssues` flag, and `analyzeWorkflow(draft)` in a `useMemo`. Reads `?sample=` to seed a demo draft.
- `src/routes/engine-check.tsx` — internal engine verification page (Phase 1b), unrelated to the accountant workspace.
- `src/routes/__root.tsx` — bare shell, no app chrome, and still carries the default "Lovable App" title/description metadata.

Navigation / state architecture
- `WorkflowStepper.tsx` renders the nine step buttons (`1, 2a, 2b, 3, 4, 5, mod, balances, results`) as a flat pill row; `analysis.tsx` conditionally renders exactly one step component. Back / Continue / Reset live below.
- Single source of truth: the `draft` object, mutated only via `onChange(setDraft)` from each step component. Every derived number comes from `analyzeWorkflow`, plus `previewAllocation`, `materialRightStepPreviews`, `variableConsiderationPreview` used for in-step previews. No component performs accounting arithmetic.
- `validateWorkflow` returns `blockingByStep` keyed by `WorkflowStepId = "1"|"2a"|"2b"|"3"|"4"|"5"|"mod"`, which today drives both the Continue gate and the per-step issue list.

Reusable assets (keep)
- Pure layers: `src/lib/asc606*`, `src/lib/asc606-workflow/*` (types, validation, adapters, analysis, presentation, contract-balances), `src/lib/demo-scenarios.ts`.
- Step editors: `Step1Contract`, `Step2Promises`, `Step2PerformanceObligations`, `Step3TransactionPrice`, `Step5VariableConsideration`, `Step4Allocation`, `Step5Recognition`, `ContractModifications`, `BillingAndBalances`.
- Read-only output blocks: `ContractBalanceOutputs`, `JournalEntryOutputs`, `ContractModificationOutputs`, `VariableConsiderationOutputs`.
- Primitives: `fields.tsx` (`Field`, `Section`, `Notice`, `JudgmentControl`, `IssueList`, `inputClass`, `th`, `td`), plus the full unused shadcn set (`accordion`, `tabs`, `card`, `badge`, `table`, `button`, …) already installed.

Technical debt relevant to this redesign
- `AnalysisResults.tsx` (634 lines) is a monolith that mixes contract conclusion, promises, POs, allocation, revenue schedule, validation, reconciliation, balances and journals — it must be split along the new parent areas.
- `Step3TransactionPrice.tsx` (610) and `ContractModifications.tsx` (555) are large but internally coherent; they will be moved, not rewritten.
- Styling is raw Tailwind utilities on the default shadcn slate theme in light mode; there is no dark class applied and no green accent. There is no app shell, header, or brand.
- No React component tests exist (no jsdom / testing-library). All 381 tests are pure-logic vitest tests.
- Step keys `"balances"` and `"results"` are UI-only pseudo-steps not present in `WorkflowStepId`; the current code special-cases them.

## 2. Proposed target architecture

Routes
```
/                                landing (Analyze | Case Studies | Guidance Library nav)
/case-studies                    case study index (all sample contracts)
/guidance                        placeholder shell ("coming soon"), linked from nav
/analysis                        workspace, default area = ASC 606 Analysis
/analysis/schedule               Revenue Schedule
/analysis/balances               Contract Balances
/analysis/journals               Journal Entries
/analysis/documents              Source Documents (shell)
/analysis/review                 Review & Finalize
/engine-check                    unchanged, unlinked internal page
```
`src/routes/analysis.tsx` becomes a **layout route** owning draft state and rendering `<Outlet />`; the six areas are child leaf routes. `?sample=` and `?source=` search params stay on the layout route so deep links keep working.

Component hierarchy (new folder `src/components/arc/`)
```
AppHeader / AppFooter            brand chrome (ARC), site nav
AnalysisWorkspace                layout body: summary + nav + outlet
  AnalysisSummary                status badge, customer, value, PO count, pattern, actions
  AnalysisNavigation             6 parent areas, keyboard-accessible, active state
  Asc606AnalysisView             accordion list
    AnalysisStepAccordion        one section: number, title, status chip, content
      Step1 → ContractOverview + Step1Contract (criteria)
      Step2 → Step2Promises + Step2PerformanceObligations
      Step3 → Step3TransactionPrice (+ VC editor when applicable)
      Step4 → Step4Allocation
      Step5 → Step5Recognition
    AdditionalTopics             Contract Modifications / Variable Consideration / Material Rights
  RevenueScheduleView
  ContractBalancesView
  JournalEntriesView
  SourceDocumentsView            shell
  ReviewFinalizeView
```

State / data flow (unchanged in substance)
- The layout route keeps `useState<WorkflowDraft>` and `useMemo(analyzeWorkflow)`. It exposes them through a small React context (`AnalysisProvider` / `useAnalysis()`) so child routes read the same `draft`, `setDraft`, `result` — no prop drilling, no second copy, no per-route state.
- Because the draft lives on the parent layout route, navigating between the six areas never unmounts it; edits survive area switches and accordion collapse.
- Every number rendered still comes from engine output. No new derived arithmetic in React.

One canonical renderer
- Add a presentation-only field on the workspace: `origin: "manual" | "sample" | "ai"` (derived today from whether `?sample=` was used). It affects only the summary badge, the available contextual actions (e.g. "Reset Sample"), and the landing copy.
- All three origins mount the exact same `Asc606AnalysisView` and the same financial views.
- To leave room for future AI provenance and guidance, each accordion field group is wrapped in a `FieldBlock` with optional `provenance` and `guidance` slots that render nothing today. No AI or guidance data model is introduced now.

## 3. Migration mapping

| Current stage | New location |
|---|---|
| 1 Contract | ASC 606 Analysis → Step 1, split into "Contract overview" (customer, reference, execution date, currency) and "ASC 606 contract criteria" (the five existing criteria, unchanged) |
| 2A Promises | Step 2 → subsection "Promised goods and services" |
| 2B Performance Obligations | Step 2 → subsection "Performance obligations" |
| 3 Transaction Price | Step 3 (variable-consideration editor stays inside Step 3) |
| 4 Allocation | Step 4 |
| 5 Recognition | Step 5 (`Step5VariableConsideration` remains attached where it lives today) |
| Contract Modification | Additional Topics Applied → "Contract modifications", same `ContractModifications` component and same engine path |
| Billing & Contract Balances | Contract Balances area (billing/cash inputs on top, `ContractBalanceOutputs` below) |
| Results | Dissolved: contract conclusion / promises / PO / allocation summaries fold into the matching accordion sections; revenue schedule → Revenue Schedule; balances → Contract Balances; journals → Journal Entries; validation + reconciliation → Review & Finalize (with a compact status in the summary bar) |
| Back / Continue / Reset | Replaced by area navigation + summary-bar actions; blocking issues surface inline per step and are aggregated in Review & Finalize |

## 4. Files added / modified / removed

Added
- `src/routes/analysis/route.tsx` (layout), `analysis/index.tsx`, `schedule.tsx`, `balances.tsx`, `journals.tsx`, `documents.tsx`, `review.tsx`
- `src/routes/case-studies.tsx`, `src/routes/guidance.tsx`
- `src/components/arc/AppHeader.tsx`, `AppFooter.tsx`, `AnalysisWorkspace.tsx`, `AnalysisNavigation.tsx`, `AnalysisSummary.tsx`, `Asc606AnalysisView.tsx`, `AnalysisStepAccordion.tsx`, `AdditionalTopics.tsx`, `RevenueScheduleView.tsx`, `ContractBalancesView.tsx`, `JournalEntriesView.tsx`, `SourceDocumentsView.tsx`, `ReviewFinalizeView.tsx`, `FieldBlock.tsx`
- `src/components/arc/analysis-context.tsx`
- `src/lib/arc/analysis-origin.ts` (pure: origin type + summary view-model built from existing engine output)

Modified
- `src/routes/index.tsx` (new landing IA), `src/routes/__root.tsx` (header/footer chrome, real ARC metadata, dark class)
- `src/styles.css` (dark-first ARC palette + green accent tokens)
- `src/components/asc606-workflow/*` step editors: heading/wrapper trimming only so they nest inside accordions; no field, judgment or validation removed
- `src/components/asc606-workflow/AnalysisResults.tsx` → split into the new views; kept temporarily during migration, deleted at the end
- `src/lib/demo-scenarios.ts` — add a `featured` flag and case-study grouping metadata only

Removed / deprecated
- `WorkflowStepper.tsx` and the `StepKey` model
- `AnalysisResults.tsx` after its sections are relocated
- The Back / Continue / Reset button row in `analysis.tsx`

Untouched: `src/routes/engine-check.tsx`.

## 5. Accounting-engine impact assessment

Zero changes to: `src/lib/asc606/*`, `asc606-balances/*`, `asc606-journals/*`, `asc606-material-rights/*`, `asc606-variable-consideration/*`, `asc606-contract-modifications/*`, and the pure workflow layer `asc606-workflow/{types,validation,adapter,vc-adapter,modification-adapter,analysis,presentation,contract-balances,money-input}.ts`.
The only permitted workflow-layer addition is a display-oriented summary view-model that reads existing outputs. Cases 9–12 and all sample outputs are untouched by construction.

## 6. State-management risks and mitigations

- **Lost edits** — draft state is hoisted to the `/analysis` layout route so child-route navigation and accordion collapse never unmount it. Accordion content stays mounted (CSS-hidden) where a component holds local input state.
- **Duplicated state** — one `WorkflowDraft`, one `setDraft`, distributed only through context. No child route may hold its own copy; a review step in each phase checks for `useState<WorkflowDraft>` outside the layout.
- **Stale calculations** — the single `useMemo(() => analyzeWorkflow(draft), [draft])` stays the only analysis call; views receive `result` as a prop/context value.
- **Broken validations** — `validateWorkflow` and `blockingByStep` keep their existing `WorkflowStepId` keys; the accordion maps `2a`/`2b` into Step 2's section and `mod` into Additional Topics. Nothing is filtered out: unmapped issues fall through to Review & Finalize so no issue can silently disappear.
- **Gating** — replacing Continue removes a forward gate, so blocking issues become permanently visible per section plus a consolidated list in Review & Finalize; blocked engine output continues to suppress financial results exactly as today.

## 7. Responsive / accessibility approach

- Desktop-first two-column workspace (nav rail + content), collapsing to a stacked layout with a horizontally scrollable nav under ~1024px.
- Radix `Accordion` (`type="multiple"`) and Radix-based nav give keyboard operation and correct ARIA out of the box; area nav uses `<Link>` with `activeProps` and `aria-current`.
- Visible `focus-visible` ring on all interactive elements; semantic `h1/h2/h3` order; every input keeps a real `<label>`.
- Status is always text + shape, never colour alone (e.g. "Blocked · 2 items", not a red dot).
- Accounting tables keep desktop density and get `overflow-x-auto` wrappers with a caption/scroll hint on narrow screens.
- Dark palette tuned so muted text meets 4.5:1 against the surface it sits on.

## 8. Testing plan

- A. All 381 existing pure tests must pass unchanged; no test file under `src/lib/**` is edited to accommodate UI work.
- B–E. Add component tests. This requires new dev dependencies (`@testing-library/react`, `@testing-library/user-event`, `jsdom`) and a jsdom `environmentMatchGlobs` entry in `vitest.config.ts` so node-environment engine tests are unaffected. Coverage: each of the six areas renders; accordion expand/collapse preserves entered values; editing a field in Step 3 changes the same figures the current workspace produces; each sample loads and shows its known headline figures.
- F. Meridian sample rendered in the new workspace shows the approved Case 9 audit values (cutoff 2027-06-30, historical $59,425.44, lifecycle $330,000, future $270,574.56).
- G. Keyboard traversal of nav + accordions and a narrow-viewport smoke check via Playwright screenshots.
- Every phase ends with `bun run test`, `bunx tsc --noEmit`, `bun run build`, `bun run lint`, `bunx prettier --check .`.

## 9. Implementation sequence

1. **Design system + shell** — ARC dark palette and green accent tokens in `styles.css`, `AppHeader`/`AppFooter`, root metadata. No IA change yet.
2. **Landing page IA** — three-item nav, two primary CTAs, secondary manual-entry link, one featured sample, "Browse all case studies".
3. **Case Studies + Guidance shells** — `/case-studies` lists existing samples and reserves slots for the three planned cases; `/guidance` placeholder.
4. **Workspace skeleton** — convert `/analysis` to a layout route with context, add the six child routes and `AnalysisNavigation`; temporarily render existing step components per area to prove state survives navigation.
5. **ASC 606 Analysis accordion** — Steps 1–5 sections, Step 1 split into overview + criteria, Step 2 subsections, Additional Topics hosting contract modifications (and VC / material-rights entry points).
6. **Financial areas** — split `AnalysisResults` into `RevenueScheduleView`, `ContractBalancesView`, `JournalEntriesView`; `ReviewFinalizeView` takes validation + reconciliation; delete the stepper and `AnalysisResults`.
7. **Summary bar + status labelling** — origin badges (Draft / Sample Analysis — Fictional Contract / Finalized), contextual actions.
8. **Accessibility, responsive pass, and the test suite from section 8.**

Each phase is independently reviewable and leaves the app working.

## 10. Risks and open questions

- **The referenced landing-page and analysis mockups were not attached to this request.** Phase 1 will be executed from the written visual direction unless the images are supplied first; supplying them before Phase 1 is strongly preferred.
- Removing Continue removes the current forward gate. Confirm you accept always-visible inline issues plus a Review & Finalize roll-up instead of blocking navigation.
- The theme is currently light-mode shadcn slate. Going dark-first affects `/engine-check` too; it will inherit the new tokens without layout changes.
- `AnalysisResults`, `Step3TransactionPrice` and `ContractModifications` are large; splitting them is the highest-regression-risk mechanical work and gets its own phase with screenshot comparison against today's output.
- No component-test infrastructure exists today; adding jsdom + testing-library is a new dev dependency decision.
- Deep-linkable child routes change existing URLs (`/analysis` only, today). Old links still land on the ASC 606 Analysis area, so nothing breaks.
- "Finalized immutable analysis" does not exist in the engine; Review & Finalize will present current validation/reconciliation state only, with room for the future lifecycle.

## 11. Visual interpretation

The existing design system is token-based (`styles.css` `@theme inline` + oklch variables), so the ARC look is achieved by redefining tokens rather than hardcoding colours:
- Dark surfaces via a near-black `--background` with a slightly lifted `--card`/`--muted`, borders at low-alpha white for thin hairlines.
- `--primary` becomes the restrained green, used only for primary CTAs, active nav/step indicators and success states. Structure stays neutral gray; there is no green flood, no gradient, no glass.
- `--muted-foreground` is raised until small secondary text clears 4.5:1 on card surfaces — a specific fix for the readability risk in dark mode.
- Radius stays at the current `0.625rem` (rounded, not soft); density comes from tightened table padding and consistent 8px spacing steps rather than shrinking type.
- Typography: one strong display weight for page and step titles, tabular-nums for every monetary column (already used in `td`).
- Motion is limited to the accordion height transition and focus/hover state changes.
- Existing shadcn components (`accordion`, `card`, `badge`, `table`, `button`, `separator`) are adopted in place of ad-hoc utility markup where they map cleanly, keeping the visual language consistent as screens get denser.
