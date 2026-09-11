#!/usr/bin/env bash
# Proves the SQL gate works: a deliberately false assertion must make the
# runner exit non-zero. This script SUCCEEDS only when psql FAILS.
set -uo pipefail

DB_URL="${ARC_DB_URL:-}"
if [ -z "$DB_URL" ]; then
  DB_URL="$(bunx --bun supabase status -o env | grep '^DB_URL=' | cut -d= -f2- | tr -d '"')"
fi

if psql "$DB_URL" -v ON_ERROR_STOP=1 -f scripts/gate-proof.sql >/dev/null 2>&1; then
  echo "gate-proof — FAILED: a false assertion did not fail the runner." >&2
  exit 1
fi
echo "gate-proof — a false assertion correctly fails the SQL runner."
