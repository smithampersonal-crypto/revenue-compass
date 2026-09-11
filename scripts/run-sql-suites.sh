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

for suite in supabase/tests/*.sql; do
  echo "== $suite"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$suite"
done

echo "db:test — all SQL suites passed."
