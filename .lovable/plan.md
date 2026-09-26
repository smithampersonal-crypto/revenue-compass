# Package 3D-P — Final UI/UX Polish (plan only)

Presentation and navigation only, plus two new static pages (`/privacy`, `/sitemap`). No accounting, AI, auth, persistence, RLS, schema, storage, maintenance or secret changes. No AI run. No publish until approved.

## Blockers needing owner input before implementation
1. **The four SVGs aren't in the workspace.** `noun_person_6417405.svg`, `noun_Calculator_7007895.svg`, `noun_Gavel_7864021.svg` and `noun_review_8400591.svg` are missing from the project and your uploads. Please upload them; I won't substitute other icons. Please also say whether the Noun Project license you hold needs visible attribution. If it does, I'll put a short credit line on `/privacy` or in the footer.
2. **No contact email exists** anywhere in the app or its settings. The Privacy page needs one from you. Until then it would say "Contact details to be provided".
3. **Grouped-contract journals (confirm):** contracts with modifications show one reconciliation tile per contract group, plus a "Combined Journal Reconciliation" table. My proposal is that each group gets its own summary bar in place of its tile, and the combined per-group Reconciled / Not reconciled table stays, because it carries information the bars don't. Horizon and ordinary contracts have only the single tile.

## 1–2. Components and files by item
| Item | Existing source | Change |
|---|---|---|
| 1 Sign-in icon | `src/components/arc/AccountMenu.tsx` (signed-out `Link`) | icon inside the same `Link`, `gap-1.5` |
| 2–4 Feature icons | `src/routes/index.tsx` (FEATURES array, lines ~11–21) | icon before each title |
| 5 Header/hero copy | `src/components/arc/AppHeader.tsx` (subtitle span); `src/routes/index.tsx` line 57 eyebrow | remove both; title `text-[15px] sm:text-base font-semibold`, centered with logo |
| 6 Sample descriptors | `src/lib/arc/analysis-context-bar.ts` line 69 `detail: "Fictional sample contract"`; `src/lib/arc/analysis-summary.ts` line 40 `sample: "Sample Analysis — Fictional Contract"` (+ line 206 sample note, left as is unless you want it gone) | drop the detail and the eyebrow label; the rendering components (`AnalysisContextBar.tsx`, `AnalysisSummary.tsx`) skip empty values so spacing collapses |
| 7 Horizon doc copy | `src/routes/analysis/documents.tsx` lines ~91–94 | delete the paragraph |
| 8 Jump to top | workpaper routes `analysis/index.tsx`, `schedule.tsx`, `balances.tsx`, `journals.tsx`, `documents.tsx`, `review.tsx`, all under `analysis/route.tsx` | one `JumpToTop` rendered once in `analysis/route.tsx`, after `<Outlet />` |
| 9 Footer/pages | `src/components/arc/AppFooter.tsx` (already rendered by `PublicAppShell`) | add Privacy and Sitemap links; new `src/routes/privacy.tsx`, `src/routes/sitemap.tsx` |
| 10 Journal summary | `src/components/asc606-workflow/JournalEntryOutputs.tsx` (reconciliation `Section`, lines ~140–165); `src/components/arc/JournalEntriesView.tsx` | new `JournalSummaryBar` placed above the entries; old tile removed |

New files: `src/components/arc/icons/` (4 icon components), `src/components/arc/JumpToTop.tsx`, `src/components/asc606-workflow/JournalSummaryBar.tsx`, `src/lib/asc606-journals/presentation.ts` (pure summary helper), `src/routes/privacy.tsx`, `src/routes/sitemap.tsx`, plus spec files (see 10).

## 3. SVG integration
- Each SVG becomes a small inline React component. I'll keep only the glyph paths and remove the credit text, `<title>` and any fixed fills. Paths get `fill="currentColor"`, so the icon takes the text color.
- One shared wrapper sets `size-4` (16 px), `shrink-0`, `aria-hidden="true"` and `focusable="false"`. Each viewBox is normalized so all four glyphs appear at a similar size.
- The label text stays the accessible name, so the wording, links and behavior don't change.

## 4. Jump to top
- A plain `<button type="button">` with outline/secondary styling, right-aligned (`flex justify-end`) inside the workpaper width, placed after the content. It doesn't stay fixed on screen.
- On click it scrolls smoothly to the analysis summary and workpaper navigation (the element that already exists above the `Outlet`), then moves keyboard focus there with `preventScroll`. If reduced motion is on, it jumps instead of scrolling. It never changes the address, triggers a navigation or touches saved or unsaved data.
- Shown on every workpaper, whether short or long.

## 5. Journal data reused (no new accounting)
Built from `JournalAnalysis` (`entries`, `reconciliation`, `validation`):
- **Journal Entries** = `entries.length`. Each `JournalEntry` is one entry with a unique `id`, not a line.
- **Periods** = the number of distinct `entry.month` values (the same `MonthKey` grouping the journal table already uses).
- **Total Debits / Credits** = sum of `totalDebitsCents` / `totalCreditsCents`, formatted with the existing ARC USD helper.
- **Reconciliation** = the existing `reconciliation.reconciled` result.
- When `entries` is null (blocked), the bar is not shown and the existing blocked notice stays.

## 6. What the old tile holds, and how it's kept
Today the tile has 5 rows: All entries balanced, Monthly balances tie, Revenue by PO ties, Source events complete, and Overall reconciled. Each shows Yes / No / not evaluated.
- Balanced shows `✓ Balanced` and nothing else.
- Otherwise it shows `⚠ Out of balance`, plus `· $X difference` when debits and credits differ. A short list then names each failed or not-evaluated check using the same four check names. So every piece of diagnostic information stays, as text rather than color alone.
- The checks themselves (`reconciliation` object and `validation.blockingFailures`) are untouched.

## 7. Proposed `/privacy` (facts checked in the code)
- **What we collect:** the email you sign in with (email-link sign-in only, no passwords). Contract inputs and judgments you enter. PDFs you upload.
- **Guest use:** works without an account. Guest workspaces expire 9 hours after creation, and ARC's hourly maintenance removes expired guest data and files.
- **Documents:** PDFs only, up to 10 MB, kept in private storage. They can only be viewed through short-lived private links and are never public.
- **AI processing:** when you start an AI analysis, the contents of your selected documents are sent to OpenAI, ARC's AI provider, to produce suggestions. An accountant reviews and accepts every suggestion. ARC doesn't store extracted source text beyond what the analysis needs. I'll check this wording against the code before writing it. AI use is limited per workspace or account.
- **Storage/providers:** ARC is hosted on Lovable. Data and files are stored with Supabase. OpenAI is used only for AI analysis.
- **Browser storage:** ARC uses local browser storage to keep you signed in and to keep your guest workspace. There are no advertising or analytics cookies.
- **Sharing:** no selling or advertising. Data goes only to the providers above, only to run the service.
- **Security:** only statements the code supports, such as access limited to your own data and private file storage. No certification or encryption claims.
- **Your choices:** signed-in users can delete their account from Account settings (this feature exists). Guest data expires automatically.
- **Changes:** the page shows its last-updated date.
- **Contact:** OWNER INPUT REQUIRED.

## 8. Proposed `/sitemap`
Home (`/`), Analyze Contract (`/analysis`), Horizon sample (`/analysis?sample=horizon`), Sign in (`/auth`), My Contracts (`/workspace`, marked "sign-in required"), Account settings (`/account`, sign-in required), Privacy, Sitemap. Left out on purpose: `/auth/callback`, `/engine-check`, `/api/*`, and individual contract pages.

## 9. Responsive and accessibility
- The summary bar is a 5-column row with thin dividers on desktop and a 2-column or stacked grid on narrow screens. Numbers never break across lines.
- Every icon is decorative. Status is always in text.
- Jump to top and the footer links use the existing focus ring.
- Each new page gets its own title, description and og tags. Both pages load directly and on reload, since they're ordinary pages served like the rest of the site.

## 10. Tests (vitest + Testing Library, current setup)
- `landing-polish.spec.tsx`: all four icon/label pairs present, icons `aria-hidden`, feature text unchanged. Header subtitle and hero eyebrow gone. Sign in is still a single link to `/auth`.
- Update `auth-header.spec.tsx` / `app-shell.spec.tsx` expectations only where the removed text was asserted.
- `sample-copy.spec.tsx`: the removed strings are gone; "Sample — Horizon Logistics", the Sample badge and the Horizon figures are unchanged. The Horizon document card still has View PDF and no longer has the paragraph.
- `jump-to-top.spec.tsx`: present on all 6 workpapers. Clicking calls scroll/focus, leaves the address and an edited field value unchanged, and makes no navigation call.
- `app-footer.spec.tsx` + page tests: the footer links go to `/privacy` and `/sitemap`. Both pages render directly, and the sitemap leaves out internal pages.
- `journal-summary.spec.ts` (helper) + `journal-summary-bar.spec.tsx`: entry count, period count, debits, credits and the balanced state checked on Horizon journal output. A made-up out-of-balance input shows the difference and the names of the failed checks. The old "— Reconciliation" tile is gone. The existing journal engine specs pass unchanged.
- Full check before publishing: all tests, type check, lint, production build, a scan of the browser code for secrets, the Genomix SHA-256, and the frozen `.env` and build-tool state.

## 11. Scope confirmation
All ten items are changes to display text, markup and styling, plus two static pages. The summary bar only adds up totals from the journal output that already exists. None of this changes accounting, AI, sign-in, saving, RLS, the database or the security setup. The Transaction Price header fix stays as it is. The only things blocking the start are the three owner inputs listed at the top.
