#!/usr/bin/env bash
# Server-only leakage audit for built client assets.
# Fails if a service-role key, its env name, the admin client, the ARC
# maintenance secret, a trusted maintenance RPC name, a server-only store
# module or the server-only PDF parser leaks into a browser bundle or map.
# Never prints a secret value.
set -euo pipefail

DIR="${1:-}"
if [ -z "$DIR" ]; then
  # Vite/Nitro have emitted client assets to either location across versions.
  for candidate in .output/public dist/client dist; do
    if [ -d "$candidate" ]; then DIR="$candidate"; break; fi
  done
fi
if [ -z "$DIR" ] || [ ! -d "$DIR" ]; then
  echo "audit:bundle — no build output found; run 'bun run build' first." >&2
  exit 1
fi

CLIENT_DIRS=$(find "$DIR" -type d -name "_build" -o -type d -name "client" | head -5)
TARGETS="${CLIENT_DIRS:-$DIR}"

# Real secret material only: an actual sb_secret_ value, a service_role JWT
# payload, the server-only env name, or the admin client module. Library code
# that merely tests for the "sb_secret_" prefix is not a leak.
FOUND=0
for pattern in 'SUPABASE_SERVICE_ROLE_KEY' 'sb_secret_[A-Za-z0-9_-]{8,}' '"role" *: *"service_role"' 'cm9sZSI6InNlcnZpY2Vfcm9sZ' 'supabaseAdmin' 'client\.server' 'pdfjs-dist' 'GlobalWorkerOptions' 'getDocument\(\{ *data' 'validation\.server' 'pdf-parser\.server' 'ARC_MAINTENANCE_SECRET' 'arc_run_maintenance' 'arc_claim_storage_deletion_jobs' 'store\.server' 'caller\.server' 'maintenance\.server' 'runs\.store\.server' 'arc_create_ai_run' 'arc_reserve_ai_allowance' 'arc_mark_ai_run_failure' 'arc_affirm_ai_review_item' 'arc_resolve_ai_review_issue' 'arc_acknowledge_ai_stale_sources' 'arc_ai_source_set_fingerprint' 'OPENAI_API_KEY' 'openai\.server' 'evidence\.server' 'request-package\.server' 'terra\.server' 'responses\.create' 'phase9d-smoke' 'authorized-sources\.server' 'data:application/pdf;base64' 'exceljs' 'Revenue_Compass_ASC606_Master_Library'; do
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
