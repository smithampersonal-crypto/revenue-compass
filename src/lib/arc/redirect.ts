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
