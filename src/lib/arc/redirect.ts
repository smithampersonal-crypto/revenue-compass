/**
 * Redirect safety for authentication flows.
 *
 * Any "return here after sign in" value that reaches the browser is untrusted.
 * ARC only ever navigates to an application-local path; absolute URLs,
 * protocol-relative URLs and scheme payloads are discarded in favour of a
 * known-safe fallback. Callback URLs themselves are assembled on the server
 * from ARC configuration — the browser never supplies a full callback URL.
 */

/** Where a signed-in visitor lands when no safe destination was supplied. */
export const DEFAULT_SIGNED_IN_PATH = "/workspace";

// eslint-disable-next-line no-control-regex -- control characters are exactly what we reject
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const LEADING_SCHEME = /^\/?[a-z][a-z0-9+.-]*:/i;

/**
 * Returns `value` when it is a safe ARC-local path (e.g. `/analysis`,
 * `/analysis?contract=<uuid>`), otherwise returns `fallback`.
 */
export function sanitizeLocalPath(value: unknown, fallback = DEFAULT_SIGNED_IN_PATH): string {
  if (typeof value !== "string") return fallback;

  const candidate = value.trim();
  if (candidate.length === 0) return fallback;
  if (CONTROL_CHARACTERS.test(candidate)) return fallback;
  if (!candidate.startsWith("/")) return fallback;
  // Protocol-relative ("//evil.example") and backslash-smuggled variants.
  if (candidate.startsWith("//") || candidate.includes("\\")) return fallback;
  // "/javascript:alert(1)" style payloads.
  if (LEADING_SCHEME.test(candidate.slice(1))) return fallback;

  return candidate;
}

const ANALYSIS_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Where "Continue without signing in" goes when there is no safe analysis to return to. */
export const CONTINUE_WITHOUT_SIGN_IN_FALLBACK = "/recent";

/**
 * Package 3D-T: "Continue without signing in" returns to the analysis the
 * visitor came from only when `next` is a safe ARC-local `/analysis…?a=<uuid>`
 * path (same validator as the sign-in return). Anything else goes to Recent
 * Analyses. The analysis page still checks session ownership independently.
 */
export function continueWithoutSignInPath(next: unknown): string {
  const safe = sanitizeLocalPath(next, "");
  if (safe === "") return CONTINUE_WITHOUT_SIGN_IN_FALLBACK;
  let url: URL;
  try {
    url = new URL(safe, "https://arc.invalid");
  } catch {
    return CONTINUE_WITHOUT_SIGN_IN_FALLBACK;
  }
  if (url.origin !== "https://arc.invalid") return CONTINUE_WITHOUT_SIGN_IN_FALLBACK;
  const path = url.pathname.replace(/\/$/, "");
  if (path !== "/analysis" && !path.startsWith("/analysis/")) {
    return CONTINUE_WITHOUT_SIGN_IN_FALLBACK;
  }
  if (path === "/analysis/new") return CONTINUE_WITHOUT_SIGN_IN_FALLBACK;
  const id = url.searchParams.get("a");
  if (!id || !ANALYSIS_ID.test(id)) return CONTINUE_WITHOUT_SIGN_IN_FALLBACK;
  return `${url.pathname}${url.search}`;
}
