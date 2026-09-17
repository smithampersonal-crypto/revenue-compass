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

describe("persisted resolved state fails closed", () => {
  const current: AiReviewItem = {
    id: "rev-current",
    targetKey: "po:po-1.recognitionMethod",
    section: "step_5",
    state: "resolved",
    severity: "red",
    reasonCode: "engine_support_gap",
    reason: "Reviewed.",
    guidanceIds: [2],
    citations: [],
    valueFingerprint: "fp-9",
    reviewFingerprint: "rfp-9",
    resolution: {
      kind: "manual_red",
      at: "2026-09-01T00:00:00.000Z",
      reason: "outside_source_information",
      note: null,
      reviewFingerprint: "rfp-9",
    },
    affirmedAt: null,
    affirmedMethod: null,
  };

  const only = (raw: unknown) => normalizePersistedReviewItems([raw])[0];

  it("reopens a resolved row with no resolution at all", () => {
    const item = only({ ...current, resolution: null });
    expect(item!.state).toBe("red");
    expect(item!.resolution).toBeNull();
  });

  it("reopens a resolved row with a malformed resolution", () => {
    const item = only({ ...current, resolution: { kind: "manual_red", at: 7 } });
    expect(item!.state).toBe("red");
    expect(item!.resolution).toBeNull();
  });

  it("reopens a resolved row whose resolution is bound to another fingerprint", () => {
    const item = only({
      ...current,
      resolution: { ...current.resolution, reviewFingerprint: "rfp-somewhere-else" },
    });
    expect(item!.state).toBe("red");
    expect(item!.resolution).toBeNull();
  });

  it("refuses a manual-red resolution on a yellow item", () => {
    const item = only({ ...current, state: "yellow" });
    expect(item!.state).toBe("yellow");
    expect(item!.resolution).toBeNull();
  });

  it("refuses an affirmation on a red item", () => {
    const item = only({
      ...current,
      state: "red",
      resolution: {
        kind: "affirmed",
        at: "2026-09-01T00:00:00.000Z",
        method: "individual",
        reviewFingerprint: "rfp-9",
      },
    });
    expect(item!.state).toBe("red");
    expect(item!.resolution).toBeNull();
  });

  it("refuses an unknown manual-red reason", () => {
    const item = only({
      ...current,
      resolution: { ...current.resolution, reason: "because_i_said_so" },
    });
    expect(item!.state).toBe("red");
    expect(item!.resolution).toBeNull();
  });

  it("drops a row whose persisted section is not a known review section", () => {
    expect(normalizePersistedReviewItems([{ ...current, section: "step_42" }])).toEqual([]);
  });

  it("drops a row whose persisted reason code is not a known reason code", () => {
    expect(normalizePersistedReviewItems([{ ...current, reasonCode: "vibes" }])).toEqual([]);
  });

  it("drops a row whose persisted state is not a known review state", () => {
    expect(normalizePersistedReviewItems([{ ...current, state: "greenish" }])).toEqual([]);
  });

  it("keeps a valid current row exactly as persisted", () => {
    expect(normalizePersistedReviewItems([current])).toEqual([current]);
  });
});

describe("persisted base severity fails closed", () => {
  const resolvedYellow = {
    id: "rev-sev",
    targetKey: "transactionPrice.input",
    section: "step_3",
    state: "resolved",
    severity: "yellow",
    reasonCode: "manual_value_preserved",
    reason: "Preserved.",
    guidanceIds: [],
    citations: [],
    valueFingerprint: "fp-1",
    reviewFingerprint: "rfp-1",
    resolution: {
      kind: "affirmed",
      at: "2027-02-01T00:00:00.000Z",
      method: "individual",
      reviewFingerprint: "rfp-1",
    },
    affirmedAt: "2027-02-01T00:00:00.000Z",
    affirmedMethod: "individual",
  };
  const only = (raw: unknown) => normalizePersistedReviewItems([raw])[0];

  it("keeps a valid affirmed yellow row resolved", () => {
    const item = only(resolvedYellow);
    expect(item!.state).toBe("resolved");
    expect(item!.severity).toBe("yellow");
  });

  it("reopens an affirmation recorded against a red-severity row", () => {
    const item = only({ ...resolvedYellow, severity: "red" });
    expect(item!.state).toBe("red");
    expect(item!.resolution).toBeNull();
  });

  it("reopens a manual-red resolution recorded against a yellow-severity row", () => {
    const item = only({
      ...resolvedYellow,
      resolution: {
        kind: "manual_red",
        at: "2027-02-01T00:00:00.000Z",
        reason: "reviewed_current_treatment",
        note: null,
        reviewFingerprint: "rfp-1",
      },
    });
    expect(item!.state).toBe("yellow");
    expect(item!.resolution).toBeNull();
  });

  it("fails closed when a current row carries no severity at all", () => {
    const { severity: _omitted, ...withoutSeverity } = resolvedYellow;
    const item = only(withoutSeverity);
    expect(item!.state).toBe("red");
    expect(item!.severity).toBe("red");
    expect(item!.resolution).toBeNull();
  });

  it("fails closed when a current row carries a malformed severity", () => {
    const item = only({ ...resolvedYellow, severity: "purple" });
    expect(item!.state).toBe("red");
    expect(item!.resolution).toBeNull();
  });

  it("fails closed when an unresolved row's state and severity disagree", () => {
    const item = only({ ...resolvedYellow, state: "yellow", severity: "red", resolution: null });
    expect(item!.state).toBe("red");
    expect(item!.severity).toBe("red");
  });

  it("keeps a legacy Phase 9F row readable with a conservative severity", () => {
    const item = only({
      id: "rev-legacy-sev",
      targetKey: "transactionPrice.input",
      section: "step_3",
      state: "resolved",
      reason: "Preserved.",
      guidanceIds: [],
      valueFingerprint: "fp-1",
      affirmedAt: "2026-05-01T00:00:00.000Z",
      affirmedMethod: "individual",
    });
    expect(item!.state).toBe("resolved");
    expect(item!.severity).toBe("yellow");
    expect(item!.resolution?.kind).toBe("affirmed");
  });
});
