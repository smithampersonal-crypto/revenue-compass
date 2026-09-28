/**
 * Package 3D-T — the one place a request's temporary-analysis credential is
 * resolved. Server-only (`.server` name).
 *
 * The cookie holds the session credential. The targeted analysis comes from an
 * explicit input when the call has one, otherwise from the
 * `x-arc-guest-analysis` header; either way it is only a resource target and
 * the returned credential exists only when the cookie session owns it.
 */

import { GUEST_ANALYSIS_HEADER, readGuestCookie } from "./guest";
import { resolveAnalysisToken } from "./guest-session.handlers";

export function isSecureRequest(url: string, forwardedProto: string | null): boolean {
  if (forwardedProto) return forwardedProto.split(",")[0]!.trim() === "https";
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

export interface GuestRequestContext {
  secure: boolean;
  /** Raw session credential from the HttpOnly cookie. Never returned to the browser. */
  sessionToken: string | null;
  /** Analysis id named by the request header, unvalidated. */
  headerAnalysisId: string | null;
}

export async function readGuestRequestContext(): Promise<GuestRequestContext> {
  const { getRequest } = await import("@tanstack/react-start/server");
  const request = getRequest();
  const secure = isSecureRequest(request.url, request.headers.get("x-forwarded-proto"));
  return {
    secure,
    sessionToken: readGuestCookie(request.headers.get("cookie"), secure),
    headerAnalysisId: request.headers.get(GUEST_ANALYSIS_HEADER),
  };
}

/** The derived credential for the targeted analysis, or null (fail closed). */
export async function resolveRequestAnalysisToken(
  explicitAnalysisId?: string | null,
): Promise<{ secure: boolean; token: string | null }> {
  const context = await readGuestRequestContext();
  const analysisId = explicitAnalysisId ?? context.headerAnalysisId;
  if (!context.sessionToken || !analysisId) return { secure: context.secure, token: null };
  const { createGuestSessionStore } = await import("./guest-session.store.server");
  const token = await resolveAnalysisToken(
    { store: await createGuestSessionStore(), now: () => new Date() },
    { sessionToken: context.sessionToken, analysisId },
  );
  return { secure: context.secure, token };
}
