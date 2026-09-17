/**
 * Phase 9G — backward-compatible normalization of persisted review JSON.
 *
 * Phase 9F rows were written before review items carried a reason code,
 * citation material, a material review fingerprint or a typed resolution.
 * They must stay readable, but a legacy row must never be able to pass itself
 * off as a Phase 9G-verified approval: its fingerprint is deliberately built
 * in a separate namespace, so the first Phase 9G re-analysis reopens it rather
 * than silently carrying an approval that was given without evidence context.
 *
 * This is a trust boundary. Persisted JSON is data, never a typed value: every
 * enum-like field is validated, and a resolved row survives as resolved only
 * when its own resolution metadata validates, is bound to that row's review
 * fingerprint and is of a kind that row's severity may carry. Anything else
 * reopens conservatively rather than presenting unverified approval.
 *
 * Pure: no database, React, network, clock or randomness.
 */

import { canonicalJson, stableHash } from "./identity";
import {
  isAiAffirmationMethod,
  isAiReviewItemState,
  isAiReviewReasonCode,
  isAiReviewResolution,
  isAiReviewSection,
  isAiReviewSeverity,
  resolutionAllowedForSeverity,
  stateAgreesWithSeverity,
  type AiAffirmationMethod,
  type AiReviewCitationRef,
  type AiReviewItem,
  type AiReviewItemState,
  type AiReviewResolution,
  type AiReviewSeverity,
} from "./review-state";

function parseCitations(value: unknown): AiReviewCitationRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    if (typeof row["documentId"] !== "string") return [];
    if (!Number.isInteger(row["pageStart"]) || !Number.isInteger(row["pageEnd"])) return [];
    if (row["evidenceMode"] !== "text" && row["evidenceMode"] !== "visual") return [];
    const excerpt = row["excerpt"];
    return [
      {
        documentId: row["documentId"],
        pageStart: row["pageStart"] as number,
        pageEnd: row["pageEnd"] as number,
        evidenceMode: row["evidenceMode"],
        excerpt: typeof excerpt === "string" ? excerpt : null,
      },
    ];
  });
}

function parseLegacyOrCurrentReviewItem(entry: unknown): AiReviewItem | null {
  if (!entry || typeof entry !== "object") return null;
  const row = entry as Record<string, unknown>;
  if (typeof row["id"] !== "string" || typeof row["targetKey"] !== "string") return null;
  if (!isAiReviewItemState(row["state"])) return null;
  if (typeof row["reason"] !== "string") return null;
  // Unknown section or reason code: the row cannot be placed in the workflow
  // or reasoned about, so it is discarded rather than displayed as trusted.
  if (!isAiReviewSection(row["section"])) return null;
  const rawReasonCode = row["reasonCode"];
  if (rawReasonCode !== undefined && rawReasonCode !== null && !isAiReviewReasonCode(rawReasonCode))
    return null;
  const reasonCode = isAiReviewReasonCode(rawReasonCode)
    ? rawReasonCode
    : // Phase 9F rows predate reason codes entirely.
      "accountant_affirmation_required";

  const guidanceIds = Array.isArray(row["guidanceIds"])
    ? row["guidanceIds"].filter((id): id is number => Number.isInteger(id))
    : [];
  const legacyFingerprint = stableHash(
    canonicalJson({
      legacy: true,
      id: row["id"],
      targetKey: row["targetKey"],
      valueFingerprint: typeof row["valueFingerprint"] === "string" ? row["valueFingerprint"] : "",
      guidanceIds,
    }),
  );
  const reviewFingerprint =
    typeof row["reviewFingerprint"] === "string" ? row["reviewFingerprint"] : legacyFingerprint;

  const affirmedAt = typeof row["affirmedAt"] === "string" ? row["affirmedAt"] : null;
  const affirmedMethod = isAiAffirmationMethod(row["affirmedMethod"])
    ? (row["affirmedMethod"] as AiAffirmationMethod)
    : null;

  const persistedState = row["state"];
  const legacyResolution: AiReviewResolution | null =
    persistedState === "resolved" &&
    row["resolution"] === undefined &&
    affirmedAt !== null &&
    affirmedMethod !== null
      ? {
          kind: "affirmed",
          at: affirmedAt,
          method: affirmedMethod,
          reviewFingerprint: legacyFingerprint,
        }
      : null;

  const candidate: AiReviewResolution | null = isAiReviewResolution(row["resolution"])
    ? row["resolution"]
    : legacyResolution;

  // Base severity. A Phase 9G row must carry it explicitly; a Phase 9F row
  // predates it, so the conservative reading of its own persisted state is
  // used instead. It is never inferred from a reason code.
  const isCurrentRow = typeof row["reviewFingerprint"] === "string";
  const persistedSeverity = row["severity"];
  const severity: AiReviewSeverity = isCurrentRow
    ? // Missing or malformed severity on a current row fails closed: the row
      // becomes a red issue that carries no approval.
      isAiReviewSeverity(persistedSeverity)
      ? persistedSeverity
      : "red"
    : persistedState === "red"
      ? "red"
      : "yellow";
  const severityTrusted = isCurrentRow ? isAiReviewSeverity(persistedSeverity) : true;
  // An unresolved row whose visible state disagrees with its severity is
  // internally inconsistent and cannot be trusted as-is.
  const consistent = severityTrusted && stateAgreesWithSeverity(persistedState, severity);

  // A resolution is honoured only when it is bound to this exact review
  // fingerprint and is of a kind that this row's base severity may carry.
  const resolution =
    consistent &&
    // An unresolved row never keeps an active resolution, so it can never
    // hand one to the next analysis.
    persistedState === "resolved" &&
    candidate !== null &&
    candidate.reviewFingerprint === reviewFingerprint &&
    resolutionAllowedForSeverity(severity, candidate)
      ? candidate
      : null;

  // Fail closed: a row persisted as resolved without valid resolution metadata
  // reopens at its base severity rather than looking approved, and an
  // inconsistent row reopens at the most conservative severity.
  const state: AiReviewItemState = !consistent
    ? "red"
    : persistedState === "resolved" && resolution === null
      ? severity
      : persistedState;

  return {
    id: row["id"],
    targetKey: row["targetKey"],
    section: row["section"],
    state,
    severity: consistent ? severity : "red",
    reasonCode,
    reason: row["reason"],
    guidanceIds,
    citations: parseCitations(row["citations"]),
    valueFingerprint: typeof row["valueFingerprint"] === "string" ? row["valueFingerprint"] : "",
    reviewFingerprint,
    resolution,
    affirmedAt,
    affirmedMethod,
  };
}

export interface PersistedReviewPayload {
  /** Every row that could be read and trusted. */
  items: AiReviewItem[];
  /**
   * True when the payload itself was not an array, or when any entry had to be
   * discarded. Dropping a row is safe for carry-forward — it can never inherit
   * an approval — but it is NOT safe for finalization: a malformed sidecar is
   * not the same thing as no sidecar, so that boundary must block on it.
   */
  malformed: boolean;
}

/** Reads persisted review JSON of any ARC vintage, reporting what it could not read. */
export function normalizePersistedReviewPayload(raw: unknown): PersistedReviewPayload {
  if (!Array.isArray(raw)) return { items: [], malformed: true };
  let malformed = false;
  const items = raw.flatMap((entry) => {
    const parsed = parseLegacyOrCurrentReviewItem(entry);
    if (parsed === null) {
      malformed = true;
      return [];
    }
    return [parsed];
  });
  return { items, malformed };
}

/** Reads persisted review JSON of any ARC vintage into Phase 9G review items. */
export function normalizePersistedReviewItems(raw: unknown): AiReviewItem[] {
  return normalizePersistedReviewPayload(raw).items;
}
