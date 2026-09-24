/**
 * Phase 9G — Task 7. The pure review presentation registry.
 *
 * Presentation only: no accounting math, no fingerprints, no severity
 * decisions, no finalization. It answers three questions — what does an
 * accountant call this, which workflow section owns it, and is there a real
 * anchor to scroll to — and it answers the last one honestly.
 */
import { describe, expect, it } from "vitest";

import {
  MANUAL_RED_REASON_OPTIONS,
  REVIEW_NOTE_MAX_LENGTH,
  citationLabel,
  citationOpenAccessibleLabel,
  describeReviewTarget,
  provenanceBadgeLabel,
  resolutionSummary,
  aiReviewFinalizeBlock,
  reviewSectionLabel,
  reviewItemHeading,
  reviewStateLabel,
  reviewTargetAnchorId,
} from "../review-presentation";

describe("Task 7 section labels", () => {
  it("maps every accepted review section to settled product copy", () => {
    expect(reviewSectionLabel("step_1")).toBe("Step 1 — Identify the Contract");
    expect(reviewSectionLabel("step_2")).toBe("Step 2 — Identify Performance Obligations");
    expect(reviewSectionLabel("step_3")).toBe("Step 3 — Determine the Transaction Price");
    expect(reviewSectionLabel("step_4")).toBe("Step 4 — Allocate the Transaction Price");
    expect(reviewSectionLabel("step_5")).toBe("Step 5 — Recognize Revenue");
    expect(reviewSectionLabel("additional_topics")).toBe("Additional Topics Applied");
  });
});

describe("2C-J review item headings", () => {
  it("suppresses only identical labels", () => {
    expect(reviewItemHeading("Additional Topics Applied", "Additional Topics Applied")).toBe(
      "Additional Topics Applied",
    );
    expect(reviewItemHeading("Section", "Specific target")).toBe("Section · Specific target");
    expect(reviewItemHeading("Section", "section")).toBe("Section · section");
  });
});

describe("Task 7 review state labels", () => {
  it("names severity in words, never by colour alone", () => {
    expect(reviewStateLabel({ state: "yellow", severity: "yellow" })).toBe("Needs confirmation");
    expect(reviewStateLabel({ state: "red", severity: "red" })).toBe("Needs resolution");
    expect(reviewStateLabel({ state: "resolved", severity: "red" })).toBe("Resolved");
  });
});

describe("Task 7 target presentation registry", () => {
  const exact: ReadonlyArray<readonly [string, string]> = [
    ["contract.customerName", "step_1"],
    ["contract.criteria.collectibility_probable.answer", "step_1"],
    ["contract.criteria.collectibility_probable.rationale", "step_1"],
    ["promise:pr-saas.kind", "step_2"],
    ["promise:pr-saas.description", "step_2"],
    ["promise:pr-saas.capableOfBeingDistinct", "step_2"],
    ["promise:pr-saas.distinctWithinContractContext", "step_2"],
    ["promise:pr-saas.distinctRationale", "step_2"],
    ["promise:pr-saas.conveysMaterialRight", "step_2"],
    ["promise:pr-saas.performanceObligationId", "step_2"],
    ["po:po-saas", "step_2"],
    ["po:po-saas.name", "step_2"],
    ["po:po-saas.classification", "step_2"],
    ["po:po-saas.classificationRationale", "step_2"],
    ["po:po-saas.recognitionMethod", "step_5"],
    ["po:po-saas.recognitionRationale", "step_5"],
    ["po:po-saas.serviceStart", "step_5"],
    ["po:po-saas.serviceEnd", "step_5"],
    ["po:po-saas.servicePeriod", "step_5"],
    ["po:po-saas.recognitionDate", "step_5"],
    ["po:po-saas.sspInput", "step_4"],
    ["po:po-saas.sspBasis", "step_4"],
    ["transactionPrice.input", "step_3"],
    ["transactionPrice.notes", "step_3"],
    ["vc:vc-usage.description", "step_3"],
    ["vc:vc-usage.treatment", "step_3"],
    ["vc:vc-usage.estimationMethod", "step_3"],
    ["vc:vc-usage.inception", "step_3"],
    ["vc:vc-usage.usagePeriods", "step_3"],
    ["vc:vc-usage.meter.rateAmountInput", "step_3"],
    ["modification:mod-1.phase5cFacts", "additional_topics"],
    ["modification:mod-1.modificationDate", "additional_topics"],
    ["draft.hasContractModifications", "additional_topics"],
  ];

  for (const [targetKey, section] of exact) {
    it(`gives ${targetKey} an exact anchor and a human label`, () => {
      const presented = describeReviewTarget(targetKey, section as never);
      expect(presented.kind).toBe("exact");
      expect(presented.anchorId).toBe(reviewTargetAnchorId(targetKey));
      expect(presented.label).not.toContain(targetKey);
      expect(presented.label.length).toBeGreaterThan(0);
      expect(presented.sectionElementId.length).toBeGreaterThan(0);
    });
  }

  const fallback: ReadonlyArray<readonly [string, string]> = [
    ["transactionPrice.financing", "step_3"],
    ["transactionPrice.noncash", "step_3"],
    ["transactionPrice.payableToCustomer", "step_3"],
    ["transactionPrice.futureAdvisoryThing", "step_3"],
    ["additionalTopic:principal_agent", "additional_topics"],
    ["issue:some-issue", "step_1"],
    ["tombstone:promise:gone", "step_2"],
    ["recognition:po:saas", "step_5"],
    ["ssp:po:saas", "step_4"],
    ["totally.unknown.shape", "step_1"],
    // `object:<id>` names an omitted AI-owned object whose canonical kind is
    // not knowable from the key. It must never claim a field, and never claim
    // to be a performance obligation.
    ["object:po-saas", "step_2"],
    // Unknown/future fields must not inherit exactness from a broad regex.
    ["promise:p1.futureField", "step_2"],
    ["po:po-1.futureField", "step_2"],
    ["vc:vc-1.futureField", "step_3"],
    ["vc:vc-1.meter.futureField", "step_3"],
    ["modification:m1.futureField", "additional_topics"],
    ["billing:b1.futureField", "additional_topics"],
    ["cash:c1.futureField", "additional_topics"],
    // Edited on the Contract Balances page, so never an analysis-page anchor.
    ["billing:ce-annual.invoiceDate", "additional_topics"],
    ["cash:cc-annual.collectionDate", "additional_topics"],
    ["contract.futureField", "step_1"],
    ["draft.futureField", "step_1"],
  ];

  for (const [targetKey, section] of fallback) {
    it(`falls back to the owning section for ${targetKey}`, () => {
      const presented = describeReviewTarget(targetKey, section as never);
      expect(presented.kind).toBe("section");
      expect(presented.anchorId).toBeNull();
      expect(presented.label).toBe(reviewSectionLabel(section as never));
    });
  }

  it("routes additional-topic subtopics to their own accordion", () => {
    expect(
      describeReviewTarget("modification:mod-1.phase5cFacts", "additional_topics").sectionElementId,
    ).toBe("topic-modifications");
    expect(
      describeReviewTarget("vc:vc-usage.treatment", "additional_topics").sectionElementId,
    ).toBe("topic-variable-consideration");
    expect(
      describeReviewTarget("additionalTopic:principal_agent", "additional_topics").sectionElementId,
    ).toBe("additional-topics");
  });

  it("uses the persisted section, never the target-key prefix, for the owning step", () => {
    // The same canonical target reviewed under a different persisted section
    // must follow the persisted section.
    expect(describeReviewTarget("po:po-saas.sspInput", "step_4").sectionElementId).toBe("step-4");
    expect(describeReviewTarget("po:po-saas.sspInput", "step_2").sectionElementId).toBe("step-2");
  });

  it("opens Step 5 for measured usage quantities whatever section filed the item", () => {
    // Usage actuals are only ever entered in Step 5, so a Step 3 filing must
    // not open Step 3 and leave the control hidden.
    const component = describeReviewTarget("vc:vc-usage.usagePeriods", "step_3");
    expect(component.kind).toBe("exact");
    expect(component.sectionElementId).toBe("step-5");
    expect(component.anchorId).toBe(reviewTargetAnchorId("vc:vc-usage.usagePeriods"));

    const row = describeReviewTarget("vc:vc-usage.usagePeriods.vc-usage-p1", "step_3");
    expect(row.kind).toBe("exact");
    expect(row.sectionElementId).toBe("step-5");
    expect(row.anchorId).toBe(reviewTargetAnchorId("vc:vc-usage.usagePeriods.vc-usage-p1"));

    // A different row and a different component never share an anchor.
    expect(row.anchorId).not.toBe(
      describeReviewTarget("vc:vc-usage.usagePeriods.vc-usage-p2", "step_3").anchorId,
    );
    expect(row.anchorId).not.toBe(
      describeReviewTarget("vc:vc-other.usagePeriods.vc-usage-p1", "step_3").anchorId,
    );

    // Other variable-consideration fields keep following the persisted section.
    expect(describeReviewTarget("vc:vc-usage.treatment", "step_3").sectionElementId).toBe("step-3");
  });

  it("derives a stable DOM anchor that is safe as an id", () => {
    const anchor = reviewTargetAnchorId("po:po-saas.recognitionMethod");
    expect(anchor).toBe(reviewTargetAnchorId("po:po-saas.recognitionMethod"));
    expect(anchor).toMatch(/^ai-review-target-[a-z0-9-]+$/);
    expect(anchor).not.toBe(reviewTargetAnchorId("po:po-other.recognitionMethod"));
  });
});

describe("Task 7 evidence labels", () => {
  it("names a single text page", () => {
    const citation = { pageStart: 4, pageEnd: 4, citationIndex: 0, evidenceModes: ["text"] as const, excerpts: ["x"] };
    expect(citationLabel(citation)).toBe("Source Evidence · Page 4");
    expect(citationOpenAccessibleLabel(citation, 1, false)).toBe("Open PDF — Page 4");
  });

  it("names a page range", () => {
    const citation = { pageStart: 4, pageEnd: 5, citationIndex: 0, evidenceModes: ["text"] as const, excerpts: ["x"] };
    expect(citationLabel(citation)).toBe("Source Evidence · Pages 4–5");
    expect(citationOpenAccessibleLabel(citation, 2, true)).toBe(
      "Open PDF — Source Evidence 2, Pages 4–5",
    );
  });

  it("does not expose evidence mode in visible copy", () => {
    expect(
      citationLabel({ pageStart: 4, pageEnd: 4, citationIndex: 0, evidenceModes: ["visual"], excerpts: [] }),
    ).toBe("Source Evidence · Page 4");
  });
});

describe("Task 7 resolution copy", () => {
  it("describes an edit-driven resolution as an accounting edit", () => {
    expect(
      resolutionSummary({ kind: "affirmed", at: "2026-01-01T00:00:00Z", method: "edited" }),
    ).toBe("Resolved by editing the accounting conclusion");
  });

  it("describes an individual affirmation as a confirmation", () => {
    expect(
      resolutionSummary({ kind: "affirmed", at: "2026-01-01T00:00:00Z", method: "individual" }),
    ).toBe("Confirmed");
  });

  it("describes a manual red resolution by its accepted reason", () => {
    expect(
      resolutionSummary({
        kind: "manual_red",
        at: "2026-01-01T00:00:00Z",
        reason: "not_applicable",
        note: null,
      }),
    ).toBe("Not applicable");
  });

  it("offers exactly the three accepted manual red reasons", () => {
    expect(MANUAL_RED_REASON_OPTIONS.map((option) => option.value)).toEqual([
      "reviewed_current_treatment",
      "outside_source_information",
      "not_applicable",
    ]);
    for (const option of MANUAL_RED_REASON_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.helper.length).toBeGreaterThan(0);
    }
  });

  it("matches the accepted server note bound", () => {
    expect(REVIEW_NOTE_MAX_LENGTH).toBe(2000);
  });
});

describe("Task 7 provenance badges", () => {
  it("describes AI-owned presentation states only", () => {
    expect(provenanceBadgeLabel("ai_generated_untouched")).toBe("AI drafted");
    expect(provenanceBadgeLabel("ai_generated_user_edited")).toBe("AI drafted · edited");
    expect(provenanceBadgeLabel("ai_difference_preserved_user_override")).toBe(
      "Your value preserved",
    );
  });

  it("never badges ordinary manual or historical accounting input", () => {
    expect(provenanceBadgeLabel("manual_from_start")).toBeNull();
    expect(provenanceBadgeLabel("prior_finalized")).toBeNull();
  });
});

describe("aiReviewFinalizeBlock", () => {
  const base = {
    hasAnalysis: true,
    assumptionItems: [],
    assumptionCount: 0,
    reviewPayloadMalformed: false,
    reviewItems: [] as { state: string }[],
  };

  it("never blocks when AI was never run", () => {
    expect(aiReviewFinalizeBlock({ ...base, hasAnalysis: false })).toBeNull();
    expect(aiReviewFinalizeBlock(null)).toBeNull();
  });

  it("does not block when every AI review item is resolved", () => {
    expect(aiReviewFinalizeBlock({ ...base, reviewItems: [{ state: "resolved" }] })).toBeNull();
  });

  it("blocks on outstanding review items", () => {
    expect(
      aiReviewFinalizeBlock({ ...base, reviewItems: [{ state: "red" }, { state: "resolved" }] }),
    ).toMatch(/1 AI review item/);
  });

  it("blocks when the persisted review state could not be read", () => {
    expect(aiReviewFinalizeBlock({ ...base, reviewPayloadMalformed: true })).toMatch(
      /could not be read/i,
    );
  });
});
