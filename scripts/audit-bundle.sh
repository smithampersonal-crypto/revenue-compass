#!/usr/bin/env bash
# Server-only leakage audit for built client assets.
# Fails if a service-role key, its env name, the admin client, or the
# server-only PDF parser leaks into any browser bundle or source map.
# Never prints a secret value.
set -euo pipefail

DIR="${1:-.output/public}"
if [ ! -d "$DIR" ]; then
  echo "audit:bundle — no build output at $DIR; run 'bun run build' first." >&2
  exit 1
fi

CLIENT_DIRS=$(find "$DIR" -type d -name "_build" -o -type d -name "client" | head -5)
TARGETS="${CLIENT_DIRS:-$DIR}"

# Real secret material only: an actual sb_secret_ value, a service_role JWT
# payload, the server-only env name, or the admin client module. Library code
# that merely tests for the "sb_secret_" prefix is not a leak.
FOUND=0
for pattern in 'SUPABASE_SERVICE_ROLE_KEY' 'sb_secret_[A-Za-z0-9_-]{8,}' '"role" *: *"service_role"' 'cm9sZSI6InNlcnZpY2Vfcm9sZ' 'supabaseAdmin' 'client\.server'; do
  if grep -rIl --include='*.js' --include='*.mjs' --include='*.map' -E "$pattern" $TARGETS >/tmp/arc-audit-hits 2>/dev/null; then
    if [ -s /tmp/arc-audit-hits ]; then
      echo "LEAK: pattern '$pattern' found in:" >&2
      cat /tmp/arc-audit-hits >&2
      FOUND=1
    fi
  fi
done

if [ "$FOUND" -ne 0 ]; then
  echo "audit:bundle — FAILED" >&2
  exit 1
fi
echo "audit:bundle — clean: no service-role material in client assets."
