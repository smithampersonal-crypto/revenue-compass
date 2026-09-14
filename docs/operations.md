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

### Production deployment (required manual steps)

1. **Database schedule.** Enable `pg_cron` in the Supabase project and apply
   `supabase/schedules/arc-hourly-maintenance.sql` once. This runs steps 1
   and 2 every hour.
2. **Storage drain schedule.** Set the repository secrets
   `ARC_MAINTENANCE_URL` (the deployed
   `https://<host>/api/public/maintenance`) and `ARC_MAINTENANCE_SECRET`
   (identical to the deployed `ARC_MAINTENANCE_SECRET` environment variable).
   `.github/workflows/maintenance.yml` then calls the endpoint hourly. The
   endpoint verifies the bearer secret in constant time and is closed when the
   secret is unset; it returns counts only.

#### Which schedule is authoritative

`pg_cron` (step 1) is the **authoritative production hourly trigger** for
abandoned-upload cleanup and guest expiry. It runs inside the database, needs
no deployed application and no secret.

The GitHub Actions workflow (step 2) is the **only** trigger for the Storage
drain, because deleting private objects requires the application's storage
credentials. It also re-runs steps 1 and 2 as a harmless fallback.

Enable both: they cover different work. They are deliberately offset (`7 * * * *`
for pg_cron, `17 * * * *` for the workflow) and remain correct if they overlap —
claiming is `for update skip locked`, queue rows are terminal, and the
`cleanup_queued_at` marker makes stale-intent cleanup one-time. Do not add a
third scheduler.

Both schedules are safe to overlap, to fail partially and to restart midway.

### Observability

A maintenance invocation returns counts only: stale intents processed, objects
queued, guest workspaces marked expired and deleted, and deletion jobs claimed,
completed, already-absent and released, plus failures by safe category
(`not_found`, `permission`, `network`, `unknown`). Document text, raw PDF
bytes, signed URLs, object paths, auth tokens and guest credentials are never
recorded.

## Verification

- `bun run verify` — application tests, typecheck, lint, production build and
  the client-bundle service-role leakage audit.
- `bun run db:test` — every SQL suite in `supabase/tests/` against a local
  Supabase database (`supabase start`, or set `ARC_DB_URL`).
- `.github/workflows/verify.yml` runs both on push and pull request using a
  local Supabase stack; no production service-role secret is required.

## Production release prerequisites (outside this codebase)

- **Custom SMTP.** ARC v1 is magic-link only. Supabase's built-in development
  mail service is intentionally rate-limited and is not suitable for public or
  recruiter traffic. A verified sending domain and SMTP provider must be
  configured in Supabase Auth before launch.
- **`ARC_SITE_URL`** must be set to the deployed origin so magic-link callback
  URLs are built from trusted configuration.
- **Leaked-password protection** is reported by the Supabase linter but is not
  applicable: ARC stores no passwords.
