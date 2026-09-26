# Package 3D-P — Final UI/UX Polish (implementation plan)

This package changes presentation and navigation only, plus two static pages (`/privacy`, `/sitemap`). It makes no changes to accounting, AI, auth semantics, persistence, RLS, schema, storage, maintenance or secrets. It uses no AI run. Package 3D-Q and Package 3E are not started.

## Owner inputs (now all supplied)
- The four Noun Project icons and the ARC logo (`ARC-logo-02.svg`) are uploaded.
- Privacy contact: arcompass.developer@gmail.com.
- The grouped-journal approach is confirmed: one summary bar per contract group, and the Combined Journal Reconciliation table stays.

## Changes by item
| Item | Where | Change |
|---|---|---|
| 1 Sign-in icon | `AccountMenu.tsx` (signed-out link) | person icon inside the same link, 16 px, 6 px gap |
| 1b Signed-in menu | `AccountMenu.tsx` | icon-only button labelled "Account menu"; no email in the header or the menu; menu = Account settings + Sign out; existing Escape and outside-click closing kept; sign-out code unchanged |
| 2–4 Feature icons | `src/routes/index.tsx` (PRINCIPLES) | calculator, gavel and review icons before the titles; wording unchanged |
| 5A/5B Copy | `AppHeader.tsx` subtitle; `index.tsx` eyebrow | both removed, nothing added in their place |
| 5C/5D Logo | `AppHeader.tsx` | Compass icon replaced by the ARC logo (about 36–40 px, aspect ratio kept) inside the same home link; brand title set to one line at 15–16 px, semibold, centered with the logo; only a slight header-height increase if needed |
| 6 Sample copy | `analysis-context-bar.ts` ("Fictional sample contract"); `analysis-summary.ts` ("Sample Analysis — Fictional Contract") | both removed; "Sample — Horizon Logistics" and the Sample badge kept |
| 7 Horizon doc | `analysis/documents.tsx` | paragraph deleted |
| 8 Jump to top | `analysis/route.tsx` after `<Outlet />` | one shared `JumpToTop` button |
| 9 Footer/pages | `AppFooter.tsx`; new `routes/privacy.tsx`, `routes/sitemap.tsx` | Privacy and Sitemap links, the © line, and the attribution line |
| 10 Journal summary | `JournalEntryOutputs.tsx`, `JournalEntriesView.tsx` | five-field bar at the top; old "— Reconciliation" tile removed |

## Assets
- **Logo:** copied unchanged to `src/assets/arc-logo.svg` and imported as an image, so its original colors and shape stay exactly as supplied.
- **Icons:** each becomes a small inline component. The original paths and viewBox are kept as they are. Only the "Created by… from Noun Project" text elements are removed, and fills become `currentColor`. A shared wrapper sets 16 px, `shrink-0`, `aria-hidden`, and `focusable="false"`.
- **Footer credit:** "Icons by Fajriah Robiatul Adawiah, Afqoh, rendicon, and Nur Khasan from Noun Project." "Noun Project" links to https://thenounproject.com. The ARC logo is not included.

## Jump to top
- A plain outline `<button>`, right-aligned below the workpaper content. It doesn't stay fixed on screen.
- Clicking scrolls to the existing summary and workpaper-navigation block, then focuses it with `preventScroll`. When reduced motion is on, it moves there instantly.
- It never navigates, changes the address, or touches the draft.

## Journal summary bar
- **Journal Entries** = `entries.length`.
- **Periods** = number of distinct `entry.month` values.
- **Debits / Credits** = sums of `totalDebitsCents` / `totalCreditsCents`, shown in the existing USD format.
- **Status:**
  - `✓ Reconciled` when `reconciliation.reconciled === true`.
  - `⚠ Out of balance · $X difference` when the debit and credit totals differ.
  - Otherwise `⚠ Not reconciled`.
- When the status isn't Reconciled, a short line lists every failed or not-evaluated check by its existing name: All entries balanced, Monthly balances tie, Revenue by PO ties, Source events complete, Overall reconciled.
- **Blocked output** (`entries === null`): no bar; the existing notice stays.
- **Grouped contracts:** one bar per group. The combined table stays. There is no netted cross-group bar.
- **Layout:** one slim bordered bar with dividers; it wraps to a 2-column grid on narrow screens, and numbers are kept on one line (`tabular-nums whitespace-nowrap`).
- The summary logic lives in a pure helper, `src/lib/asc606-journals/presentation.ts`. Journal generation and reconciliation are untouched.

## /privacy content (checked against the code before writing)
- **Collected:** the email used for sign-in (email link only), the contract facts and judgments you enter, and PDFs you upload.
- **Guest use:** no account needed. Guest workspaces expire 9 hours after creation and are then removed by ARC's scheduled maintenance. No exact removal time is promised.
- **PDFs:** kept in private storage and opened only through short-lived private links.
- **AI:** for an AI run, text is extracted on the server from the selected PDFs and sent to OpenAI. The full extracted page text is temporary and is not saved. Source PDFs, the structured analysis and evidence references may be kept. AI output can be reviewed, accepted, changed or resolved manually. AI runs are limited per workspace or account.
- **Providers:** Lovable (hosting), Supabase (database, files, sign-in), OpenAI (contract analysis), Resend (sign-in email delivery).
- **Browser storage:** local storage keeps your sign-in session and guest workspace. Cookie and analytics statements will only claim what a live check of ayden-rc.com shows; otherwise I'll use careful wording.
- **Sharing:** no selling. Data goes to the providers above only to run the service.
- **Security:** each user can only reach their own data, and files are stored privately. No certification, compliance or encryption claims.
- **Deletion:** Account settings lets you delete your account, which deletes the sign-in account. The wording on what linked data goes with it will match the existing deletion code and database rules. Nothing broader is claimed.
- **Also included:** a "Last updated" date (September 26, 2026), a note on future changes, and the contact arcompass.developer@gmail.com.

## /sitemap
- **Listed:** Home, Analyze Contract, Horizon Sample, Sign in, My Contracts (sign-in required), Account Settings (sign-in required), Privacy, Sitemap.
- **Left out:** `/auth/callback`, `/engine-check`, `/api/*`, and saved-contract addresses.
- Each page has its own title, description and og tags, and works on direct load and reload.

## Tests (Vitest + Testing Library)
- **Header and landing:** the four icon/label pairs, icons `aria-hidden`, the logo replaces the Compass and is still the home link, subtitle and eyebrow gone. Sign in is one link to `/auth`. When signed in, no email shows and the icon button opens Account settings and Sign out. `auth-header.spec.tsx` expectations about the email are updated.
- **Sample copy:** the removed strings are gone, the kept label and badge are present, and Horizon figures are unchanged. The documents paragraph is gone and View PDF remains.
- **Jump to top:** present on all six workpapers; scrolls and focuses; causes no navigation; the address is unchanged; an edited value survives; reduced motion scrolls instantly.
- **Footer and pages:** footer links and credit line; `/privacy` and `/sitemap` render and include the contact; the sitemap leaves out internal routes.
- **Journal summary:** checked on Horizon output for entry count, periods, debits, credits and Reconciled. Made-up inputs cover out of balance (difference shown), not reconciled (failing checks listed) and blocked (no bar). The old tile is gone. A grouped case shows one bar per group and keeps the combined table. The engine specs pass unchanged.

## Verification and publish
- **Full check:** all tests, type check, lint, production build, a secret scan of the browser code, the Genomix SHA-256, `.env` holding exactly the two public values, and the build tool at `^2.15.0` / `2.15.0`.
- **Publish,** then run a live smoke test on https://ayden-rc.com: header and logo, signed-out icon, signed-in menu (needs your session, or clearly reported as not checked), feature icons, removed text, Jump to top on a long workpaper, footer, and Privacy/Sitemap on direct load and reload. Also the Horizon journal summary, plus a grouped case only if an existing sample covers it without AI.
- **After publishing:** check `.env` and the build tool again, restore them if needed, and don't republish just for that cleanup.
- **Housekeeping:** add the 3D-P tasks to `roadmap.md`.
