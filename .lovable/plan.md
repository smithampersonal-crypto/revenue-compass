# Package 3E — Final Production Verification, Documentation Reconciliation & Recruiter Archive (PLAN ONLY)

## 1. Current-State Audit
Inspected: README.md, roadmap.md, docs/operations.md, docs/phase-8-acceptance.md, .github/workflows/maintenance.yml, package.json, bun.lock, root .env (key names only), fixtures/, .lovable/, tracked-file list, Bun audit capability.

Consistent with the brief:
- Genomix SHA-256 = `7487979e42fb2dab23c6a6b4858806ae0d37831c63c0ddd98730fccf09fdd4c7` (matches).
- No tracked junk (no logs, dist, .output, node_modules, tsbuildinfo, .DS_Store). Only `.env` is a tracked env file (intentional).
- No Google/OAuth code in src; README auth language contains no Google references.
- `.lovable/project.json` and 13 historical `.lovable/plan/` files present.

Discrepancies found (recurring platform drift, not product drift):
- **D1 — `.env` currently has six keys** (adds SUPABASE_PROJECT_ID, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, VITE_SUPABASE_PROJECT_ID). Accepted = two VITE values.
- **D2 — `package.json` pins `@lovable.dev/vite-tanstack-config` to exact `2.23.1`; `bun.lock` resolves `2.23.1`.** Accepted = `^2.15.0` / `2.15.0` Europe West 4.
- These match the known post-publish drift pattern and will be restored first from the files in `(161)` (not reconstructed, not from a historical commit), without publishing.

Baseline availability:
- `revenue-compass-main(161).zip` is the authoritative baseline; the owner will upload it before implementation. Git commit `f4a6520a` may be used only as supporting evidence unless it is first shown to be byte-identical to `(161)`.

## 2. Stale Documentation Identified
| # | File / location | Current wording | Why stale | Approach | Historical? |
|---|---|---|---|---|---|
| S1 | README "Quality & Testing" | "2,592 automated tests across 200 test files" | Pre-3D counts | Replace with fresh 3E count | No — current state |
| S2 | README (no production/ops section) | No live domain, maintenance model or auth scope stated | Missing current truth | Add a short "Production" paragraph: ayden-rc.com, magic-link only, GitHub Actions hourly maintenance | No |
| S3 | docs/operations.md §"Production deployment" steps 1–2 and "Which schedule is authoritative" | "pg_cron … authoritative production hourly trigger"; "Enable both" | Contradicts accepted truth | Rewrite: GitHub Actions → endpoint is authoritative and runs steps 1–3; pg_cron SQL optional/unapplied, not required | No — current operator guidance |
| S4 | docs/operations.md "Production release prerequisites" | Custom SMTP "must be configured before launch"; ARC_SITE_URL "must be set" | Both complete | Retitle to completed configuration; state SMTP via mail.ayden-rc.com and ARC_SITE_URL = https://ayden-rc.com (no secrets) | No |
| S5 | docs/phase-8-acceptance.md "Manual production configuration still required" | pg_cron described as authoritative; items listed as outstanding | Phase 8 checkpoint wording readable as current | Keep text; retitle "At the Phase 8 checkpoint…" and add a current-state note pointing to operations.md | Yes — preserve |
| S6 | docs/phase-8-acceptance.md human-only persistence rows | Marked "Human" pending | Later verified by owner (3D) | Add a dated current-state note; leave table as-is | Yes — preserve |
| S7 | .github/workflows/maintenance.yml comment line 12 | `e.g. https://<project>.lovable.app/api/public/maintenance` | Production is ayden-rc.com | Leave workflow byte-identical; state the production URL in operations.md | No |
| S8 | roadmap.md line 232 (3D checklist) | `[ ] 7 Owner-session persistence (owner)` | Verified by owner | Mark `[x]` with a short "owner-verified" note | Checklist — update |
| S9 | roadmap.md line 173 | "magic-link delivery deferred to Package 3 SMTP/Resend" | Checkpoint-accurate | Leave unchanged (historical) | Yes |
| S10 | roadmap.md earlier test counts / schema v6 line | Checkpoint counts | Accurate for their checkpoints | Leave unchanged | Yes |

Not found (checked): stale Horizon $120,000, Google OAuth plans, subledger positioning (README already says "not a generalized commercial revenue subledger"), sitemap/footer references omitting /about in docs.

## 3. Exact Files Proposed to Change
- `README.md` — S1, S2. Documentation only. No runtime effect.
- `docs/operations.md` — S3, S4. Documentation only. No runtime effect.
- `docs/phase-8-acceptance.md` — S5, S6 (labels/notes only). No runtime effect.
- `roadmap.md` — S8 + new Package 3E evidence section. No runtime effect.
- `.github/workflows/maintenance.yml` — **not changed** (stays byte-identical, per owner). S7 is handled in operations.md and README instead.
- Drift restoration only (returns to the `(161)` state, not a 3E change): `.env`, `package.json`, `bun.lock`.

No runtime/product source file needs to change.

## 4. Dependency/Security Audit Method
Environment: Bun 1.3.3, which supports `bun audit` (reads the lockfile-installed tree; queries the npm advisory database; read-only; no fix mode exists).
- `bun audit --json > /tmp/3e/audit.json` (full data), and `bun audit` for the human-readable summary.
- Severity: tallied from JSON (critical/high/moderate/low).
- Direct vs transitive: match each advisory package against `dependencies` / `devDependencies` in package.json; otherwise transitive, with the parent chain from `bun pm ls --all` (read-only).
- Runtime vs tooling: runtime = reachable from `dependencies` and bundled into the client/worker; tooling = only via devDependencies (vitest, eslint, supabase CLI, build). Cross-check high/critical runtime hits against the built output.
- False positives: advisories for unused code paths (e.g. dev-server-only, CLI-only) documented with reasoning; never suppressed by `--ignore`.
- No `bun update`, `bun add`, or any fixer. Any material runtime vulnerability requiring an upgrade → STOP for owner review. `@lovable.dev/vite-tanstack-config` stays at 2.15.0.

## 5. Final Verification Command Sequence
```text
P  Prerequisite: owner uploads revenue-compass-main(161).zip
   unzip to /tmp/3e/base (read-only reference); record SHA-256 of the ZIP
   (optional support only) prove whether git f4a6520a == (161) byte-for-byte
0  Restore D1/D2 drift from (161)  (changes files — expected):
   cp /tmp/3e/base/package.json  -> package.json   (only if the only difference is the drifted dependency value;
                                                     otherwise patch just that one value to the (161) value)
   cp /tmp/3e/base/bun.lock      -> bun.lock
   write .env with exactly the two existing approved public VITE_* values
   bun install --frozen-lockfile                   (installs dependencies only)
1  Frozen check F1: .env key names; cmp package.json and bun.lock against (161); grep ^2.15.0 / 2.15.0 / europe-west4, no 2.23.1
2  DIFF A — pre-edit integrity diff vs (161) (method in Section 6)
   STOP if any unexplained product/runtime/config/database drift
3  bun audit --json ; bun audit                   (read-only; no fixes, no upgrades)
4  Apply approved doc edits: README.md, docs/operations.md, docs/phase-8-acceptance.md, roadmap.md
5  bun run verify                                 (writes only ignored build output)
6  Hygiene + secret scans (Section 6)             (read-only)
7  sha256sum fixtures/genomix-synthesis-contract-package.pdf
8  Frozen check F2 + tracked-change check: verify and the other checks added no unexpected tracked changes.
   Only expected changes: README.md, docs/operations.md, docs/phase-8-acceptance.md, roadmap.md.
   .env, package.json and bun.lock must match (161) byte-for-byte, so they are not 3E changes. Any other tracked change = STOP
9  DIFF B — final release diff vs (161): authoritative; every changed path classified
   expected = approved docs/evidence files only (plus drift files now matching (161) exactly)
10 Owner confirms GitHub app + database jobs green on the final 3E commit (external)
11 Build ZIP from tracked files (Section 7); Frozen check F3 on the tree
12 Validate ZIP (Section 8), including Frozen check F4 inside the ZIP
```
Ordering: drift restoration comes first, otherwise every later check fails on D1/D2. Diff A runs before any doc edit, so it can only show drift. Diff B runs after verification and scans and is the one the completion report uses.

## 6. Repository / Secret / Hygiene Checks
- Tracked junk: `git ls-files | rg -i '(^|/)(node_modules|dist|\.output|\.vinxi|\.tanstack|\.nitro|\.wrangler)/|\.log$|\.tsbuildinfo$|\.DS_Store|Thumbs\.db|\.dev\.vars|\.swp$'` → expect empty.
- `.env`: only key names printed (`cut -d= -f1`); expect exactly VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY; decode the key's JWT payload role field only → expect `anon`.
- Secret values (tracked files): `git ls-files -z | xargs -0 rg -n -I` for value patterns, not names: `sk-(proj-)?[A-Za-z0-9_-]{20,}`, `sb_secret_[A-Za-z0-9_-]{8,}`, `re_[A-Za-z0-9]{20,}` (Resend), `-----BEGIN [A-Z ]*PRIVATE KEY`, JWTs whose decoded payload has `"role":"service_role"`, `ARC_MAINTENANCE_SECRET\s*[:=]\s*\S{16,}`, `(SMTP|OPENAI)_[A-Z_]*\s*=\s*\S`. Output only file:line, never the matched value. Bare identifiers (`OPENAI_API_KEY` in code/docs/tests) are expected and not leaks; test fixtures with obvious dummy values will be listed and justified.
- Client bundle: existing `audit:bundle` inside verify, plus the same value regexes over `dist/client` (or `.output/public`).
- Package/lock drift: F1–F4 checks.
- Migration/config drift + product-source drift: see diff below.

Diffs A and B vs (161): stage the tracked tree (`git ls-files -z` minus the approved denylist) to `/tmp/3e/cur`; apply the same denylist to `/tmp/3e/base`; then run `diff -rq` plus a per-file SHA-256 manifest comparison (added / removed / changed). Every path is labeled approved-docs, drift-restored (must equal (161)), or unexplained. Diff A expects zero changes after restoration; Diff B expects only the four approved doc files. Any change under `src/`, `supabase/`, `scripts/`, `public/`, `fixtures/`, config files (`vite.config.ts`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.js`, `supabase/config.toml`, workflows) → STOP.

## 7. Final ZIP Construction Method
Deterministic, built from tracked files only — no untracked files, no manual selection, and no repo files deleted:
```text
git ls-files -z | python3 /tmp/3e/make_zip.py
```
`make_zip.py`:
- Denylist regexes: `^\.env$`, `^\.env\.`, `^\.lovable/plan\.md$`, `^\.git/`, `(^|/)(node_modules|dist|\.output|\.vinxi|\.tanstack|\.nitro|\.wrangler)/`, `\.dev\.vars$`, `\.tsbuildinfo$`, `\.log$`, `(^|/)\.DS_Store$`, `Thumbs\.db$`, `\.swp$`, `~$`, `(^|/)\.idea/`, `(^|/)\.vscode/`.
- Keeps `.lovable/project.json`, `.lovable/plan/**`, `.github/**`, `.prettierrc`, `.prettierignore`, `.gitignore` etc. because they are tracked and not denylisted.
- Sorted paths, fixed timestamp (1980-01-01), fixed permissions, DEFLATE → reproducible bytes; writes `/tmp/3e/ARC-recruiter-v1-source.zip` and a manifest (path + SHA-256), then copies the ZIP to Files after validation passes.

## 8. Final ZIP Validation Method
Python `zipfile` script against the ZIP itself:
- Full listing saved to `/tmp/3e/zip-listing.txt` and reported (count + tree summary).
- Forbidden: assert no entry matches any denylist regex; explicit asserts for `.env`, `.env.*`, `.lovable/plan.md`.
- Required present: `.lovable/project.json`, every `.lovable/plan/*` tracked in git, `package.json`, `bun.lock`, `README.md`, `roadmap.md`, `docs/**`, `supabase/migrations/**`, `supabase/tests/**`, `supabase/config.toml`, `.github/workflows/verify.yml` + `maintenance.yml`, `public/**`, `fixtures/genomix-synthesis-contract-package.pdf`, `src/routes/about.tsx`, `src/lib/arc/ai/**`.
- Completeness: set(ZIP entries) == set(`git ls-files`) − approved exclusions; any difference fails.
- Equivalence: SHA-256 of every ZIP entry == SHA-256 of the same file in the verified working tree.
- Genomix: hash of the in-ZIP bytes == `7487979e…fdd4c7`.
- `package.json` in ZIP parsed: devDeps/deps value for `@lovable.dev/vite-tanstack-config` == `^2.15.0`; `bun.lock` in ZIP contains `@lovable.dev/vite-tanstack-config@2.15.0` with europe-west4 URL and no `2.23.1`.
- Secrets: same value regexes from Section 6 run over every extracted text entry; file:line only.
Any failure → STOP, no copy to Files.

## 9. Roadmap / Documentation Reconciliation Plan
New `roadmap.md` "Package 3E" section, three labeled groups:
- Current production truth: https://ayden-rc.com (www → apex); magic-link only via SMTP on mail.ayden-rc.com; maintenance = GitHub Actions hourly at :17 → /api/public/maintenance (pg_cron optional, unapplied); AI GPT-5.6 Terra, schema v7, prompt v11; quotas guest 3/9h, signed-in 10/month; limits 10 MB / 500 pages / 200k tokens.
- Historical acceptance (previously verified, not re-run): 3D owner-session persistence; 3D-P/Q/R/S accepted; 3D-S live; prior Genomix production analysis; maintenance manual + scheduled 200 runs.
- Fresh 3E evidence: test files/tests count, typecheck, lint (errors/warnings), build, bundle audit, dependency audit summary, hygiene + secret scans, diff result, Genomix hash, archive name + validation result, "no AI run consumed in 3E", "no publish in 3E".
Plus S8 checkbox update. Earlier roadmap sections otherwise untouched.

## 10. Completion-Report Structure
```text
Package 3E completion
A. Fresh 3E repository evidence (executed this package)
   drift restored | dependency audit (by severity, runtime vs tooling) | verify counts |
   typecheck | lint | build | bundle audit | hygiene scan | secret scan | diff vs (161) with per-file
   classification | Genomix hash | frozen checks F1–F4 | ZIP build | ZIP validation results
B. Previously accepted production evidence (not re-run)
   domain/HTTPS/www | SMTP magic-link | owner persistence | maintenance manual+scheduled |
   Genomix production AI run | live About page | prior smoke tests
C. Owner-confirmed / external evidence
   GitHub application job | GitHub database job (with run links/dates supplied by owner)
D. Confirmations: no AI run, no publish, no dependency change versus the accepted (161) baseline, no runtime source change
E. Deliverable: ARC-recruiter-v1-source.zip
```

## 11. Release Blockers / Owner Decisions
No release blocker identified at the planning stage. Owner decisions settled: `(161)` is the authoritative baseline, D1/D2 are restored from `(161)`, and maintenance.yml stays byte-identical. Remaining prerequisites:
1. Owner uploads `revenue-compass-main(161).zip` (step P) before implementation starts.
2. Owner confirms both GitHub jobs are green on the final 3E commit (they can't be triggered from here).
