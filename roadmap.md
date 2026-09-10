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
      Accepted.
- [x] 7B Identity: `/auth` sign-in (email magic link only — no passwords, no social
      login), `/auth/callback`, server-built callback URLs with ARC-local redirect
      validation (`ARC_SITE_URL` sets the deployed origin), verified-identity server
      function, `_authenticated` gate, `/workspace` + `/account`, session-aware
      header/account menu, bearer function middleware, root auth-state cache isolation
      (SIGNED_OUT and A→B identity change purge private cached data), dedicated
      duplicate-revision constraint test. Guest/sample use stays available without
      signing in. Google/social login is a future enhancement, not recruiter-ready v1.
      **Accepted**, including the live magic-link round trip. Custom SMTP remains
      deferred to 7F.
- [x] 7C Persistence in the workspace: canonical persistence envelope
      (`arc.workflow.v1`) with Zod validation, caller-scoped workspace server
      functions (list/create customer, contract, analysis, seed draft revision),
      revision load + optimistic-lock autosave (`lock_version`), save-status
      indicator, read-only finalized/superseded revisions, `/workspace` customer
      and contract management. Samples never autosave; engine output is never
      persisted from the browser. Acceptance patch applied: queued autosave for
      edits made during an in-flight save, editing blocked while loading /
      after a failed load, read-only enforcement at `setDraft`, `resetAnalysis`
      and every input control, distinct save-failure (retry) vs conflict
      (reload) recovery, atomic contract creation through a SECURITY INVOKER
      transaction, runtime draft validation and strict schema-version equality,
      ambiguous `?sample=` + `?contract=` normalization, and source-controlled
      persistence + database regressions. **Awaiting review — do not start 7D.**

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
