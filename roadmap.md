# ARC Roadmap

## Phase 7 — Identity + Core Persistence Foundation

- [x] 7A Foundation: enums, tables, constraints, grants, RLS, trusted SECURITY DEFINER
      functions, generated types, database/security tests. draft → finalized →
      superseded lifecycle with `analyses.current_finalized_revision_id`.
- [x] 7A acceptance patch: least-privilege column grants on contracts/analyses/
      analysis_revisions, INSERT+UPDATE validation in the revision trigger, frozen
      ownership parents, pointer/supersession lineage triggers, lifecycle-shape check
      constraints, analyses row lock in finalization, adversarial privilege tests
      (`supabase/tests/phase7_privileges.sql`), service-role leakage test.
      **Awaiting review — do not start 7B until reviewed.**
- [x] 7B Identity: `/auth` sign-in (Google + email magic link), `/auth/callback`,
      server-built callback URLs with ARC-local redirect validation, verified-identity
      server function, `_authenticated` gate, `/workspace` + `/account`, session-aware
      header/account menu, bearer function middleware, dedicated duplicate-revision
      constraint test. Google broker NOT used: this project is an external
      (user-managed) Supabase backend, so ARC uses direct Supabase Google OAuth.
      **Awaiting review — do not start 7C.** Open item for the project owner: enable the
      Google provider + redirect URLs in the Supabase dashboard, then run a live
      Google/magic-link round trip.
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
