import { DEFAULT_SIGNED_IN_PATH, sanitizeLocalPath } from "@/lib/arc/redirect";

/**
 * The magic-link callback URL with every auth credential (code, tokens,
 * provider error material) removed. Only the sanitized ARC-local destination
 * is retained, and only when it differs from the default, so any re-execution
 * of the callback lifecycle still resolves the same safe destination.
 */
export function cleanedCallbackUrl(destination: unknown): string {
  const safe = sanitizeLocalPath(destination, DEFAULT_SIGNED_IN_PATH);
  return safe === DEFAULT_SIGNED_IN_PATH
    ? "/auth/callback"
    : `/auth/callback?next=${encodeURIComponent(safe)}`;
}
