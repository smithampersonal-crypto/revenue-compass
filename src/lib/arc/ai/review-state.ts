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

import { stableHash } from "./identity";
import type { AiReviewState } from "./schema";

export type AiReviewItemState = "yellow" | "red" | "resolved";

export type AiAffirmationMethod = "individual" | "page_all" | "global_all" | "edited";

export interface AiReviewItem {
  id: string;
  targetKey: string;
  section: GuidanceReviewSection;
  state: AiReviewItemState;
  reason: string;
  guidanceIds: number[];
  valueFingerprint: string;
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
  valueFingerprint: string;
  /** The validated AI review state for the underlying conclusion, if any. */
  aiReviewState?: AiReviewState | null;
  /**
   * True when ARC cannot complete the canonical accounting without user action:
   * a required canonical field is unanswered, or the engine cannot execute the
   * proposed conclusion.
   */
  blocking?: boolean;
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
  // A fully supported conclusion with fully supported guidance needs nothing.
  return input.aiReviewState === "supported" ? null : "yellow";
}

/** Builds the deterministic review item, or null when none is warranted. */
export function deriveReviewItem(input: ReviewDerivationInput): AiReviewItem | null {
  const state = classifyReviewState(input);
  if (state === null) return null;
  return {
    id: reviewItemId(input.targetKey, input.section, input.reasonCode),
    targetKey: input.targetKey,
    section: input.section,
    state,
    reason: input.reason,
    guidanceIds: [...input.guidanceIds].sort((a, b) => a - b),
    valueFingerprint: input.valueFingerprint,
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
 * Carries a prior resolution forward only when the item's identity AND the
 * exact reviewed value are unchanged. A changed value invalidates the old
 * affirmation: an accountant never affirms accounting they have not seen.
 */
export function applyPriorAffirmations(
  next: readonly AiReviewItem[],
  previous: readonly AiReviewItem[],
): AiReviewItem[] {
  const priorById = new Map(previous.map((item) => [item.id, item] as const));
  return next.map((item) => {
    const prior = priorById.get(item.id);
    if (
      prior === undefined ||
      prior.state !== "resolved" ||
      prior.targetKey !== item.targetKey ||
      prior.valueFingerprint !== item.valueFingerprint
    ) {
      return item;
    }
    return {
      ...item,
      state: "resolved",
      affirmedAt: prior.affirmedAt,
      affirmedMethod: prior.affirmedMethod,
    };
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
