/**
 * Phase 9G-R Task R2 — shared builders for the assumption-first suites.
 *
 * Nothing here invents accounting: these are review rows in exactly the shape
 * the merge engine persists, used to exercise the count, partition, action and
 * presentation boundaries deterministically.
 */

import type { AiReviewItem, AiReviewItemState } from "../review-state";

export function reviewRow(
  id: string,
  state: AiReviewItemState,
  overrides: Partial<AiReviewItem> = {},
): AiReviewItem {
  const assumed = state === "assumed";
  return {
    id,
    targetKey: `contract.criteria.${id}.answer`,
    section: "step_1",
    state,
    severity: assumed ? "assumed" : state === "red" ? "red" : "yellow",
    reasonCode: assumed ? "routine_assumption" : "accountant_affirmation_required",
    reason: assumed ? "ARC assumed the ordinary reading." : "Confirm this conclusion.",
    guidanceIds: [],
    citations: [],
    valueFingerprint: `value-${id}`,
    reviewFingerprint: `review-${id}`,
    resolution: null,
    affirmedAt: null,
    affirmedMethod: null,
    ...overrides,
  };
}

export function resolvedRow(id: string): AiReviewItem {
  return reviewRow(id, "resolved", {
    severity: "yellow",
    resolution: {
      kind: "affirmed",
      at: "2027-02-01T00:00:00.000Z",
      method: "individual",
      reviewFingerprint: `review-${id}`,
    },
    affirmedAt: "2027-02-01T00:00:00.000Z",
    affirmedMethod: "individual",
  });
}

/** One of each state: the canonical R2 counting case. */
export function mixedReviewRows(): AiReviewItem[] {
  return [
    reviewRow("assumed-1", "assumed"),
    reviewRow("yellow-1", "yellow"),
    reviewRow("red-1", "red", { reasonCode: "missing_required_input" }),
    resolvedRow("resolved-1"),
  ];
}

export function assumptionsOnlyRows(): AiReviewItem[] {
  return [reviewRow("assumed-1", "assumed"), reviewRow("assumed-2", "assumed")];
}
