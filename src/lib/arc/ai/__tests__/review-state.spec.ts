import { describe, expect, it } from "vitest";

import {
  applyPriorAffirmations,
  classifyReviewState,
  deriveReviewItem,
  rankReviewItems,
  reviewItemId,
  sortReviewItems,
  type AiReviewItem,
} from "../review-state";

const base = {
  targetKey: "transactionPrice.input",
  section: "step_3" as const,
  reasonCode: "manual_value_preserved" as const,
  reason: "Preserved.",
  guidanceIds: [] as number[],
  valueFingerprint: "fp-1",
};

describe("review classification", () => {
  it("makes blocking gaps and source conflicts red", () => {
    expect(classifyReviewState({ ...base, blocking: true })).toBe("red");
    expect(classifyReviewState({ ...base, aiReviewState: "source_conflict" })).toBe("red");
    expect(classifyReviewState({ ...base, aiReviewState: "needs_user_input" })).toBe("red");
  });

  it("makes structurally complete judgments yellow", () => {
    expect(classifyReviewState({ ...base, aiReviewState: "inference" })).toBe("yellow");
    expect(classifyReviewState({ ...base, aiReviewState: "needs_review" })).toBe("yellow");
  });

  it("raises nothing for a fully supported conclusion with no policy trigger", () => {
    const supported = {
      ...base,
      reasonCode: "missing_required_input" as const,
      aiReviewState: "supported" as const,
    };
    expect(classifyReviewState(supported)).toBeNull();
    expect(deriveReviewItem(supported)).toBeNull();
  });

  it("always shows something ARC chose not to apply", () => {
    // A preserved manual value or structure is worth seeing however confident
    // the model was about its own proposal.
    expect(classifyReviewState({ ...base, aiReviewState: "supported" })).toBe("yellow");
    expect(
      classifyReviewState({
        ...base,
        reasonCode: "manual_structure_preserved",
        aiReviewState: "supported",
      }),
    ).toBe("yellow");
  });

  it("gives an item a deterministic identity and sorted guidance references", () => {
    const item = deriveReviewItem({ ...base, blocking: true, guidanceIds: [9, 2, 2] })!;
    expect(item.id).toBe(reviewItemId(base.targetKey, base.section, base.reasonCode));
    expect(item.guidanceIds).toEqual([2, 2, 9]);
    expect(item.affirmedAt).toBeNull();
  });
});

describe("ranking and affirmations", () => {
  const item = (state: AiReviewItem["state"], id: string): AiReviewItem => ({
    id,
    targetKey: "transactionPrice.input",
    section: "step_3",
    state,
    reason: "r",
    guidanceIds: [],
    valueFingerprint: "fp-1",
    affirmedAt: null,
    affirmedMethod: null,
  });

  it("lets red outrank yellow on the same target", () => {
    expect(rankReviewItems([item("yellow", "a"), item("red", "b")])[0]!.state).toBe("red");
    expect(rankReviewItems([item("red", "b"), item("yellow", "a")])[0]!.state).toBe("red");
  });

  it("carries an affirmation forward only when the reviewed value is unchanged", () => {
    const resolved: AiReviewItem = {
      ...item("resolved", "a"),
      affirmedAt: "2027-02-01T00:00:00.000Z",
      affirmedMethod: "individual",
    };
    expect(applyPriorAffirmations([item("yellow", "a")], [resolved])[0]!.state).toBe("resolved");

    const changed = { ...item("yellow", "a"), valueFingerprint: "fp-2" };
    expect(applyPriorAffirmations([changed], [resolved])[0]!.state).toBe("yellow");
    expect(applyPriorAffirmations([item("yellow", "z")], [resolved])[0]!.state).toBe("yellow");
  });

  it("sorts deterministically regardless of input order", () => {
    const a = { ...item("red", "a"), targetKey: "aaa" };
    const b = { ...item("red", "b"), targetKey: "zzz" };
    expect(sortReviewItems([b, a]).map((row) => row.targetKey)).toEqual(["aaa", "zzz"]);
    expect(sortReviewItems([a, b]).map((row) => row.targetKey)).toEqual(["aaa", "zzz"]);
  });
});
