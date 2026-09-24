# ARC Package 3 — Production Readiness: Audit and Plan

This is the audit and plan only. Nothing has been implemented.

## A. Current-state audit

1. **Deployment / custom domain.** The app is hosted by Lovable. It is published at `https://asc-genius-pro.lovable.app`, and the preview is at `id-preview--e4b6223e-….lovable.app`. **No custom domain is configured** yet (confirmed with the platform domain check). No hosting config files are committed (no `wrangler.*`). TanStack Start SSR serves every route, so direct loads and reloads work without SPA rewrites.
2. **Auth / magic-link routing.**
   - `src/routes/auth/index.tsx` calls `signInWithOtp` with an `emailRedirectTo` value built by the server.
   - `src/lib/auth/session.functions.ts` (`buildAuthCallbackUrl`) uses `ARC_SITE_URL` if it is set. Otherwise it falls back to the request origin.
   - `src/lib/arc/redirect.ts` (`sanitizeLocalPath`) accepts only same-site paths, which blocks open redirects. It has tests in `redirect.spec.ts`.
   - `src/routes/auth/callback.tsx` exchanges the code, confirms the user with `getUser()`, strips auth data from the URL, then navigates.
   - `_authenticated/route.tsx` is the client-only gate. Sign-out is in `AccountMenu.tsx` and `account.tsx`.
   - There is no password or OAuth code.
3. **Email / SMTP.** Nothing in the repo. Email is sent by the external Supabase project's built-in auth mailer (dashboard setting, not visible from the repo). The Lovable email-domain status is `not_started`, which is expected: this project uses external Supabase, so Resend SMTP belongs in the Supabase dashboard.
4. **Supabase URL/redirect assumptions in code.**
   - There are no hard-coded production or preview URLs in app code.
   - `localhost` appears only in `no-store.ts` (a dummy base for parsing a URL path) and in the generated `previewAuthStorage.ts`, which is active only on Lovable preview hosts inside the editor frame.
   - Site URL and the allowed redirect list live in the Supabase dashboard and are not visible from the repo.
5. **Maintenance endpoint.** `src/routes/api/public/maintenance.ts`:
   - Accepts POST/GET with a bearer or `x-arc-maintenance-secret` header.
   - Uses a constant-time comparison.
   - Stays closed if the secret is missing or shorter than 16 characters.
   - Returns counts only.

   The `ARC_MAINTENANCE_SECRET` runtime secret **exists** in the project.
6. **GitHub maintenance workflow.** `.github/workflows/maintenance.yml` runs hourly at `17 * * * *` and supports manual runs (`workflow_dispatch`). It needs the repo secrets `ARC_MAINTENANCE_URL` and `ARC_MAINTENANCE_SECRET`, never echoes the secret, and fails unless the response is 200. `supabase/schedules/arc-hourly-maintenance.sql` (pg_cron at `7 * * * *`) is a separate, manually applied database schedule; see `docs/operations.md`.
7. **Environment variables.**
   - Runtime secrets present: `OPENAI_API_KEY`, `ARC_MAINTENANCE_SECRET`, `LOVABLE_API_KEY`, `LOVABLE_CRON_SECRET`. `SUPABASE_*` values come from the Supabase connection.
   - `ARC_SITE_URL` is **not set**.
   - Only `VITE_SUPABASE_*` values are exposed to the browser (publishable/anon).
   - `scripts/audit-bundle.sh` fails the build if client bundles contain `OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ARC_MAINTENANCE_SECRET`, `sb_secret_`, a service_role JWT, or server modules.
8. **Production quotas.** `src/lib/arc/ai/config.server.ts` sets `guestRunLimit` to 3 (env `ARC_AI_GUEST_RUN_LIMIT`) and `userMonthlyRunLimit` to 10 (env `ARC_AI_USER_MONTHLY_RUN_LIMIT`). Model: `gpt-5.6-terra`, high reasoning effort. Neither override env var is set, so the frozen defaults apply. Quotas are enforced server-side through `arc_reserve_ai_allowance`.
9. **RLS / data isolation.**
   - Covered by SQL suites `supabase/tests/phase7_rls.sql`, `phase7_privileges.sql`, `phase8e_*`, and `phase8g_hardening.sql`, and by the CI `database` job.
   - Private bucket `arc-source-documents` is declared in `supabase/config.toml` (private, 10 MiB, PDF only).
   - Private server functions use `requireSupabaseAuth` or the RLS-scoped context. The admin client is loaded only server-side, and `service-role-leakage.spec.ts` tests this.
10. **CI / verification.** `.github/workflows/verify.yml` has two jobs:
    - `app`: `bun run verify` (tests, typecheck, lint, build, bundle audit).
    - `database`: local Supabase and `db:test`.
11. **Dependency baseline — DRIFT DETECTED.** `package.json:88` is currently `"2.23.1"`, which is the auto-bump again. `bun.lock` still shows `^2.15.0` and resolves to `2.15.0`. The latest platform commits (`cbcfcc9a`, `27b91fea`, `f034e928`) come after `b60a92fc`, and together they change only `package.json` and `bun.lock` beyond the formatting.
12. **Repository hygiene.**
    - `.gitignore` excludes `.env*`, `.lovable/plan.md`, `.wrangler/`, `*.tsbuildinfo`, `node_modules`, and `dist`.
    - Local `dist/` and `tsconfig.tsbuildinfo` exist but are ignored.
    - Genomix SHA-256 is verified as `7487979e…fdd4c7`.

## B. Gap classification

| Item | Classification |
|---|---|
| Redirect sanitising, callback verification, magic-link-only UI | Already ready — no change |
| Maintenance endpoint auth and hourly workflow file | Already ready — no change |
| Quota values 3 and 10, Terra/high defaults | Already ready — verification only |
| Bundle secret audit, server-only boundaries | Already ready — verification only |
| RLS / storage privacy model | Verification only |
| `package.json` auto-bump to 2.23.1 | Lovable repository change (restore `^2.15.0`) |
| `ARC_SITE_URL=https://ayden-rc.com` runtime secret | Lovable platform configuration (after the domain is live) |
| Connect `ayden-rc.com` to the Lovable deployment | Lovable opens the domain flow; owner adds DNS records |
| Resend domain verification + DNS | Owner action |
| Supabase custom SMTP (Resend credentials) | Owner action (Supabase dashboard) |
| Supabase Site URL + allowed redirect URLs | Owner action (Supabase dashboard) |
| GitHub secrets `ARC_MAINTENANCE_URL` / `ARC_MAINTENANCE_SECRET` | Owner action |
| Maintenance secret value known to the owner | Potential blocker (see E4) |
| pg_cron schedule applied in production | Owner action / verification |
| Hourly GitHub workflow enabled | Owner verification (GitHub UI) |

No item currently requires a database migration, an accounting change, a Safe Re-analysis change, or an auth architecture change.

## C. Proposed tranches

- **3A — Baseline repair and blockers.** Restore `package.json` to `^2.15.0` and run a frozen install. Run `bun run verify`, then re-check the dependency. No other changes. Stop.
- **3B — Domain, auth and email.**
  - Lovable opens the custom-domain connect flow for `ayden-rc.com` and reports the exact provider-supplied records.
  - **Owner:** add DNS records, verify Resend, configure Supabase SMTP, Site URL and redirect URLs.
  - After the domain is live, Lovable sets `ARC_SITE_URL`.
  - Stop at each owner boundary.
- **3C — Maintenance secrets.**
  - **Owner:** set the GitHub secrets. `ARC_MAINTENANCE_URL` is `https://ayden-rc.com/api/public/maintenance`.
  - **Owner:** confirm pg_cron is applied.
  - Lovable verifies that an unauthenticated request returns 401, without printing the secret.
  - **Owner:** trigger a manual workflow run. Verify it returns 200 with counts.
- **3D — Production verification.**
  - Custom-domain routes and reloads.
  - Horizon sample.
  - Magic-link sign-in, refresh, save/reopen, and sign-out.
  - Signed-out and cross-user denial on contracts and documents.
  - Signed-URL protection for PDFs.
  - Quota configuration check, and a bundle scan of the deployed assets.
  - At most **one** guest Terra PDF analysis, using the Genomix fixture. It covers the four-stage progress bar, deterministic results, Review & Finalize, and source evidence/PDF.
  - No authenticated AI run unless you approve one.
- **3E — Final verification and archive.** Run `bun run verify` and confirm CI is green (owner). Then: diff review, dependency scan, dependency re-check, Genomix hash check, hygiene check, clean ZIP, and the completion report.

## D. Expected repository changes

- 3A: `package.json` (dependency restore only), plus `bun.lock` only if the package manager requires it.
- 3E: `roadmap.md` Package 3 evidence entries.
- Possibly `docs/operations.md`, adding one line naming the production maintenance URL, and only if you want it.

Everything else is **No repository change required.** It is platform or dashboard configuration.

## E. Owner-action checklist (values come from providers when the step is reached)

1. **DNS for `ayden-rc.com`.** Add the exact records the Lovable domain flow shows (typically an A/TXT pair). I will relay them verbatim and not guess them.
2. **Resend.** Add the domain (e.g. a sender subdomain) and add the DKIM/SPF/MX records Resend displays. Create an SMTP API key.
3. **Supabase → Auth → SMTP settings.** Enable custom SMTP with the Resend host, port, username and API key, plus the sender address. This happens in the Supabase dashboard only. The key never enters the repo or Lovable secrets.
4. **Supabase → Auth → URL configuration.**
   - Site URL: `https://ayden-rc.com`.
   - Redirect URLs: `https://ayden-rc.com/auth/callback**`.
   - Optionally keep preview/published `lovable.app` callback entries for testing; you decide whether to remove them.
   - Remove any `localhost` entries.
5. **GitHub → Settings → Secrets → Actions.** Set `ARC_MAINTENANCE_URL` and `ARC_MAINTENANCE_SECRET`. The existing runtime secret's value cannot be displayed. If you don't have it recorded, I will rotate it through the secure form (`update_secret`) so you enter one value you control in both places.
6. **Supabase SQL.** Confirm pg_cron is enabled and `arc-hourly-maintenance.sql` is applied.
7. **GitHub Actions.** Confirm the maintenance workflow is enabled, trigger the manual run, and confirm CI is green.

## F. Risks and stop conditions

- **Migration:** none expected. If the RLS/storage verification finds a gap, I stop and report it.
- **Auth architecture:** none expected. The callback already builds its URL from `ARC_SITE_URL`. If Supabase rejects the redirect, the fix is dashboard configuration, not code.
- **Secret exposure:** none found in code. The deployed-bundle scan in 3D confirms it. Any hit is a blocker.
- **Live AI:** one guest Terra run planned. A failure is not retried automatically; I stop and report.
- **Dependency drift:** the platform keeps bumping the package, so I re-check after every install, build and verify, and before packaging.
- **Commit lineage:** HEAD is now `f034e928`, after `b60a92fc`. The only differences beyond the formatting are the dependency lines, which 3A restores.
- **Custom domain plan requirement:** connecting a domain may require a paid Lovable plan. If it is unavailable, I stop.
