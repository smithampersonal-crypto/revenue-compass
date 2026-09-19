/**
 * Post-R2 live regression patch — defect 3.
 *
 * When the accountant actually supplies a recognition method the deterministic
 * engine supports, the red "unsupported recognition method" item is genuinely
 * cured and disappears on its own. No affirmation event and no manual
 * red-resolution event is fabricated, and nothing else cures it.
 */
import { describe, expect, it } from "vitest";

import { createEmptyDraft, createPoDraft, type WorkflowDraft } from "@/lib/asc606-workflow";

import { reconcileAiEdits } from "../edit-reconciliation";
import { fieldKeys } from "../identity";
import { createEmptyAiAnalysisState } from "../merge";
import type { AiReviewItem } from "../review-state";

const PO_ID = "po-support";

function draftWithMethod(
  method: WorkflowDraft["performanceObligations"][number]["recognitionMethod"],
) {
  const empty = createEmptyDraft();
  return {
    ...empty,
    performanceObligations: [
      {
        ...createPoDraft(1, PO_ID),
        name: "Support hours",
        sspInput: "20000",
        recognitionMethod: method,
        serviceStart: "2027-01-01",
        serviceEnd: "2027-12-31",
      },
    ],
  } satisfies WorkflowDraft;
}

const RED: AiReviewItem = {
  id: "rev-method",
  targetKey: fieldKeys.po(PO_ID, "recognitionMethod"),
  section: "step_5",
  state: "red",
  severity: "red",
  reasonCode: "unsupported_recognition_method",
  reason: "The proposed recognition treatment is not one ARC can measure.",
  guidanceIds: [],
  citations: [],
  valueFingerprint: "v1",
  reviewFingerprint: "rf-method",
  resolution: null,
  affirmedAt: null,
  affirmedMethod: null,
};

function reconcile(previous: WorkflowDraft, next: WorkflowDraft) {
  return reconcileAiEdits({
    previousDraft: previous,
    nextDraft: next,
    currentAiState: { ...createEmptyAiAnalysisState(), reviewItems: [RED] },
  });
}

describe("post-R2 — unsupported recognition method auto-cure", () => {
  it("clears the red item once a supported over-time method is selected", () => {
    const result = reconcile(draftWithMethod(null), draftWithMethod("over_time_ratable"));
    expect(result.aiState.reviewItems).toEqual([]);
    expect(result.reviewEvents).toEqual([]);
    expect(result.changed).toBe(true);
  });

  it("clears the red item once a supported point-in-time method is selected", () => {
    const result = reconcile(draftWithMethod(null), draftWithMethod("point_in_time"));
    expect(result.aiState.reviewItems).toEqual([]);
    expect(result.reviewEvents).toEqual([]);
  });

  it("keeps the red item when the method is still blank", () => {
    const previous = draftWithMethod(null);
    const next = draftWithMethod(null);
    next.performanceObligations[0]!.name = "Support hours (renamed)";
    const result = reconcile(previous, next);
    expect(result.aiState.reviewItems[0]!.state).toBe("red");
    expect(result.reviewEvents).toEqual([]);
  });

  it("is not cured by an unrelated edit elsewhere in the workpaper", () => {
    const previous = draftWithMethod(null);
    const next = draftWithMethod(null);
    next.contract.customerName = "Genomix";
    const result = reconcile(previous, next);
    expect(result.aiState.reviewItems[0]!.state).toBe("red");
    expect(result.aiState.reviewItems[0]!.resolution).toBeNull();
  });
});
