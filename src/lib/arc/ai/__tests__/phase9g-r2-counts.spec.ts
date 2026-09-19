/**
 * Phase 9G-R Task R2 — part A. One definition of outstanding accountant work.
 *
 * `assumed` is explicitly non-actionable and non-blocking, so it must never be
 * counted anywhere `reviewIssueCount` means "work the accountant still owes".
 * Every count path in the product is proved here against the same rows.
 */

import { describe, expect, it } from "vitest";

import { outstandingIssueCount } from "../orchestrator";
import { partitionAiReviewItems } from "../review-dto";
import { aiReviewFinalizeBlock } from "../review-presentation";
import { aiFinalizationIssues } from "@/lib/arc/persistence/revisions.handlers";

import { assumptionsOnlyRows, mixedReviewRows, reviewRow } from "./r2-fixtures";

describe("Phase 9G-R Task R2 — outstanding review counts", () => {
  it("counts yellow and red only across a mixed queue", () => {
    expect(outstandingIssueCount(mixedReviewRows())).toBe(2);
    expect(partitionAiReviewItems(mixedReviewRows()).outstandingActionableCount).toBe(2);
  });

  it("reports zero outstanding work when only assumptions exist", () => {
    expect(outstandingIssueCount(assumptionsOnlyRows())).toBe(0);
    expect(partitionAiReviewItems(assumptionsOnlyRows()).outstandingActionableCount).toBe(0);
  });

  it("lets an assumptions-only revision finalize", () => {
    const partition = partitionAiReviewItems(assumptionsOnlyRows());
    expect(
      aiReviewFinalizeBlock({
        hasAnalysis: true,
        reviewPayloadMalformed: false,
        reviewItems: partition.reviewItems,
      }),
    ).toBeNull();
    expect(
      aiFinalizationIssues({
        reviewItems: assumptionsOnlyRows(),
        hasActiveRun: false,
        reviewPayloadMalformed: false,
      }),
    ).toEqual([]);
  });

  it("still blocks finalization on a real actionable item", () => {
    expect(
      aiFinalizationIssues({
        reviewItems: mixedReviewRows(),
        hasActiveRun: false,
        reviewPayloadMalformed: false,
      }),
    ).toHaveLength(2);
  });

  it("reports assumptions independently of the actionable count", () => {
    const partition = partitionAiReviewItems(mixedReviewRows());
    expect(partition.assumptionItems).toHaveLength(1);
    expect(partition.outstandingActionableCount).toBe(2);
  });

  it("keeps assumptions out of the browser review queue", () => {
    const partition = partitionAiReviewItems(mixedReviewRows());
    expect(partition.reviewItems.map((item) => item.state)).toEqual(["yellow", "red", "resolved"]);
    expect(partition.assumptionItems.every((item) => item.state === "assumed")).toBe(true);
  });

  it("exposes no resolution or affirmation on an assumption DTO", () => {
    const [assumption] = partitionAiReviewItems([reviewRow("a", "assumed")]).assumptionItems;
    expect(assumption?.resolution ?? null).toBeNull();
  });
});
