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

### Scheduling

Run the physical cleanup hourly. Either option is acceptable:

1. **Database schedule (preferred).** With `pg_cron` enabled in the Supabase
   project:

   ```sql
   select cron.schedule(
     'arc-expire-guest-workspaces', '0 * * * *',
     $$select public.arc_delete_expired_guest_workspaces();$$
   );
   ```

2. **External scheduler.** Any hourly job that calls the routine with the
   service-role key. Never expose it to a browser.

Missing a run is safe: an expired workspace is already unauthorized.

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
