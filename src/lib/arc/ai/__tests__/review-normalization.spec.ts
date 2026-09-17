import { describe, expect, it } from "vitest";

import { normalizePersistedReviewItems } from "../review-normalization";
import { deriveReviewItem, type AiReviewItem } from "../review-state";

const legacyRow = {
  id: "rev-legacy",
  targetKey: "transactionPrice.input",
  section: "step_3",
  state: "resolved",
  reason: "Preserved.",
  guidanceIds: [5, 2],
  valueFingerprint: "fp-1",
  affirmedAt: "2026-05-01T00:00:00.000Z",
  affirmedMethod: "individual",
};

describe("persisted review normalization", () => {
  it("returns nothing for a non-array or unreadable payload", () => {
    expect(normalizePersistedReviewItems(null)).toEqual([]);
    expect(normalizePersistedReviewItems({})).toEqual([]);
    expect(normalizePersistedReviewItems([null, 7, "x", {}])).toEqual([]);
  });

  it("reads a Phase 9F row and rebuilds an affirmed resolution", () => {
    const [item] = normalizePersistedReviewItems([legacyRow]);
    expect(item).toBeDefined();
    expect(item!.state).toBe("resolved");
    expect(item!.reasonCode).toBe("accountant_affirmation_required");
    expect(item!.citations).toEqual([]);
    expect(item!.resolution).toEqual({
      kind: "affirmed",
      at: "2026-05-01T00:00:00.000Z",
      method: "individual",
      reviewFingerprint: item!.reviewFingerprint,
    });
  });

  it("never lets a legacy fingerprint match a newly derived Phase 9G fingerprint", () => {
    const [legacy] = normalizePersistedReviewItems([legacyRow]);
    const derived = deriveReviewItem({
      targetKey: legacyRow.targetKey,
      section: "step_3",
      reasonCode: "accountant_affirmation_required",
      reason: legacyRow.reason,
      guidanceIds: legacyRow.guidanceIds,
      citations: [],
      value: "anything",
    })!;
    expect(legacy!.reviewFingerprint).not.toBe(derived.reviewFingerprint);
  });

  it("keeps a current Phase 9G row byte-for-byte, including a manual red resolution", () => {
    const current: AiReviewItem = {
      id: "rev-current",
      targetKey: "po:po-1.recognitionMethod",
      section: "step_5",
      state: "resolved",
      reasonCode: "engine_support_gap",
      reason: "Reviewed.",
      guidanceIds: [2],
      citations: [
        { documentId: "doc-1", pageStart: 2, pageEnd: 2, evidenceMode: "text", excerpt: "Term." },
      ],
      valueFingerprint: "fp-9",
      reviewFingerprint: "rfp-9",
      resolution: {
        kind: "manual_red",
        at: "2026-09-01T00:00:00.000Z",
        reason: "outside_source_information",
        note: "Confirmed with the customer.",
        reviewFingerprint: "rfp-9",
      },
      affirmedAt: null,
      affirmedMethod: null,
    };
    expect(normalizePersistedReviewItems([current])).toEqual([current]);
  });

  it("drops an unreadable resolution rather than trusting it", () => {
    const [item] = normalizePersistedReviewItems([
      { ...legacyRow, affirmedAt: null, affirmedMethod: null, resolution: { kind: "wat" } },
    ]);
    expect(item!.resolution).toBeNull();
  });
});
