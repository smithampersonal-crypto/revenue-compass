# Package 3D — Focused Production Verification (test plan only)

Verification only. No code, migration, RLS, secret, workflow or config changes. Package 3C preserved unchanged.

## Proposed AI fixture (single run)
Genomix / Synthesis fictional contract package (`fixtures/genomix-synthesis-contract-package.pdf`, 4 pages, 56,598 bytes, SHA-256 `7487979e…fdd4c7`, identity re-checked before use). It is the approved fixture used for every prior live AI acceptance and produces Source Evidence and review items. Horizon is not used for AI (it intentionally has no review items / Source Evidence).

## Test sequence

| # | Check | How proven | Live? |
|---|---|---|---|
| 1 | Domain routing: apex loads, valid HTTPS, `/analysis?sample=horizon` direct + reload, www → apex once, no preview-host dependency | curl (status, redirects, cert) + Playwright on ayden-rc.com; grep served HTML/JS for `lovable.app` preview host | Live, read-only |
| 2 | Horizon deterministic regression | Playwright on live `/analysis?sample=horizon`; transaction price $153,000; detailed expectations from the accepted Horizon test fixtures | Live, read-only |
| 3 | Guest PDF upload | Fresh guest browser; upload Genomix; confirm private Storage object, finalized intent, document row, workspace association (read-only DB queries, counts/ids only) | Live |
| 4 | One guest AI analysis | Run exactly once; capture the four progress stages; confirm completed state; confirm allowance count increased by exactly 1. On failure: no retry, STOP and report | Live, consumes 1 guest run |
| 5 | Deterministic outputs after AI | Allocation, schedule, balances, journals populate in same guest session | Live, read-only |
| 6 | Review & Finalize + Source Evidence | Open Review; open one citation; confirm the PDF opens through the authorized path; confirm unauthenticated/direct public Storage access is refused (any non-2xx) | Live |
| 7 | Auth persistence (save, My Contracts, reopen, refresh, sign-out, signed-out blocked) | Needs a real signed-in session — see owner actions. No new magic-link email unless the owner has no valid session | Live, owner |
| 8 | Quotas: guest 3 / 9-hour workspace, user 10 / month | Server config defaults (3 / 10) + no override env set + `arc_reserve_ai_allowance` definition + guest workspace expiry in DB. No runs spent to prove limits | Config/DB evidence |
| 9 | RLS / isolation | Signed-out REST calls with anon key to contracts, revisions, source_documents, storage objects → empty/denied; existing phase7/8 SQL suites (CI database job) as database-side evidence; guest A cannot read guest B document (second fresh guest browser, no upload) | Live read-only + existing evidence |
| 10 | Bundle secret hygiene | Download every deployed JS/CSS asset from ayden-rc.com; scan for `sk-`, `sb_secret_`, service-role JWT (`"role":"service_role"`), `re_` Resend keys, maintenance-secret markers. Public URL + anon key expected | Live, read-only |
| 11 | Maintenance | Record 3C evidence (manual + scheduled runs 200, counts-only, no secret). No new trigger | Existing evidence |

## Owner actions
1. Step 7: sign in on https://ayden-rc.com in your normal browser and perform save → My Contracts → reopen → refresh → sign out → try reopening the contract URL, reporting what you see. Alternatively authorize me to create one clearly labelled disposable test account and mint a session for it (no email sent).
2. Confirm GitHub jobs remain green on the final commit.
3. Resend SMTP and the Redirect URL entry remain your open items; not required for 3D unless you want a real email in step 7.

## Stop rule
Any defect: stop at it and report reproduction, root-cause evidence, affected invariant, narrowest correction. No automatic retry of the AI run. No Package 3E.
