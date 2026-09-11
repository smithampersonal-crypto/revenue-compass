#!/usr/bin/env bash
# Proves the SQL gate works. Two deliberate suites must each fail, and each
# must fail for the ARC assertion-gate reason — not because the database is
# unreachable, psql is missing, or the SQL is malformed.
#
# Setup problems fail normally (non-zero); only a genuine, correctly-attributed
# gate failure lets this script succeed.
set -euo pipefail

command -v psql >/dev/null 2>&1 || {
  echo "gate-proof — FAILED: psql is not installed." >&2
  exit 1
}

DB_URL="${ARC_DB_URL:-}"
if [ -z "$DB_URL" ]; then
  # Project-pinned CLI, not a global executable. A discovery failure is fatal.
  DB_URL="$(bunx --bun supabase status -o env | grep '^DB_URL=' | cut -d= -f2- | tr -d '"')"
fi
if [ -z "$DB_URL" ]; then
  echo "gate-proof — FAILED: no database URL could be discovered." >&2
  exit 1
fi

# The database must actually answer before any proof means anything.
psql "$DB_URL" -v ON_ERROR_STOP=1 -c 'select 1' >/dev/null

expect_gate_failure() {
  local file="$1" label="$2" output status
  set +e
  output="$(psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$file" 2>&1)"
  status=$?
  set -e

  if [ "$status" -eq 0 ]; then
    echo "gate-proof — FAILED: $label did not fail the runner." >&2
    exit 1
  fi
  if ! printf '%s' "$output" | grep -q 'ARC SQL suite failed'; then
    echo "gate-proof — FAILED: $label failed for an unexpected reason:" >&2
    printf '%s\n' "$output" >&2
    exit 1
  fi
  echo "gate-proof — $label correctly fails the SQL runner."
}

expect_gate_failure scripts/gate-proof.sql "a deliberately false assertion"
expect_gate_failure scripts/gate-proof-null.sql "an unknown (NULL) assertion"
echo "gate-proof — the assertion gate fails closed on both false and unknown results."
