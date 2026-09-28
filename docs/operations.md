# ARC operations

## Temporary (guest) workspace retention

A temporary workspace lives for exactly nine hours. That lifetime is the whole
retention boundary:

- Authorization always checks `expires_at` on every load and save. It never
  depends on whether cleanup has run.
- `public.arc_expire_guest_workspaces()` marks passed-expiry `active` rows as
  `expired` (status hygiene only).
- `public.arc_delete_expired_guest_workspaces()` physically deletes every row
  whose `expires_at` has passed. Idempotent migration recovery therefore lasts
  exactly as long as the original workspace did — never longer.

Both routines are `SECURITY DEFINER` and executable by `service_role` only;
`public`, `anon` and `authenticated` are revoked.

Scheduling is covered by hourly ARC maintenance below. Missing a run is safe:
an expired workspace is already unauthorized.

## Hourly ARC maintenance (Phase 8F)

One entrypoint performs every recurring cleanup:

1. **Abandoned uploads** — `public.arc_cleanup_stale_upload_intents(limit)`.

   Three distinct lifetimes apply, and they must not be conflated:

   - ARC logical upload-intent lifetime: **1 hour** (`expires_at`). After this
     the intent can no longer be prepared, committed or finalized.
   - Supabase signed-upload capability: **2 hours** — the token handed out by
     `createSignedUploadUrl` can still write bytes into the `pending/...` path
     after the ARC intent has logically expired.
   - Abandoned Storage cleanup: after capability expiry **+ 15 minutes' grace**,
     i.e. `expires_at < now() - interval '1 hour 15 minutes'`, which is roughly
     `created_at + 2 hours 15 minutes`. Physically staging the object for
     deletion any earlier could delete a path the browser still holds a valid
     capability to write, orphaning the late bytes against a terminal queue row.

   An upload intent is therefore eligible for storage cleanup when
   `expires_at < now() - interval '1 hour 15 minutes'`, its state is
   `pending`, `prepared` or `failed`, and its one-time `cleanup_queued_at`
   marker is still null. Once every required object is durably queued the row
   is atomically moved to the terminal `failed` state with `cleanup_queued_at`
   set, so cleanup happens exactly once per intent: an old cleaned row can
   never re-queue an already-deleted object, nor consume the bounded batch and
   starve newer stale work. A failure before durable queueing aborts the
   statement and leaves the marker null. A `finalized`
   intent and every Source Document are never touched, and the Phase 8E upload
   diagnostics are preserved. Rows are taken with `for update skip locked`, so
   an in-flight finalization is yielded to rather than raced.
   Queue rows are keyed on `(bucket, path)` and are terminal: because ARC
   storage paths are immutable and never reused, an existing pending, claimed
   or completed job stays authoritative and is never reopened.

2. **Nine-hour guest expiry** — `arc_expire_guest_workspaces()` then
   `arc_delete_expired_guest_workspaces()`. Expiry is decided from
   `expires_at` in the database, never from browser time. A `before delete`
   trigger on `source_documents` (and on `document_upload_intents`) queues each
   storage object before relational ownership disappears, so no cascade can
   orphan a private object. A document migrated to an authenticated contract is
   no longer owned by the guest workspace and therefore survives.
3. **Storage deletion drain** — the application worker
   (`src/lib/arc/maintenance/`): claim a bounded batch through
   `arc_claim_storage_deletion_jobs`, delete each object from the private
   bucket, complete the successful jobs, and release the retryable failures
   with a safe error category only. An object that is already absent completes
   the job (desired end state) instead of retrying forever; a job never
   disappears because deletion failed.

`public.arc_run_maintenance(limit)` runs steps 1 and 2 in isolated blocks, so
one failing category never discards another's work.

### Production scheduling (current, recruiter-v1)

**Authoritative scheduler: GitHub Actions → deployed maintenance endpoint.**
`.github/workflows/maintenance.yml` runs hourly at minute 17 (`17 * * * *`)
and can be started manually (`workflow_dispatch`). It calls
`https://ayden-rc.com/api/public/maintenance`, which runs steps 1, 2 and 3
above in one bounded invocation. The endpoint verifies the bearer secret in
constant time, is closed when the secret is unset, and returns counts only.
The repository secrets `ARC_MAINTENANCE_URL` and `ARC_MAINTENANCE_SECRET` and
the deployed `ARC_MAINTENANCE_SECRET` are configured; manual and natural
scheduled runs have both returned a counts-only 200 without logging the secret.

**Optional artifact: `supabase/schedules/arc-hourly-maintenance.sql`.**
This pg_cron schedule stays in the repository as an optional database-side
trigger for steps 1 and 2. It is **not applied, not required and not
authoritative** for recruiter-v1. The GitHub workflow alone covers all three
steps. If it is ever applied, it is offset (`7 * * * *`) and safe to overlap:
claiming is `for update skip locked`, queue rows are terminal, and the
`cleanup_queued_at` marker makes stale-intent cleanup one-time.

Every run is safe to overlap, fail partially and restart midway.

### Observability

A maintenance invocation returns counts only: stale intents processed, objects
queued, guest workspaces marked expired and deleted, and deletion jobs claimed,
completed, already-absent and released, plus failures by safe category
(`not_found`, `permission`, `network`, `unknown`). Document text, raw PDF
bytes, signed URLs, object paths, auth tokens and guest credentials are never
recorded.

## Temporary analyses and AI allowance (recruiter-v1)

- **Browser session.** One nine-hour browser session groups any number of
  temporary analyses (Recent Analyses). Each analysis has its own draft,
  source documents, AI state, review state and lock, and is reached with a
  server-derived per-analysis credential. A temporary analysis is created only
  by an explicit action (POST), never by navigation.
- **Save to My Contracts** (signed in, from the workspace or directly from
  Recent Analyses) moves one analysis into durable ownership through the same
  migration path. It removes only that analysis from Recent, keeps its
  siblings, does not rerun AI, does not use allowance and does not reset the
  session. Signing in never saves or syncs temporary analyses automatically.
- **Visible AI allowance** counts delivered analyses: guest 3 per browser
  session, signed in 10 per calendar month (UTC). Runs still in progress hold a
  place for concurrency; a run ARC rejects (invalid response, citation
  rejection, API or application failure) releases it, and the failed run
  record is kept.
- **Technical attempt safeguard** counts every provider start regardless of
  outcome: 6 per guest session, 20 per signed-in month. Reaching it refuses the
  run before the provider is called, with its own message.
- Both counts are defined once in the database and read by the UI; the app
  never re-derives them.

## Verification

- `bun run verify` — application tests, typecheck, lint, production build and
  the client-bundle service-role leakage audit.
- `bun run db:test` — every SQL suite in `supabase/tests/` against a local
  Supabase database (`supabase start`, or set `ARC_DB_URL`).
- `.github/workflows/verify.yml` runs both on push and pull request using a
  local Supabase stack; no production service-role secret is required.

## Production configuration (completed)

- **Domain.** Production runs at `https://ayden-rc.com` over HTTPS; `www`
  redirects to the apex.
- **Auth and mail.** ARC v1 is email magic-link only (no passwords, no social
  login). Magic links are delivered through a custom SMTP provider on the
  verified sending domain `mail.ayden-rc.com`, configured in Supabase Auth.
- **`ARC_SITE_URL`** is set to `https://ayden-rc.com`, so magic-link callback
  URLs are built from trusted configuration.
- **Leaked-password protection** is reported by the Supabase linter but is not
  applicable: ARC stores no passwords.
