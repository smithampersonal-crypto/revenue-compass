# ARC Phase 7 — Identity + Core Persistence Foundation

Implements the uploaded Phase 7 plan: Supabase sign-in, saved customers/contracts, autosaved drafts, immutable finalized revisions with history, guest workspaces that expire, explicit "Save this analysis" migration, and account deletion — with no change to the approved ASC 606 engines.

## Deviations from the uploaded document (platform requirements)

The document's file layout assumes a plain Supabase/TanStack setup. Three adjustments are required here, with identical behavior:

- Reuse the existing `src/integrations/supabase/*` clients (browser client, `client.server.ts` service-role client, `auth-middleware.ts` caller-scoped client) instead of creating `src/lib/supabase/server.ts` / `admin.server.ts`. Generated types stay in `src/integrations/supabase/types.ts`.
- Server functions live in client-safe module paths (`src/lib/arc/persistence/*.functions.ts`), not `src/server/`, which is blocked from client bundles. Service-role imports happen inside handlers via `await import(...)`.
- ARC recruiter-ready v1 uses Supabase email magic-link authentication only. No passwords and no social/OAuth login. Google/social login is deferred to future scope.
- Migrations are applied through the migration tool (source-controlled under `supabase/migrations/`); the dashboard is never the schema source.

Everything else — constraints, RLS, transactional functions, 9-hour guest expiry, one-canonical-renderer rule, samples never autosaving — is implemented as written.

## What gets built

**Data model (migrations, RLS on every table, grants):**
`customers`, `contracts`, `analyses`, `analysis_revisions` (draft | finalized, one active draft, at most one current finalized), `guest_workspaces` (opaque HttpOnly credential, `expires_at = created_at + 9h`, unauthorized on read after expiry). Owner-scoped policies via `auth.uid()`; guest rows reachable only server-side by cookie proof.

**Trusted transactions (SQL functions, service-role only):** finalize revision, guest → account migration (all-or-nothing; failure leaves the guest workspace authoritative), account deletion cascade.

**Server functions:** auth/session, workspace (customer/contract CRUD, caller-scoped so RLS is exercised), guest workspace create/load/autosave, revision load/save/finalize/history, account deletion.

**Finalization:** pure snapshot builder reruns the existing deterministic engines from the authoritative `WorkflowDraft` and stores canonical inputs + outputs with `ARC_WORKFLOW_SCHEMA_VERSION` / `ARC_ENGINE_VERSION`. The engine's existing `analyzeWorkflow(...).finalized` field is untouched and stays conceptually separate from `analysis_revisions.status`.

**UI:** sign-in page and callback route, account menu in the header, workspace dashboard with customer/contract creation, save-status indicator, revision history and finalize panel inside Review & Finalize, guest "Save this analysis" dialog, account settings/deletion. `/analysis` remains the single renderer; the backing store is selected by URL:

```text
/analysis?sample=redwood   fixture, ephemeral, never autosaved
/analysis                  9-hour guest workspace, server-side autosave
/analysis?contract=<uuid>  owned contract: active draft, else current finalized
/analysis?contract=<uuid>&revision=<uuid>  exact owned revision (read-only when finalized)
```

## Sequence (review gate after each stage)

1. **7A — Foundation:** schema, constraints, RLS, grants, trusted SQL functions, generated types, security tests.
2. **7B — Identity:** auth server functions, sign-in/callback routes, account menu, protected route placement.
3. **7C — Persistence in the workspace:** DTOs/Zod schemas, workspace + revision server functions, `AnalysisProvider` extension for load/autosave/lock-version conflict handling, save status.
4. **7D — Lifecycle:** finalization snapshot builder, Review & Finalize lifecycle, revision history.
5. **7E — Guest:** 9-hour guest workspace, guest autosave, explicit atomic migration.
6. **7F — Hardening + acceptance:** account deletion, service-role audit, end-to-end regression, browser review, completion report.

## Verification each stage

`bun run test`, `bunx tsc --noEmit`, `bun run build`, `bun run lint`, `bunx prettier --check .` (three pre-existing Markdown failures remain the baseline), plus browser review of sign-in, save, finalize, history, and guest migration. All Phase 1–6 tests stay green and unweakened; no file under `src/lib/asc606*` changes.

## Out of scope

PDF/source-document processing and Storage, Guidance Library, case-study overhaul, AI features, passwords, and any accounting-engine change. Phase 8 hooks (`documents`, `contract_documents`, `analysis_revision_sources`) are left addable without reopening finalized snapshots.
