#!/usr/bin/env bash
# Developer fallback for environments without Docker (so `supabase start` is
# unavailable): boots a throwaway PostgreSQL instance, installs the minimal
# Supabase surface the ARC migrations rely on (roles, auth.users, storage),
# replays the whole migration history and then runs every SQL suite.
#
# Usage: bash scripts/run-sql-suites-local.sh [extra .sql to apply after the
#        migration history, e.g. a staged migration awaiting approval]
set -euo pipefail

DIR="${ARC_LOCAL_PG_DIR:-/tmp/arc-pg}"
PORT="${ARC_LOCAL_PG_PORT:-55432}"
PSQL=(psql -h "$DIR" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q)

if ! pg_isready -h "$DIR" -p "$PORT" >/dev/null 2>&1; then
  rm -rf "$DIR"; mkdir -p "$DIR"
  if [ "$(id -u)" = "0" ]; then
    chown -R 1000:1000 "$DIR"
    RUN=(setpriv --reuid=1000 --regid=1000 --clear-groups)
  else
    RUN=()
  fi
  "${RUN[@]}" initdb -D "$DIR/data" -U postgres >/dev/null
  "${RUN[@]}" pg_ctl -D "$DIR/data" -o "-p $PORT -k $DIR" -l "$DIR/pg.log" start
  until pg_isready -h "$DIR" -p "$PORT" >/dev/null 2>&1; do sleep 1; done
fi

"${PSQL[@]}" -c "drop database if exists arc;" -c "create database arc;"
PSQL+=(-d arc)
"${PSQL[@]}" -f scripts/sql-harness-bootstrap.sql
for migration in supabase/migrations/*.sql; do "${PSQL[@]}" -f "$migration"; done
for extra in "$@"; do echo "== staged $extra"; "${PSQL[@]}" -f "$extra"; done
for suite in supabase/tests/*.sql; do echo "== $suite"; "${PSQL[@]}" -f "$suite" >/dev/null; done

# Same runner-orchestrated contention driver as scripts/run-sql-suites.sh.
bash scripts/post-r2-contention.sh "postgresql://postgres@/arc?host=$DIR&port=$PORT"

echo "local SQL harness — all suites passed."
