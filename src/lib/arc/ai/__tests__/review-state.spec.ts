import { describe, expect, it } from "vitest";

import {
  buildReviewFingerprint,
  carryForwardReviewResolutions,
  classifyReviewState,
  deriveReviewItem,
  rankReviewItems,
  reviewItemId,
  sortReviewItems,
  type AiReviewCitationRef,
  type AiReviewItem,
} from "../review-state";

const base = {
  targetKey: "transactionPrice.input",
  section: "step_3" as const,
  reasonCode: "manual_value_preserved" as const,
  reason: "Preserved.",
  guidanceIds: [] as number[],
  citations: [] as AiReviewCitationRef[],
  value: { preservedValue: "125000", proposedValue: "150000" },
};

const citation: AiReviewCitationRef = {
  documentId: "doc-1",
  pageStart: 3,
  pageEnd: 3,
  evidenceMode: "text",
  excerpt: "Net 30 after invoice date.",
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
    expect(classifyReviewState({ ...base, aiReviewState: "supported" })).toBe("yellow");
    expect(
      classifyReviewState({
        ...base,
        reasonCode: "manual_structure_preserved",
        aiReviewState: "supported",
      }),
    ).toBe("yellow");
  });

  it("gives an item a deterministic identity, sorted guidance and its own fingerprints", () => {
    const item = deriveReviewItem({ ...base, blocking: true, guidanceIds: [9, 2, 2] })!;
    expect(item.id).toBe(reviewItemId(base.targetKey, base.section, base.reasonCode));
    expect(item.guidanceIds).toEqual([2, 2, 9]);
    expect(item.reasonCode).toBe(base.reasonCode);
    expect(item.resolution).toBeNull();
    expect(item.affirmedAt).toBeNull();
    expect(item.valueFingerprint).toHaveLength(16);
    expect(item.reviewFingerprint).toBe(
      buildReviewFingerprint({
        id: item.id,
        targetKey: item.targetKey,
        reasonCode: item.reasonCode,
        value: base.value,
        guidanceIds: [9, 2, 2],
        citations: [],
      }),
    );
  });
});

describe("review fingerprints are material, not positional", () => {
  const other: AiReviewCitationRef = {
    documentId: "doc-1",
    pageStart: 7,
    pageEnd: 7,
    evidenceMode: "visual",
    excerpt: null,
  };
  const of = (input: Partial<Parameters<typeof buildReviewFingerprint>[0]>) =>
    buildReviewFingerprint({
      id: "rev-1",
      targetKey: base.targetKey,
      reasonCode: base.reasonCode,
      value: base.value,
      guidanceIds: [],
      citations: [],
      ...input,
    });

  it("ignores citation input order", () => {
    expect(of({ citations: [citation, other] })).toBe(of({ citations: [other, citation] }));
  });

  it("de-duplicates byte-identical citations and duplicate Guidance ids", () => {
    expect(of({ citations: [citation, { ...citation }] })).toBe(of({ citations: [citation] }));
    expect(of({ guidanceIds: [5, 2, 5] })).toBe(of({ guidanceIds: [2, 5] }));
  });

  it("changes when the cited page, document, mode or normalized excerpt changes", () => {
    const baseline = of({ citations: [citation] });
    expect(of({ citations: [{ ...citation, pageStart: 4, pageEnd: 4 }] })).not.toBe(baseline);
    expect(of({ citations: [{ ...citation, documentId: "doc-2" }] })).not.toBe(baseline);
    expect(of({ citations: [{ ...citation, evidenceMode: "visual" }] })).not.toBe(baseline);
    expect(of({ citations: [{ ...citation, excerpt: "Net 45 after invoice date." }] })).not.toBe(
      baseline,
    );
  });

  it("is unchanged by whitespace the citation normalizer collapses", () => {
    expect(of({ citations: [{ ...citation, excerpt: "  Net 30   after invoice date.  " }] })).toBe(
      of({ citations: [citation] }),
    );
  });

  it("changes when the reviewed value, reason code or Guidance set changes", () => {
    const baseline = of({});
    expect(of({ value: { preservedValue: "125000", proposedValue: "180000" } })).not.toBe(baseline);
    expect(of({ reasonCode: "prior_finalized_conflict" })).not.toBe(baseline);
    expect(of({ guidanceIds: [2] })).not.toBe(baseline);
  });
});

describe("ranking and resolution carry-forward", () => {
  const item = (
    state: AiReviewItem["state"],
    id: string,
    severity: AiReviewItem["severity"] = state === "resolved" ? "yellow" : state,
  ): AiReviewItem => ({
    id,
    targetKey: "transactionPrice.input",
    section: "step_3",
    state,
    severity,
    reasonCode: "manual_value_preserved",
    reason: "r",
    guidanceIds: [],
    citations: [],
    valueFingerprint: "fp-1",
    reviewFingerprint: "rfp-1",
    resolution: null,
    affirmedAt: null,
    affirmedMethod: null,
  });

  const affirmed = (id: string, reviewFingerprint = "rfp-1"): AiReviewItem => ({
    ...item("resolved", id),
    reviewFingerprint,
    resolution: {
      kind: "affirmed",
      at: "2027-02-01T00:00:00.000Z",
      method: "individual",
      reviewFingerprint,
    },
    affirmedAt: "2027-02-01T00:00:00.000Z",
    affirmedMethod: "individual",
  });

  it("lets red outrank yellow on the same target", () => {
    expect(rankReviewItems([item("yellow", "a"), item("red", "b")])[0]!.state).toBe("red");
    expect(rankReviewItems([item("red", "b"), item("yellow", "a")])[0]!.state).toBe("red");
  });

  it("carries an affirmation forward only when the material fingerprint is unchanged", () => {
    const resolved = affirmed("a");
    expect(carryForwardReviewResolutions([item("yellow", "a")], [resolved])[0]!.state).toBe(
      "resolved",
    );

    const changed = { ...item("yellow", "a"), reviewFingerprint: "rfp-2" };
    expect(carryForwardReviewResolutions([changed], [resolved])[0]!.state).toBe("yellow");
    expect(carryForwardReviewResolutions([item("yellow", "z")], [resolved])[0]!.state).toBe(
      "yellow",
    );
  });

  it("reopens when material evidence changes", () => {
    const first = deriveReviewItem({
      ...base,
      reasonCode: "accountant_affirmation_required",
      citations: [citation],
      value: "over_time",
    })!;
    const resolved: AiReviewItem = {
      ...first,
      state: "resolved",
      resolution: {
        kind: "affirmed",
        at: "2026-09-17T12:00:00Z",
        method: "individual",
        reviewFingerprint: first.reviewFingerprint,
      },
    };
    const changed = deriveReviewItem({
      ...base,
      reasonCode: "accountant_affirmation_required",
      citations: [{ ...citation, pageStart: 4, pageEnd: 4 }],
      value: "over_time",
    })!;

    expect(carryForwardReviewResolutions([changed], [resolved])[0]!.state).toBe("yellow");
  });

  it("never lets a yellow affirmation clear a newly red item", () => {
    const resolved = affirmed("a");
    expect(carryForwardReviewResolutions([item("red", "a")], [resolved])[0]!.state).toBe("red");
  });

  it("carries a manual red resolution only to the same red item and fingerprint", () => {
    const manual: AiReviewItem = {
      ...item("resolved", "a", "red"),
      resolution: {
        kind: "manual_red",
        at: "2027-02-01T00:00:00.000Z",
        reason: "reviewed_current_treatment",
        note: null,
        reviewFingerprint: "rfp-1",
      },
    };
    expect(carryForwardReviewResolutions([item("red", "a")], [manual])[0]!.state).toBe("resolved");
    // A yellow item must never inherit a manual-red resolution.
    expect(carryForwardReviewResolutions([item("yellow", "a")], [manual])[0]!.state).toBe("yellow");
    const changed = { ...item("red", "a"), reviewFingerprint: "rfp-9" };
    expect(carryForwardReviewResolutions([changed], [manual])[0]!.state).toBe("red");
  });

  it("sorts deterministically regardless of input order", () => {
    const a = { ...item("red", "a"), targetKey: "aaa" };
    const b = { ...item("red", "b"), targetKey: "zzz" };
    expect(sortReviewItems([b, a]).map((row) => row.targetKey)).toEqual(["aaa", "zzz"]);
    expect(sortReviewItems([a, b]).map((row) => row.targetKey)).toEqual(["aaa", "zzz"]);
  });
});

describe("carry-forward trusts nothing it has not verified itself", () => {
  const base: AiReviewItem = {
    id: "rev-x",
    targetKey: "transactionPrice.input",
    section: "step_3",
    state: "yellow",
    severity: "yellow",
    reasonCode: "manual_value_preserved",
    reason: "r",
    guidanceIds: [],
    citations: [],
    valueFingerprint: "fp-1",
    reviewFingerprint: "rfp-1",
    resolution: null,
    affirmedAt: null,
    affirmedMethod: null,
  };

  it("rejects a prior resolution whose embedded fingerprint does not match its own item", () => {
    const tampered: AiReviewItem = {
      ...base,
      state: "resolved",
      resolution: {
        kind: "affirmed",
        at: "2027-02-01T00:00:00.000Z",
        // Matches the NEXT item but not the prior item it is attached to.
        reviewFingerprint: "rfp-1",
        method: "individual",
      },
      reviewFingerprint: "rfp-other",
    };
    expect(carryForwardReviewResolutions([base], [tampered])[0]!.state).toBe("yellow");
  });

  it("rejects a prior manual-red resolution carrying an unknown reason", () => {
    const bogus = {
      ...base,
      state: "resolved" as const,
      resolution: {
        kind: "manual_red",
        at: "2027-02-01T00:00:00.000Z",
        reason: "because_i_said_so",
        note: null,
        reviewFingerprint: "rfp-1",
      } as unknown as AiReviewItem["resolution"],
    };
    expect(carryForwardReviewResolutions([{ ...base, state: "red" }], [bogus])[0]!.state).toBe(
      "red",
    );
  });
});

describe("base severity survives resolution", () => {
  const yellowItem: AiReviewItem = {
    id: "rev-s",
    targetKey: "transactionPrice.input",
    section: "step_3",
    state: "yellow",
    severity: "yellow",
    reasonCode: "manual_value_preserved",
    reason: "r",
    guidanceIds: [],
    citations: [],
    valueFingerprint: "fp-1",
    reviewFingerprint: "rfp-1",
    resolution: null,
    affirmedAt: null,
    affirmedMethod: null,
  };
  const redItem: AiReviewItem = { ...yellowItem, state: "red", severity: "red" };

  it("records the derived severity on a new item", () => {
    const derived = deriveReviewItem({ ...base, blocking: true })!;
    expect(derived.severity).toBe("red");
    expect(deriveReviewItem(base)!.severity).toBe("yellow");
  });

  it("refuses a prior affirmation recorded against a red-severity item", () => {
    const prior: AiReviewItem = {
      ...redItem,
      state: "resolved",
      resolution: {
        kind: "affirmed",
        at: "2027-02-01T00:00:00.000Z",
        method: "individual",
        reviewFingerprint: "rfp-1",
      },
    };
    expect(carryForwardReviewResolutions([yellowItem], [prior])[0]!.state).toBe("yellow");
  });

  it("refuses a prior manual-red resolution recorded against a yellow-severity item", () => {
    const prior: AiReviewItem = {
      ...yellowItem,
      state: "resolved",
      resolution: {
        kind: "manual_red",
        at: "2027-02-01T00:00:00.000Z",
        reason: "reviewed_current_treatment",
        note: null,
        reviewFingerprint: "rfp-1",
      },
    };
    expect(carryForwardReviewResolutions([redItem], [prior])[0]!.state).toBe("red");
  });

  it("still carries a valid affirmation and a valid manual resolution", () => {
    const affirmedPrior: AiReviewItem = {
      ...yellowItem,
      state: "resolved",
      resolution: {
        kind: "affirmed",
        at: "2027-02-01T00:00:00.000Z",
        method: "individual",
        reviewFingerprint: "rfp-1",
      },
    };
    const manualPrior: AiReviewItem = {
      ...redItem,
      state: "resolved",
      resolution: {
        kind: "manual_red",
        at: "2027-02-01T00:00:00.000Z",
        reason: "reviewed_current_treatment",
        note: null,
        reviewFingerprint: "rfp-1",
      },
    };
    expect(carryForwardReviewResolutions([yellowItem], [affirmedPrior])[0]!.state).toBe("resolved");
    expect(carryForwardReviewResolutions([redItem], [manualPrior])[0]!.state).toBe("resolved");
  });
});

describe("only an actually resolved prior item may carry a resolution", () => {
  const yellowOpen: AiReviewItem = {
    id: "rev-open",
    targetKey: "transactionPrice.input",
    section: "step_3",
    state: "yellow",
    severity: "yellow",
    reasonCode: "manual_value_preserved",
    reason: "r",
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

  it("refuses an affirmation attached to a still-open yellow prior item", () => {
    expect(carryForwardReviewResolutions([{ ...yellowOpen, resolution: null }], [yellowOpen])[0]!
      .state).toBe("yellow");
  });

  it("refuses a manual-red resolution attached to a still-open red prior item", () => {
    const redOpen: AiReviewItem = {
      ...yellowOpen,
      state: "red",
      severity: "red",
      affirmedAt: null,
      affirmedMethod: null,
      resolution: {
        kind: "manual_red",
        at: "2027-02-01T00:00:00.000Z",
        reason: "reviewed_current_treatment",
        note: null,
        reviewFingerprint: "rfp-1",
      },
    };
    expect(
      carryForwardReviewResolutions([{ ...redOpen, resolution: null }], [redOpen])[0]!.state,
    ).toBe("red");
  });
});
