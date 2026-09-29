# Package 3G — Recruiter v1 release freeze and canonical archive (PLAN ONLY)

Nothing was changed. Findings come from read-only inspection of the current repository.

## A. Frozen baseline found in source

- Schema `arc.ai.schema.v10` (v5–v9 kept as legacy only). Prompt `arc.ai.prompt.v17`. Both are compiled constants.
- Maintenance workflow runs `17 * * * *`. The pg_cron SQL is present but optional.
- Genomix PDF `7487979e…fdd4c7` and Horizon PDF `a39c8883…9c70` both match.
- 741 tracked files.
- **STOP-level finding: the platform drift has come back since the last restore.** Compared with `b1ea538e`:
  - `package.json` now pins `@lovable.dev/vite-tanstack-config` to `2.23.1` instead of `^2.15.0`.
  - `bun.lock` resolves 2.23.1 from the europe-west1 registry.
  - `.env` has 6 keys instead of the 2 approved VITE values.
  - Restoring these three files byte-for-byte from `b1ea538e` is the first step of implementation. No verification or archive build happens before that.

## B. Documentation drift (factual only)

1. `README.md` line 107 says "2,908 automated tests across 234 test files". That's stale. It becomes the count from the final gate (currently 3,038 / 239).
2. `roadmap.md` line 273 in the production summary says "`arc.ai.prompt.v14`, `arc.ai.schema.v9`". That's stale. It becomes `arc.ai.prompt.v17`, `arc.ai.schema.v10`.
3. `roadmap.md` needs a short "Package 3G — Release freeze" task list, following the project's roadmap rule.
4. Checked and accurate, so no change: README live domain and magic-link-only auth, operations.md (9-hour retention, minute-17 GitHub scheduler, optional pg_cron, domain/www/SMTP), AGENTS.md.
5. The `maintenance.yml` comment's example URL (`<project>.lovable.app`) is only a placeholder example, not a claim. Leave it.
6. `package.json` `"name": "tanstack_start_ts"` is template metadata. It's not wrong, so leave it.

## C. Repository hygiene

- A. Belongs in the repo: `src/`, `supabase/` (migrations, tests, schedules), `.github/`, `scripts/` (including the audit, SQL runners and the phase9d/9f live scripts, which hold no secrets), `docs/` plus 3 screenshots, `fixtures/` Genomix PDF, `public/samples/` Horizon PDF, `guidance/`, and the config files.
- B. Kept locally but excluded from the archive: `.env`, `.lovable/` (tracked planning history), `.workspace/`, `.git/`, `node_modules/`, `tsconfig.tsbuildinfo` (ignored), any `dist/.output/coverage`.
- C. Remove from the repo: none. There are no tracked ZIPs, logs, dumps, OS or editor files, or customer PDFs.
- `/mnt/documents` holds about 100 historical ZIPs and PNGs. They sit outside the repo and are never archived. The historical `arc-recruiter-v1.zip` (60a4df5a…) gets replaced under the same name.

## D. Security and secret audit

- A quick scan of tracked files found no literal `sk-` keys, `sb_secret_` values, or credentialed `postgres://` strings. `service_role` appears only as a role name in SQL grants and policies.
- Checks for the final gate:
  - `audit:bundle` on the fresh build.
  - rg over the staged archive for `sk-[A-Za-z0-9]{20,}`, `sb_secret_\w{8,}`, service-role JWT payloads (`"role":"service_role"` or base64 `cm9sZSI6InNlcnZpY2Vfcm9sZ`), `://[^:@\s]+:[^@\s]+@`, `-----BEGIN .*PRIVATE KEY`, and `re_[A-Za-z0-9]{20,}` (Resend).
  - Confirm that no `.env*` file is staged.
  - Confirm the only PDFs are the two canonical ones.
- Environment-variable names alone are not treated as secrets.

## E. Files that need changes

- Restore `.env`, `package.json` and `bun.lock` from `b1ea538e` (protected state, not a product change).
- `README.md`: one test-count sentence.
- `roadmap.md`: the version line, plus the 3G task list.
- No other files.

## F. Archive policy

- Root: `arc-recruiter-v1.zip` → `revenue-compass-main/…`
- Contents: `git ls-files` at the final verified commit state, minus these exclusions: `.env`, `.env.*` except `.env.example`, `.lovable/**`, `.workspace/**`.
- Because the list comes from tracked files only, `.git`, `node_modules`, `dist`, `.output`, coverage, logs, caches, tsbuildinfo and ZIPs are excluded automatically.
- Required contents (asserted): `.github/`, `supabase/migrations`, `supabase/tests`, `scripts/audit-bundle.sh`, source tests, both canonical PDFs, and `docs/assets`.

## G. Build procedure

1. Only after the gate in section I passes with a clean working tree.
2. `git ls-files -z`, filter out the exclusions, copy with `rsync --files-from` into `/tmp/arc-release/revenue-compass-main/`.
3. List every staged entry, including hidden files, and review it.
4. `cd /tmp/arc-release && zip -rX /tmp/arc-recruiter-v1.zip revenue-compass-main`. This never runs inside the repo, so the archive can't include itself.
5. Copy to `/mnt/documents/arc-recruiter-v1.zip`, then report the name, SHA-256, file count, compressed size and uncompressed size.

## H. Post-build verification

Unzip into a fresh `/tmp/arc-verify/` and check:

- Forbidden paths are absent: `.env`, `.lovable`, `.workspace`, `.git`, `node_modules`, `dist`, `.output`, coverage, `*.zip`, `*.log`, `*.tsbuildinfo`.
- Required paths are present (the list in section F).
- Versions: v10 and v17 constants, `^2.15.0` in package.json, 2.15.0 plus the accepted europe-west4 line in bun.lock.
- Both PDF hashes match.
- Manifest diff: `sha256sum` of every file in the extract compared with the same files in the working tree, and the file list compared with the filtered `git ls-files`. Both must be identical.
- The secret rg from section D runs again on the extract.

## I. Final source verification

1. Restore the protected files. Check the PDF hashes.
2. Make the doc edits.
3. Run `bun run verify`: tests, typecheck, lint (exactly 0 errors / 11 warnings), build, bundle audit.
4. `bun run db:test` on all 26 SQL files.
5. Contention driver.
6. Protected-state and PDF-hash recheck, then restore any drift the tooling reintroduced.
7. Set the README test count to the observed numbers, then build the archive.

Any failure means STOP, and no archive gets built.

## J. GitHub CI

Tracked files change (README and roadmap, plus the protected-file restore), so both GitHub jobs must run on the pushed final state. The owner confirms both are green before the archive is accepted as canonical. If any tracked file changes after CI, the archive is rebuilt.

## K. Owner-run production smoke test (no AI run)

1. `http://www.ayden-rc.com` redirects to `https://ayden-rc.com` with a valid certificate.
2. The home page and header navigation load, and the footer shows About, Privacy and Sitemap.
3. New Analysis opens the chooser, and Horizon is the only public sample.
4. The Horizon analysis opens and its source PDF shows under Source Documents.
5. Tabs: ASC 606 (Step 3 is $153,000), Revenue Schedule, Balances, Journals.
6. Review & Finalize renders.
7. Recent Analyses lists "Sample — Horizon" and Resume works.
8. About and Sitemap load.
9. The sign-in page offers email magic link only.

## L. Stop conditions and risks

- Protected drift can't be restored, or it keeps coming back after restore.
- A PDF hash changes.
- A real secret is found.
- Any test, SQL or lint regression, or a new warning.
- Anything that would need product, schema, prompt, engine, auth, migration or dependency changes.
- Known risk: two UI specs have flaked on a first full run before. A flake needs a green re-run and gets reported. It is never accepted silently.
- Platform publishing can reintroduce drift. This package doesn't publish.

## M. Recommendation

The minimal tracked changes are the protected-file restore, one README sentence, and the roadmap version line plus the 3G tasks. There are no product changes.

Confirmed: no implementation, no product behavior change, no AI run, no publish, no archive built, no migration, no dependency change.
