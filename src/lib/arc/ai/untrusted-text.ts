/**
 * Phase 9D acceptance patch — one shared sanitizer for every untrusted label.
 *
 * User-controlled strings (display names, original filenames) appear in two
 * places in a request: the trust-tier instructions (`prompt.ts`) and the ARC
 * source metadata block that precedes each attached PDF
 * (`request-package.server.ts`). Both use THIS function, so the two paths can
 * never drift apart.
 *
 * The sanitizer does not attempt to make prompt wording a security boundary. It
 * removes exactly one capability: the ability of a user-controlled string to
 * forge structure — a control character, a line break or a heading that looks
 * like one of ARC's trusted regions. The words themselves survive, inside the
 * region ARC already labelled untrusted.
 *
 * Browser-safe: no SDK, no secrets, no environment access.
 */

/** Any heading a crafted label could use to open a fake trusted region. */
export const TRUSTED_MARKER_PATTERN =
  /(SECTION\s*\d+\s*[—-]\s*(TRUSTED|AUTHENTICATED|UNTRUSTED|TASK)[^\n]*)|(ARC[\s-]*VERIFIED\s+IDENTITY[^\n]*)|(USER[\s-]*SUPPLIED\s+LABELS[^\n]*)|(TRUSTED\s+ARC\s+(POLICY|GUIDANCE)[^\n]*)/gi;

export const UNTRUSTED_LABEL_MAX_LENGTH = 400;

export const REDACTED_MARKER = "[redacted-section-marker]";

/**
 * Neutralises a user-controlled label for inclusion in an untrusted region:
 * control characters (line breaks included) become spaces, any trusted-region
 * heading is redacted, quotes that could close ARC's own quoting are escaped,
 * and the result is length-bounded.
 */
export function sanitizeUntrustedLabel(
  value: string,
  maxLength: number = UNTRUSTED_LABEL_MAX_LENGTH,
): string {
  return (
    value
      // Deliberate: control characters are stripped so untrusted text cannot
      // forge section structure inside the request.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(TRUSTED_MARKER_PATTERN, REDACTED_MARKER)
      .replace(/"/g, "'")
      .slice(0, maxLength)
  );
}

/** Same neutralisation for an already-serialized trusted JSON block. */
export function redactTrustedMarkers(value: string): string {
  return value.replace(TRUSTED_MARKER_PATTERN, REDACTED_MARKER);
}
