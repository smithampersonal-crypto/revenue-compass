/**
 * Phase 8F — the single scheduled ARC maintenance entrypoint.
 *
 * POST /api/public/maintenance with `Authorization: Bearer <ARC_MAINTENANCE_SECRET>`.
 *
 * The `/api/public/` prefix only bypasses site auth; the caller is verified
 * here with a constant-time comparison against a server-side secret. Without
 * the secret configured the endpoint is closed, never open.
 *
 * The response carries counts only — never document text, object paths,
 * signed URLs, tokens or guest credentials.
 */

import { createFileRoute } from "@tanstack/react-router";

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

function presentedSecret(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  if (header.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  return request.headers.get("x-arc-maintenance-secret")?.trim() ?? "";
}

async function handle(request: Request): Promise<Response> {
  const expected = process.env["ARC_MAINTENANCE_SECRET"] ?? "";
  if (expected.length < 16 || !constantTimeEquals(presentedSecret(request), expected)) {
    return new Response("Unauthorized", { status: 401, headers: { "cache-control": "no-store" } });
  }

  const { createMaintenanceDeps } = await import("@/lib/arc/maintenance/maintenance.server");
  const { runMaintenance } = await import("@/lib/arc/maintenance/maintenance.handlers");

  const report = await runMaintenance(createMaintenanceDeps());
  return new Response(JSON.stringify({ ok: true, ...report }), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export const Route = createFileRoute("/api/public/maintenance")({
  server: {
    handlers: {
      POST: ({ request }) => handle(request),
      GET: ({ request }) => handle(request),
    },
  },
});
