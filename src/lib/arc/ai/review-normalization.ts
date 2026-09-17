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

  // A resolution is honoured only when it is bound to this exact review
  // fingerprint and is valid for this row's severity.
  const resolution =
    candidate !== null &&
    candidate.reviewFingerprint === reviewFingerprint &&
    resolutionAllowedForState(persistedState, candidate)
      ? candidate
      : null;

  // Fail closed: a row persisted as resolved without valid resolution metadata
  // reopens at the most conservative severity rather than looking approved.
  const state: AiReviewItemState =
    persistedState === "resolved" && resolution === null ? "red" : persistedState;

  return {
    id: row["id"],
    targetKey: row["targetKey"],
    section: row["section"],
    state,
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

/** Reads persisted review JSON of any ARC vintage into Phase 9G review items. */
export function normalizePersistedReviewItems(raw: unknown): AiReviewItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const parsed = parseLegacyOrCurrentReviewItem(entry);
    return parsed === null ? [] : [parsed];
  });
}
