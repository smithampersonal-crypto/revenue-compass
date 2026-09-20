/**
 * Phase 9G-R3, Section K9. AI re-analysis never overwrites an accountant's
 * own R3 operational facts.
 *
 * The comparison is the COMPLETE R3 fact set — transfer status and date,
 * measure of progress, denominator, unit label, every progress event, the
 * usage meter and its included quantity, every actual usage period and
 * quantity, declared service periods, realized service-level events and the
 * bill-on-realization judgment — compared canonically, not a sample of it.
 *
 * Everything runs through the real `mergeAiAnalysis()` and the authoritative
 * `analyzeWorkflow()`. No schema or prompt version is involved.
 */
import { describe, expect, it } from "vitest";

import { analyzeWorkflow, type WorkflowDraft } from "@/lib/asc606-workflow";
import {
  genomixBenchmarkDraft,
  r3OperationalFacts,
  withRealizedCredit,
  withSupportHours,
  withUsageActual,
  withValidationTransfer,
} from "@/lib/asc606-workflow/__tests__/genomix-k-fixture";

import { createEmptyAiAnalysisState, mergeAiAnalysis } from "../merge";
import { canonicalReviewTargetFingerprint } from "../edit-reconciliation";
import { fixtureAAnalysis, guidancePackFixture, RUN_ID } from "./merge-fixtures";

const OPERATIONAL_TARGETS = [
  "po:po-validation.transferStatus",
  "po:po-validation.recognitionDate",
  "po:po-support.overTimeMeasure",
  "po:po-support.totalExpectedUnitsInput",
  "po:po-support.unitLabel",
  "po:po-support.progressEvents",
  "vc:vc-sla.seriesPeriods",
  "vc:vc-sla.realizedEvents",
  "vc:vc-sla.billOnRealization",
  "vc:vc-usage.usagePeriods",
  "vc:vc-usage.meter.rateAmountInput",
  "vc:vc-usage.meter.includedQuantityInput",
] as const;

/** The contract as the accountant has actually lived it. */
function livedContract(): WorkflowDraft {
  return withRealizedCredit(
    withUsageActual(
      withSupportHours(withValidationTransfer(genomixBenchmarkDraft(), "2027-03-15"), [
        { id: "po-support-pe-1", seq: 1, date: "2027-01-31", unitsInput: "150" },
      ]),
      "2027-02",
      "500",
    ),
    "1,500.00",
    "y1",
    "2027-04-30",
  );
}

function reanalyze(draft: WorkflowDraft): WorkflowDraft {
  return mergeAiAnalysis({
    currentDraft: draft,
    currentAiState: createEmptyAiAnalysisState(),
    analysis: fixtureAAnalysis(),
    runId: RUN_ID,
    guidancePack: guidancePackFixture(),
    priorContext: null,
  }).draft;
}

describe("K9 — AI re-analysis preserves every accountant-owned R3 fact", () => {
  const draft = livedContract();
  const merged = reanalyze(draft);

  it("leaves the complete operational fact set canonically unchanged", () => {
    expect(r3OperationalFacts(merged)).toEqual(r3OperationalFacts(draft));
  });

  it("leaves every operational review conclusion's material fingerprint unchanged", () => {
    for (const key of OPERATIONAL_TARGETS) {
      expect(`${key}:${canonicalReviewTargetFingerprint(merged, key)}`).toBe(
        `${key}:${canonicalReviewTargetFingerprint(draft, key)}`,
      );
    }
  });

  it("still measures support progress from the accountant's own hours", () => {
    // The AI fixture may propose its own obligations and prices, so the
    // absolute allocation can legitimately move. What may never move is the
    // measure of progress: it comes from hours the accountant recorded.
    const ratio = (candidate: WorkflowDraft) => {
      const result = analyzeWorkflow(candidate);
      expect(result.blockedReason).toBeNull();
      const allocated = result.progressive!.allocation!.find(
        (row) => row.poId === "po-support",
      )!.allocatedCents;
      const recognized = result
        .progressive!.recognition!.schedule.byPo.filter((row) => row.poId === "po-support")
        .reduce((sum, row) => sum + row.revenueCents, 0);
      return recognized / allocated;
    };
    // 150 of 300 contracted hours.
    expect(ratio(draft)).toBeCloseTo(0.5, 5);
    expect(ratio(merged)).toBeCloseTo(0.5, 5);
  });

  it("keeps the authoritative analysis running through analyzeWorkflow()", () => {
    const result = analyzeWorkflow(merged);
    expect(result.adapterErrors).toEqual([]);
    expect(result.progressive).not.toBeNull();
  });

  it("is stable under a second re-analysis", () => {
    expect(r3OperationalFacts(reanalyze(merged))).toEqual(r3OperationalFacts(draft));
  });
});
