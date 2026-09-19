#!/usr/bin/env bash
# Runs every Phase 7 SQL suite against a local Supabase database.
# Usage: bun run db:test   (requires `bun run db:start`, or set ARC_DB_URL)
#
# Each suite raises an exception when any assertion is false, so a failing
# assertion makes psql exit non-zero and fails this script and CI.
set -euo pipefail

DB_URL="${ARC_DB_URL:-}"
if [ -z "$DB_URL" ]; then
  # Project-pinned CLI, not a global executable.
  DB_URL="$(bunx --bun supabase status -o env | grep '^DB_URL=' | cut -d= -f2- | tr -d '"')"
fi

# Staged migrations awaiting independent review are NOT part of the applied
# migration history, so the disposable CI database must apply them explicitly
# before the suites that prove them run. They are applied in filename order,
# exactly as they would be once accepted.
shopt -s nullglob
for staged in supabase/pending/*.sql; do
  echo "== staged $staged"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$staged"
done
shopt -u nullglob

for suite in supabase/tests/*.sql; do
  echo "== $suite"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$suite"
done

echo "db:test — all SQL suites passed."
