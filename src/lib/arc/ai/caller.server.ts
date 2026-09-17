/**
 * Phase 9G — Task 3. The one caller-resolution implementation.
 *
 * Extracted verbatim from the Phase 9C run surface so the run API and the new
 * workspace API cannot drift into two subtly different authentication rules.
 * Behaviour is unchanged: the session bearer token is verified when present
 * and never upgrades an anonymous visitor, the temporary-workspace credential
 * is read from the HttpOnly cookie and hashed here, and the requested revision
 * is only a resource target whose ownership is re-proved by `deriveAiCaller`.
 *
 * Server-only: blocked from client bundles by its `.server` name.
 */

import { hashGuestToken, readGuestCookie } from "@/lib/arc/persistence/guest";

import {
  deriveAiCaller,
  type AiCallerRequest,
  type AiCallerScope,
  type AiRunStore,
} from "./runs.handlers";

/** True on https; local http development falls back to a non-`__Host-` name. */
function isSecureRequest(url: string, forwardedProto: string | null): boolean {
  if (forwardedProto) return forwardedProto.split(",")[0]!.trim() === "https";
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Optional session identity.
 *
 * An AI run can be started from a saved analysis (session required) or from a
 * temporary workspace (session optional), so the bearer token is verified when
 * present instead of being required by middleware. An absent or invalid token
 * simply yields an anonymous caller; it never upgrades one.
 */
export async function verifiedUserId(request: Request): Promise<string | null> {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (token.split(".").length !== 3) return null;

  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) return null;

  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(url, key, {
    global: {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) {
          headers.delete("Authorization");
        }
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
    },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getClaims(token);
  if (error || !data?.claims?.sub) return null;
  return data.claims.sub;
}

/**
 * The verified session subject of the current request, or null when the
 * visitor is anonymous. Used for actor attribution inside a temporary
 * workspace, where ownership stays credential-bound but the audit trail must
 * still name a signed-in accountant.
 */
export async function readOptionalSessionUserId(): Promise<string | null> {
  const { getRequest } = await import("@tanstack/react-start/server");
  return verifiedUserId(getRequest());
}

/**
 * Builds the caller from server-held evidence only: the verified session
 * subject and the hash of the HttpOnly credential. `requestedRevisionId` is a
 * resource target, and ownership of it is proven inside `deriveAiCaller`.
 */
export async function resolveAiCallerFromRequest(
  store: AiRunStore,
  requestedRevisionId: string | null,
): Promise<AiCallerScope> {
  const { getRequest } = await import("@tanstack/react-start/server");
  const request = getRequest();
  const secure = isSecureRequest(request.url, request.headers.get("x-forwarded-proto"));
  const rawToken = readGuestCookie(request.headers.get("cookie"), secure);

  const identity: AiCallerRequest = {
    authenticatedUserId: await verifiedUserId(request),
    guestTokenHash: rawToken ? await hashGuestToken(rawToken) : null,
    requestedRevisionId,
  };
  return deriveAiCaller(store, identity);
}
