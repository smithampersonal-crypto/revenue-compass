# Package 3E — Final verification, documentation and recruiter-v1 archive (PLAN ONLY)

No edits, publish, AI run, migration or archive until this plan is approved.

## 1. Baseline audit (read today)

- HEAD `d1957509`; accepted product baseline for frozen files `b1ea538e`.
- Genomix `fixtures/genomix-synthesis-contract-package.pdf` SHA-256 = `7487979e…d4c7` — unchanged.
- **Drift is present again** (from the last publish): `.env` has 6 keys (extra `SUPABASE_*` and `VITE_SUPABASE_PROJECT_ID`); `package.json` has `@lovable.dev/vite-tanstack-config` `2.23.1`; `bun.lock` is not the 2.15.0 Europe West 4 form.
- Accepted `.env` at `b1ea538e` = exactly `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY`. That matches this brief. (My earlier reports named PROJECT_ID instead of URL. That was a wording mistake: every restore used the `b1ea538e` copy, so the files themselves were right.)
- First implementation step: restore all three files from `b1ea538e`, re-hash Genomix, then capture `git status` and `git diff --stat b1ea538e..HEAD` as the pre-edit record.

## 2. Product verification (no code change)

- Accounting, billing (3D-Q.1/Q.2), Safe Re-analysis: the full vitest suite, including the Genomix acceptance and Horizon suites.
- AI constants: confirm model `gpt-5.6-terra`, prompt `arc.ai.prompt.v14`, schema `arc.ai.schema.v9`, `store:false`, and the 10 MB / 500 pages / 200k-token limits, by reading the source and running the existing tests.
- Allowance: guest 3 per session and 6 attempts; signed-in 10 per month and 20 attempts; refund on failure. Covered by `phase3dt_allowance_refund.sql` and `phase3dt_sessions.sql`.
- New/Recent/Save: the existing 3D-T specs (`guest-sessions-3dt`, `new-analysis-samples`, `recent-direct-save`). Also a grep check that temporary analyses are only created by POST.
- Auth: email magic link only. Grep for OAuth/Google providers in source and config.
- Maintenance: read `.github/workflows/maintenance.yml` (`17 * * * *`) and the endpoint auth tests. Confirm pg_cron is still optional and not applied.
- Routing: a Playwright check on the local preview for `/`, `/about`, `/analysis/new`, `/recent`, `/auth`, `/privacy`, `/sitemap` and the Horizon sample path, plus the analysis subpages (documents, review, schedule, balances, journals). It checks for 404s, redirect loops and console errors, and confirms no temporary analysis is created just by navigating.

## 3. Approved copy corrections

**A. Step 4 review summary.** `src/lib/arc/ai/merge.ts` (reason for `provisional_ssp_basis`, about line 1977). This one sentence covers every provisional-SSP case, whether the contract states an SSP amount or only a contract price. It is triggered by method `stated_contract_price_assumption`. So I'll use wording that is accurate in both cases:
> "ARC used the standalone selling price amounts stated in the contract provisionally for {names}. The contract does not provide evidence of observable standalone sales, so confirm this basis or enter your own."

Only the sentence changes. Logic, value, fingerprint inputs and the reason code stay the same. Before editing I'll confirm the reason text isn't part of any review fingerprint or persisted comparison key. If it is, I stop and report back. Test: update or add an assertion in the existing merge provisional-SSP spec (found with `rg provisional_ssp_basis src/**/__tests__`).

**B. Allowance wording.** `src/components/arc/AiAnalysisAction.tsx:50` changes from "{n} of {limit} analyses remaining" to "{n} of {limit} AI analyses remaining". I'll also update `AI_ALLOWANCE_HEADLINE` in `failure-presentation.ts` ("No analyses remaining" becomes "No AI analyses remaining") so the two messages match. **Owner to confirm** that the headline change is covered by item B. Tests: any spec asserting the old strings gets updated.

## 4. Newly discovered copy issues (list only, not fixing)

- README "Quality & Testing" says 2,812 tests / 223 files. It is now about 2,897 / 232. This is a docs change, covered in section 6.
- The full public-surface copy review (section 20 of the brief) runs during implementation. Anything found will be listed for your approval, not changed.

## 5. Documentation audit: what is stale now

- **README.md**: the test counts. The quota and temporary-analysis model isn't described (guest allowance per 9-hour session, delivered analyses only, Recent Analyses, direct Save). Otherwise accurate: no Google, and the scope boundaries are correct.
- **roadmap.md**: the production line says "schema v7, prompt v11" and "guest 3 per 9-hour workspace". Open items remain for 3D-Q.1/Q.2 (the Redwood live run, schema v9/prompt v13), even though they were accepted. 3D-T and the allowance refund are missing, and 3E isn't marked as final.
- **AGENTS.md** (11 lines): to be checked against the section 19 list. I'll only update rules that are now wrong (for example, one guest workspace per session, or failed runs counting).
- **docs/operations.md**: the maintenance and www→apex sections look current. I'll check the quota and guest-model wording.
- **docs/phase-8-acceptance.md**: historical record. I'll only add a one-line note that it is historical, if needed.

## 6. Documentation change plan

- README: correct the counts; add short "Allowance" and "Temporary & saved analyses" notes; add the final scope statement from brief section 30 (not an ERP, billing system, posting engine or close platform).
- roadmap.md: mark 3D-Q.1, 3D-Q.2, 3D-T and the allowance refund complete; fix the production facts line; add a 3E final-verification/archive section; move leftover ideas to a short "Post-v1 (not planned)" list. No new Phase 4.
- AGENTS.md and operations.md: targeted line fixes only.

## 7. Security and database review

- Run the security scan and list every warning, classified as intentional service-only/private-table pattern, informational (leaked-password protection), or genuine concern. Nothing is "fixed" by loosening access. A genuine blocker means stopping.
- Migration chain: list the applied migrations and map them to sessions, per-analysis workspaces, session quota, legacy upgrade, refund, attempt caps, cleanup, account deletion and Save. No new migration.
- Run all SQL suites with `scripts/run-sql-suites-local.sh`. They cover RLS, cross-session and cross-user denial, private storage, and service-only guest tables.
- Run the bundle audit (`scripts/audit-bundle.sh`) for service-role and secret material.

## 8. Verification matrix

Focused specs for A and B, then `bun run verify` (tests, typecheck, lint, build, bundle audit), all SQL suites, and both GitHub jobs (owner). Final counts go in the report.

## 9. Production smoke test (after owner-approved publish only)

HTTP and Playwright checks of `/`, `/about`, `/analysis/new` (Horizon only), `/recent`, `/auth` and the sample path on https://ayden-rc.com, plus a console-error capture. Authenticated My Contracts only if the owner logs in. No AI runs.

## 10. Archive construction

After final acceptance, restore the frozen files, then run:
`git archive --format=zip --prefix=arc-recruiter-v1/ -o /tmp/arc-recruiter-v1.zip HEAD`
This includes tracked files only. Any path that is tracked but must be excluded is removed with `export-ignore` applied through `git archive` pathspec exclusions (`:(exclude).env` and so on). No `.gitattributes` is committed unless you approve it. After the audit, copy the archive to `/mnt/documents/`.

## 11. Archive exclusions

`.git`, `.env` and any `.env*`, `node_modules`, `dist`/`.output`/caches, `/tmp` residue, screenshots and renders outside `docs/assets`, uploaded mock contracts (Test 03/06 and others) unless intentionally tracked, `.lovable/plan.md` and the `.lovable/plan/` archives (internal working plans), and `.workspace`/`.agents`/`.claude`. Kept: `fixtures/genomix…pdf`, `public/samples/horizon…pdf`, `docs/assets/*`, `supabase/` migrations and tests.

## 12. Archive verification

`unzip -l` listing reviewed file by file; `.env` confirmed absent; `rg` over the extracted tree for JWTs, `sb_secret_`, `service_role` key values, `sk-`, `OPENAI_API_KEY=` values, and private keys; the bundle audit re-run; the PDF list checked against the intended fixtures; Genomix re-hashed inside the archive.

## 13. Filename

`arc-recruiter-v1.zip`.

## 14. Expected file changes

- `src/lib/arc/ai/merge.ts` (one sentence), plus its spec
- `src/components/arc/AiAnalysisAction.tsx`, and `src/lib/arc/ai/failure-presentation.ts` if you confirm, plus the affected specs
- `README.md`, `roadmap.md`, `AGENTS.md` (if needed), `docs/operations.md` (if needed)
- `.env`, `package.json`, `bun.lock` restored to `b1ea538e`, so they show no net diff against the accepted state

Dependency change: none.

## 15. Stop conditions

Any need to touch accounting, billing, prompt/schema/model, citations, Safe Re-analysis, quota semantics, guest-session or auth architecture, Recent/My Contracts design, or RLS; a migration; a dependency change; another public sample; a genuine security-scan blocker; the Step 4 reason text feeding a fingerprint; a Genomix hash change; or sensitive content found in the archive.

## Decisions needed

1. Is the "No AI analyses remaining" headline change covered by item B?
2. Should the `.lovable/plan/` archives be excluded from the recruiter archive? (Recommended: yes.)
