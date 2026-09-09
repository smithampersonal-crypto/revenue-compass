# ARC Roadmap

## Phase 7 — Identity + Core Persistence Foundation

- [x] 7A Foundation: enums, tables, constraints, grants, RLS, trusted SECURITY DEFINER
      functions, generated types, database/security tests. draft → finalized →
      superseded lifecycle with `analyses.current_finalized_revision_id`.
      **Awaiting review — do not start 7B until reviewed.**
- [ ] 7B Identity: auth server functions, sign-in/callback, account menu.
      Must include the Google-broker acceptance test (broker sign-in → user exists in
      this project's `auth.users` → `getUser()` verifies → caller-scoped query succeeds →
      RLS rejects another user's rows). Fall back to direct Supabase OAuth if it fails.
- [ ] 7C Persistence in the workspace (DTOs, workspace/revision server functions,
      autosave, lock-version conflicts).
- [ ] 7D Finalization snapshot + Review & Finalize lifecycle + revision history
      (Superseded shown explicitly).
- [ ] 7E Guest workspace (9-hour, HttpOnly credential only) + atomic migration.
- [ ] 7F Hardening: account deletion, bundle/network service-role leakage audit,
      end-to-end regression, completion report.

## Standing guardrails

- No accounting engine or sample fixture change.
- Service-role imports server-only; routine CRUD caller-scoped through RLS.
- SECURITY DEFINER functions: fixed search_path, execute revoked from
  public/anon/authenticated, granted to service_role only.
- Samples never autosave. Browser-supplied engine outputs are never authoritative.
- `supabase/migrations/` is the reproducible source of truth.
- Phase 8 (documents/storage) not implemented.
