-- ARC Phase 8F — reproducible production schedule (database half).
--
-- Apply once per environment in the Supabase SQL editor, with pg_cron enabled
-- (Database -> Extensions -> pg_cron). Re-running is safe: the job name is
-- unscheduled first.
--
-- Cadence: hourly. Upload intents live one hour and temporary workspaces nine
-- hours, so an hourly sweep bounds leftover state to at most ~1 extra hour
-- while keeping recurring database cost negligible. A missed run is harmless:
-- authorization never depends on cleanup having run, and every operation is
-- idempotent.
--
-- This covers abandoned uploads and nine-hour guest expiry, both of which are
-- pure SQL. The private Storage objects themselves are removed by the
-- application worker behind POST /api/public/maintenance (see
-- .github/workflows/maintenance.yml and docs/operations.md), because deleting
-- an object requires the Storage API rather than SQL.

select cron.unschedule('arc-hourly-maintenance')
 where exists (select 1 from cron.job where jobname = 'arc-hourly-maintenance');

select cron.schedule(
  'arc-hourly-maintenance',
  '7 * * * *',
  $$select public.arc_run_maintenance(200);$$
);
