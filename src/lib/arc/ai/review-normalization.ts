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
 * Pure: no database, React, network, clock or randomness.
 */

import type { GuidanceReviewSection } from "@/lib/arc/guidance/types";

import { canonicalJson, stableHash } from "./identity";
import type {
  AiAffirmationMethod,
  AiReviewCitationRef,
  AiReviewItem,
  AiReviewReasonCode,
  AiReviewResolution,
} from "./review-state";

const AFFIRMATION_METHODS = ["individual", "page_all", "global_all", "edited"];
const MANUAL_RED_REASONS = [
  "reviewed_current_treatment",
  "outside_source_information",
  "not_applicable",
];

function isAiReviewResolution(value: unknown): value is AiReviewResolution {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  if (row["kind"] === "affirmed") {
    return (
      typeof row["at"] === "string" &&
      typeof row["reviewFingerprint"] === "string" &&
      AFFIRMATION_METHODS.includes(String(row["method"]))
    );
  }
  if (row["kind"] === "manual_red") {
    return (
      typeof row["at"] === "string" &&
      typeof row["reviewFingerprint"] === "string" &&
      MANUAL_RED_REASONS.includes(String(row["reason"])) &&
      (row["note"] === null || typeof row["note"] === "string")
    );
  }
  return false;
}

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
  const state = row["state"];
  if (state !== "yellow" && state !== "red" && state !== "resolved") return null;
  if (typeof row["reason"] !== "string" || typeof row["section"] !== "string") return null;

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
  const currentFingerprint =
    typeof row["reviewFingerprint"] === "string" ? row["reviewFingerprint"] : legacyFingerprint;

  const affirmedAt = typeof row["affirmedAt"] === "string" ? row["affirmedAt"] : null;
  const affirmedMethod =
    typeof row["affirmedMethod"] === "string" && AFFIRMATION_METHODS.includes(row["affirmedMethod"])
      ? (row["affirmedMethod"] as AiAffirmationMethod)
      : null;

  const legacyResolution: AiReviewResolution | null =
    state === "resolved" && affirmedAt !== null && affirmedMethod !== null
      ? {
          kind: "affirmed",
          at: affirmedAt,
          method: affirmedMethod,
          reviewFingerprint: legacyFingerprint,
        }
      : null;

  return {
    id: row["id"],
    targetKey: row["targetKey"],
    section: row["section"] as GuidanceReviewSection,
    state,
    reasonCode: (typeof row["reasonCode"] === "string"
      ? row["reasonCode"]
      : "accountant_affirmation_required") as AiReviewReasonCode,
    reason: row["reason"],
    guidanceIds,
    citations: parseCitations(row["citations"]),
    valueFingerprint: typeof row["valueFingerprint"] === "string" ? row["valueFingerprint"] : "",
    reviewFingerprint: currentFingerprint,
    resolution: isAiReviewResolution(row["resolution"]) ? row["resolution"] : legacyResolution,
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
