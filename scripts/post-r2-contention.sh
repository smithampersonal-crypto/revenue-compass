#!/usr/bin/env bash
# ARC Post-R2 live regression patch — autosave lock bounding (defect 4),
# concurrency driver.
#
# Real contention needs two genuinely concurrent PostgreSQL sessions. It used
# to be orchestrated with dblink from inside the server, which cannot work
# against local Supabase or CI: dblink dials out from inside the database
# container, where the host-facing URL of the disposable database is not a
# reachable endpoint. The orchestration therefore lives here, in the runner,
# using two independent host-side psql sessions against the same disposable
# database URL the suite runner already resolved.
#
# No credential is hardcoded and the database URL is never printed.
#
# Usage: bash scripts/post-r2-contention.sh "<disposable db url>"
set -euo pipefail

DB_URL="${1:-${ARC_DB_URL:-}}"
if [ -z "$DB_URL" ]; then
  echo "post-r2-contention: no disposable database URL supplied" >&2
  exit 1
fi

HERE="supabase/tests/concurrency"
TMP="$(mktemp -d)"
FIFO="$TMP/holder.in"
HOLDER_PID=""

cleanup() {
  local status=$?
  # A failed assertion must never leave a background session or an open
  # transaction holding the owner row.
  if [ -n "$HOLDER_PID" ] && kill -0 "$HOLDER_PID" 2>/dev/null; then
    kill "$HOLDER_PID" 2>/dev/null || true
    wait "$HOLDER_PID" 2>/dev/null || true
  fi
  exec 3>&- 2>/dev/null || true
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$HERE/post_r2_contention_teardown.sql" >/dev/null 2>&1 || true
  rm -rf "$TMP"
  exit $status
}
trap cleanup EXIT

run() { psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$1"; }

# 1. Committed fixture the competing session must be able to see.
run "$HERE/post_r2_contention_teardown.sql"
run "$HERE/post_r2_contention_setup.sql"

# 2. Background holder session, fed over a FIFO so its lifetime is controlled
#    by this script rather than by a timer.
mkfifo "$FIFO"
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f - < "$FIFO" >/dev/null &
HOLDER_PID=$!
exec 3> "$FIFO"
printf 'begin;\nselect 1 from public.guest_workspaces where token_hash = repeat('"'"'b'"'"', 64) for update;\n' >&3

# 3. Deterministic ready signal: the owner row carries the holder's in-progress
#    transaction id. No sleep-and-hope.
ready=""
for _ in $(seq 1 100); do
  if [ "$(psql "$DB_URL" -At -c "select xmax <> 0 from public.guest_workspaces where token_hash = repeat('b', 64)")" = "t" ]; then
    ready="yes"; break
  fi
  sleep 0.1
done
if [ -z "$ready" ]; then
  echo "post-r2-contention: the competing session never acquired the owner row lock" >&2
  exit 1
fi

# 4. Contended save, in a separate foreground session.
run "$HERE/post_r2_contention_contended.sql"

# 5. Release the holder cleanly and wait for it to exit.
printf 'rollback;\n\\q\n' >&3
exec 3>&-
wait "$HOLDER_PID"
HOLDER_PID=""

# 6. The very same save must now succeed, exactly once.
run "$HERE/post_r2_contention_released.sql"

echo "== supabase/tests/concurrency (post_r2 contention driver)"
