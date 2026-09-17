/**
 * Phase 9E — Task 10E. Pure review-state derivation.
 *
 * The natural-language "Accountant Must Approve" prose on a Guidance Card is
 * prompt content, not executable policy. The executable policy is the explicit
 * machine policy (`reviewSection`, `engineSupport`, `finalizationImpact`)
 * combined with the validated AI review state and ARC's own knowledge of what
 * its deterministic engines can execute.
 *
 * Pure: no database, React, OpenAI, network, environment, clock or randomness.
 */

import { getGuidancePolicy } from "@/lib/arc/guidance/policy";
import type { GuidanceReviewSection } from "@/lib/arc/guidance/types";

import { normalizeCitationText } from "./citations";
import { canonicalJson, stableHash, valueFingerprint } from "./identity";
import type { AiReviewState } from "./schema";

export type AiReviewItemState = "yellow" | "red" | "resolved";

export type AiAffirmationMethod = "individual" | "page_all" | "global_all" | "edited";

/**
 * The evidence material of a review item. Only validated Phase 9F citation
 * values reach this shape; nothing here is ever model-authored free text that
 * bypassed `validateAiCitations()`.
 */
export interface AiReviewCitationRef {
  documentId: string;
  pageStart: number;
  pageEnd: number;
  evidenceMode: "text" | "visual";
  excerpt: string | null;
}

export type ManualRedReason =
  "reviewed_current_treatment" | "outside_source_information" | "not_applicable";

export type AiReviewResolution =
  | {
      kind: "affirmed";
      at: string;
      method: AiAffirmationMethod;
      reviewFingerprint: string;
    }
  | {
      kind: "manual_red";
      at: string;
      reason: ManualRedReason;
      note: string | null;
      reviewFingerprint: string;
    };

export interface AiReviewItem {
  id: string;
  targetKey: string;
  section: GuidanceReviewSection;
  state: AiReviewItemState;
  reasonCode: AiReviewReasonCode;
  reason: string;
  guidanceIds: number[];
  citations: AiReviewCitationRef[];
  valueFingerprint: string;
  reviewFingerprint: string;
  resolution: AiReviewResolution | null;
  /** Retained until every persisted Phase 9F row has been normalized. */
  affirmedAt: string | null;
  affirmedMethod: AiAffirmationMethod | null;
}

/**
 * Stable machine reason codes. These, not prose, participate in the review
 * item's deterministic identity.
 */
export type AiReviewReasonCode =
  | "missing_required_input"
  | "source_conflict"
  | "engine_support_gap"
  | "unsupported_recognition_method"
  | "missing_ssp"
  | "unsafe_semantic_relationship"
  | "modification_facts_incomplete"
  | "billing_schedule_not_derivable"
  | "projected_collection_not_derivable"
  | "manual_value_preserved"
  | "manual_structure_preserved"
  | "prior_finalized_conflict"
  | "ai_proposal_omitted"
  | "ai_proposal_tombstoned"
  | "advisory_topic"
  | "accountant_affirmation_required";

export interface ReviewDerivationInput {
  targetKey: string;
  section: GuidanceReviewSection;
  reasonCode: AiReviewReasonCode;
  reason: string;
  guidanceIds: readonly number[];
  /** Validated citation material of the exact conclusion under review. */
  citations: readonly AiReviewCitationRef[];
  /**
   * The server-derived reviewed value. Both fingerprints are computed from
   * this one value, so a caller can never fingerprint one value while
   * reviewing another.
   */
  value: unknown;
  /** The validated AI review state for the underlying conclusion, if any. */
  aiReviewState?: AiReviewState | null;
  /**
   * True when ARC cannot complete the canonical accounting without user action:
   * a required canonical field is unanswered, or the engine cannot execute the
   * proposed conclusion.
   */
  blocking?: boolean;
}

/**
 * The single deterministic material fingerprint of a review item: its identity,
 * the reviewed value, the Guidance set and the citation set. Input order and
 * byte-identical duplicates never change it; a materially different value,
 * reason, Guidance reference or piece of evidence always does.
 */
export function buildReviewFingerprint(input: {
  id: string;
  targetKey: string;
  reasonCode: AiReviewReasonCode;
  value: unknown;
  guidanceIds: readonly number[];
  citations: readonly AiReviewCitationRef[];
}): string {
  const guidanceIds = [...new Set(input.guidanceIds)].sort((a, b) => a - b);
  const citationByIdentity = new Map(
    input.citations.map((citation) => {
      const normalized = {
        documentId: citation.documentId,
        pageStart: citation.pageStart,
        pageEnd: citation.pageEnd,
        evidenceMode: citation.evidenceMode,
        excerpt: normalizeCitationText(citation.excerpt ?? ""),
      };
      return [canonicalJson(normalized), normalized] as const;
    }),
  );
  const citations = [...citationByIdentity.values()].sort((a, b) =>
    canonicalJson(a).localeCompare(canonicalJson(b)),
  );

  return stableHash(
    canonicalJson({
      id: input.id,
      targetKey: input.targetKey,
      reasonCode: input.reasonCode,
      value: input.value,
      guidanceIds,
      citations,
    }),
  );
}

/** Deterministic review-item identity. No UUID, no counter, no clock. */
export function reviewItemId(
  targetKey: string,
  section: GuidanceReviewSection,
  reasonCode: AiReviewReasonCode,
): string {
  return `rev-${stableHash(`${section}\u0000${targetKey}\u0000${reasonCode}`)}`;
}

const RANK: Record<AiReviewItemState, number> = { red: 3, yellow: 2, resolved: 1 };

/**
 * Does the Guidance machine policy itself require accountant review for a
 * conclusion ARC can otherwise represent completely?
 */
function policyRequiresReview(guidanceIds: readonly number[]): boolean {
  return guidanceIds.some((id) => {
    const policy = getGuidancePolicy(id);
    return policy.finalizationImpact !== "none" || policy.engineSupport !== "full";
  });
}

/** Does any referenced card mark the behaviour as outside engine support? */
function policyEngineGap(guidanceIds: readonly number[]): boolean {
  return guidanceIds.some((id) => getGuidancePolicy(id).engineSupport === "not_supported");
}

/**
 * Red means action is required to complete the accounting. Yellow means the
 * accounting is structurally complete but the accountant must affirm it.
 * `null` means no review item is warranted at all.
 */
export function classifyReviewState(input: ReviewDerivationInput): AiReviewItemState | null {
  const ids = input.guidanceIds;
  if (input.blocking === true) return "red";
  if (input.aiReviewState === "source_conflict") return "red";
  if (policyEngineGap(ids)) return "red";
  if (input.aiReviewState === "needs_user_input") return "red";
  if (input.aiReviewState === "inference" || input.aiReviewState === "needs_review") {
    return "yellow";
  }
  if (policyRequiresReview(ids)) return "yellow";
  // Something ARC did NOT apply is always worth seeing, however confident the
  // model was: a preserved manual value or structure, an omitted or
  // tombstoned proposal, and every advisory topic.
  if (ALWAYS_VISIBLE.has(input.reasonCode)) return "yellow";
  // A fully supported conclusion with fully supported guidance needs nothing.
  return input.aiReviewState === "supported" ? null : "yellow";
}

/** Reason codes that always deserve at least an affirmation item. */
const ALWAYS_VISIBLE = new Set<AiReviewReasonCode>([
  "manual_value_preserved",
  "manual_structure_preserved",
  "prior_finalized_conflict",
  "ai_proposal_omitted",
  "ai_proposal_tombstoned",
  "advisory_topic",
  "accountant_affirmation_required",
]);

/** Builds the deterministic review item, or null when none is warranted. */
export function deriveReviewItem(input: ReviewDerivationInput): AiReviewItem | null {
  const state = classifyReviewState(input);
  if (state === null) return null;
  const id = reviewItemId(input.targetKey, input.section, input.reasonCode);
  return {
    id,
    targetKey: input.targetKey,
    section: input.section,
    state,
    reasonCode: input.reasonCode,
    reason: input.reason,
    guidanceIds: [...input.guidanceIds].sort((a, b) => a - b),
    citations: input.citations.map((citation) => ({ ...citation })),
    valueFingerprint: valueFingerprint(input.value),
    reviewFingerprint: buildReviewFingerprint({
      id,
      targetKey: input.targetKey,
      reasonCode: input.reasonCode,
      value: input.value,
      guidanceIds: input.guidanceIds,
      citations: input.citations,
    }),
    resolution: null,
    affirmedAt: null,
    affirmedMethod: null,
  };
}

/**
 * Red outranks yellow outranks resolved for the same substantive matter. A
 * yellow affirmation item is never allowed to imply a blocking red issue on
 * the same target has been cleared.
 */
export function rankReviewItems(items: readonly AiReviewItem[]): AiReviewItem[] {
  const byTarget = new Map<string, AiReviewItem>();
  const order: string[] = [];
  for (const item of items) {
    const existing = byTarget.get(item.targetKey);
    if (existing === undefined) {
      byTarget.set(item.targetKey, item);
      order.push(item.targetKey);
      continue;
    }
    if (RANK[item.state] > RANK[existing.state]) byTarget.set(item.targetKey, item);
  }
  return order.map((key) => byTarget.get(key)!);
}

/**
 * Carries a prior resolution forward only when the item's identity AND its
 * material review fingerprint are unchanged, and only into a state that
 * matches the kind of resolution given. A changed value, citation set,
 * Guidance set or reason reopens the item — an accountant never affirms
 * accounting they have not seen. A newly red item never inherits an
 * affirmation, and a yellow item never inherits a manual red resolution.
 */
export function carryForwardReviewResolutions(
  next: readonly AiReviewItem[],
  previous: readonly AiReviewItem[],
): AiReviewItem[] {
  const prior = new Map(previous.map((item) => [item.id, item] as const));
  return next.map((item) => {
    const old = prior.get(item.id);
    if (!old?.resolution || old.reviewFingerprint !== item.reviewFingerprint) return item;
    if (item.state === "yellow" && old.resolution.kind === "affirmed") {
      return {
        ...item,
        state: "resolved",
        resolution: old.resolution,
        affirmedAt: old.resolution.at,
        affirmedMethod: old.resolution.method,
      };
    }
    if (item.state === "red" && old.resolution.kind === "manual_red") {
      return { ...item, state: "resolved", resolution: old.resolution };
    }
    return item;
  });
}

/** Deterministic presentation order: section, then target, then id. */
export function sortReviewItems(items: readonly AiReviewItem[]): AiReviewItem[] {
  return [...items].sort(
    (a, b) =>
      a.section.localeCompare(b.section) ||
      a.targetKey.localeCompare(b.targetKey) ||
      a.id.localeCompare(b.id),
  );
}
