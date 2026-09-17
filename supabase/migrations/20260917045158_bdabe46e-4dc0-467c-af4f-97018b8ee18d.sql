-- ARC Phase 9G — Task 2 follow-up. Narrow the review audit table privileges.
--
-- The hosted Supabase project applies schema-wide default privileges that grant
-- `service_role` every table privilege on newly created public tables. The
-- Task 2 migration revoked `public`, `anon` and `authenticated`, but it left
-- those inherited `service_role` defaults in place, so the audit table ended up
-- with TRUNCATE, REFERENCES, TRIGGER and MAINTAIN in addition to the intended
-- SELECT and INSERT.
--
-- TRUNCATE is the material defect: PostgreSQL does not fire row-level DELETE
-- triggers for TRUNCATE, so the Task 2 append-only trigger cannot stop it and
-- the entire review audit trail could be erased in one statement.
--
-- This migration states the intended capability of the Task 2 audit table
-- explicitly and completely. It is deliberately scoped to that one table: no
-- project-wide ALTER DEFAULT PRIVILEGES change is made here.

revoke all privileges
  on table public.ai_review_events
  from public, anon, authenticated, service_role;

grant select, insert
  on table public.ai_review_events
  to service_role;

comment on table public.ai_review_events is
  'Append-only review audit history. Readable and insertable by the service '
  'role only: no update, no delete, and no truncate, so the trail cannot be '
  'rewritten or erased. Browser roles hold no privilege of any kind.';
