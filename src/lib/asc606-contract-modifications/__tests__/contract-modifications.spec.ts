import { describe, expect, it } from "vitest";

import { analyzeContractModification } from "../index";

/** Resolves the ordinary prospective revenue source for a modified obligation. */
const prospectiveSourceId = (
  analysis: ReturnType<typeof analyzeContractModification>,
  poId: string,
) =>
  analysis.revenueSources.find(
    (source) =>
      source.modificationPoId === poId &&
      (source.sourceType === "prospective_modified_po" ||
        source.sourceType === "mixed_prospective_po"),
  )?.id ?? "";
import { case9SeparateContract, case10Prospective, case11CatchUp, case12Mixed } from "./fixtures";

const monthTotal = (analysis: ReturnType<typeof analyzeContractModification>, month: string) =>
  analysis.revenueSchedule!.byMonth.find((row) => row.month === month)?.totalCents ?? 0;

const sourceAmount = (
  analysis: ReturnType<typeof analyzeContractModification>,
  poId: string,
  month: string,
) =>
  analysis.revenueSchedule!.byMonth.find((row) => row.month === month)?.perPo[
    prospectiveSourceId(analysis, poId)
  ] ?? 0;

const yearTotal = (analysis: ReturnType<typeof analyzeContractModification>, year: string) =>
  analysis
    .revenueSchedule!.byMonth.filter((row) => row.month.startsWith(year))
    .reduce((total, row) => total + row.totalCents, 0);

describe("Case 9 — separate contract (ASC 606-10-25-12)", () => {
  const analysis = analyzeContractModification(case9SeparateContract());

  it("derives separate-contract treatment", () => {
    expect(analysis.validation.blockingFailures).toEqual([]);
    expect(analysis.classification!.treatment).toBe("separate_contract");
    expect(analysis.classification!.label).toBe("Separate contract — ASC 606-10-25-12");
  });

  it("keeps the original contract untouched and creates a second presentation group", () => {
    expect(analysis.groups.map((g) => g.transactionPriceCents)).toEqual([24_000_000, 9_000_000]);
    expect(analysis.totals.lifecycleConsiderationCents).toBe(33_000_000);
    expect(analysis.totals.catchUpCents).toBe(0);
    expect(analysis.catchUpEvents).toEqual([]);
    expect(analysis.reconciliation.reconciled).toBe(true);
  });

  it("splits the lifecycle audit into history and future without touching either schedule", () => {
    const originalSchedule = analysis.groups[0]!.revenueSchedule;
    const separateSchedule = analysis.groups[1]!.revenueSchedule;
    const originalBefore = originalSchedule.byMonth.map((row) => row.totalCents);
    const separateBefore = separateSchedule.byMonth.map((row) => row.totalCents);
    const combinedBefore = analysis.revenueSchedule!.byMonth.map((row) => row.totalCents);

    expect(analysis.historicalCutoffDate).toBe("2027-06-30");
    expect(analysis.totals.historicalRevenueCents).toBe(5_942_544);
    expect(analysis.totals.futureRevenueCents).toBe(27_057_456);
    expect(analysis.totals.catchUpCents).toBe(0);
    expect(
      analysis.totals.historicalRevenueCents +
        analysis.totals.catchUpCents +
        analysis.totals.futureRevenueCents,
    ).toBe(33_000_000);

    // Schedules are audit-inert: nothing is truncated, rebased or reallocated.
    const rerun = analyzeContractModification(case9SeparateContract());
    expect(rerun.groups[0]!.revenueSchedule.byMonth.map((r) => r.totalCents)).toEqual(
      originalBefore,
    );
    expect(rerun.groups[0]!.revenueSchedule.totalCents).toBe(24_000_000);
    expect(rerun.groups[1]!.revenueSchedule.byMonth.map((r) => r.totalCents)).toEqual(
      separateBefore,
    );
    expect(rerun.groups[1]!.revenueSchedule.totalCents).toBe(9_000_000);
    expect(rerun.revenueSchedule!.byMonth.map((r) => r.totalCents)).toEqual(combinedBefore);
    expect(rerun.revenueSchedule!.totalCents).toBe(33_000_000);
  });


  it("recognizes the added seats over their own service period", () => {
    const added = analysis.groups[1]!.revenueSchedule;
    expect(added.byMonth.map((row) => row.totalCents)).toEqual([
      507_273, 507_272, 490_910, 507_272, 490_909, 507_273, 507_273, 474_545, 507_273, 490_909,
      507_273, 490_909, 507_273, 507_272, 490_909, 507_273, 490_909, 507_273,
    ]);
    expect(added.totalCents).toBe(9_000_000);
  });

  it("reports combined revenue by calendar year", () => {
    expect(yearTotal(analysis, "2027")).toBe(14_994_493);
    expect(yearTotal(analysis, "2028")).toBe(18_005_507);
  });
});

describe("Case 10 — prospective (ASC 606-10-25-13(a))", () => {
  const analysis = analyzeContractModification(case10Prospective());

  it("derives prospective treatment and preserves history", () => {
    expect(analysis.classification!.treatment).toBe("prospective");
    expect(analysis.totals.historicalRevenueCents).toBe(6_000_000);
    expect(analysis.totals.unrecognizedOriginalConsiderationCents).toBe(6_000_000);
    expect(analysis.totals.remainingTransactionPriceCents).toBe(7_800_000);
    expect(analysis.totals.catchUpCents).toBe(0);
    expect(analysis.groups).toHaveLength(1);
  });

  it("allocates the remaining consideration on remaining standalone selling prices", () => {
    const rows = analysis.allocationLayers![0]!.rows;
    expect(rows.map((row) => row.allocatedCents)).toEqual([5_200_000, 2_600_000]);
    expect(analysis.reconciliation.reconciled).toBe(true);
    expect(analysis.totals.scheduledRevenueCents).toBe(13_800_000);
  });
});

describe("Case 11 — cumulative catch-up (ASC 606-10-25-13(b))", () => {
  it("recognizes a positive catch-up on the effective date", () => {
    const analysis = analyzeContractModification(case11CatchUp(15_000_000));
    expect(analysis.classification!.treatment).toBe("cumulative_catch_up");
    expect(analysis.totals.historicalRevenueCents).toBe(6_000_000);
    expect(analysis.catchUpEvents[0]!.revisedCumulativeCents).toBe(7_500_000);
    expect(analysis.totals.catchUpCents).toBe(1_500_000);
    expect(analysis.totals.futureRevenueCents).toBe(7_500_000);
    expect(analysis.totals.lifecycleConsiderationCents).toBe(15_000_000);
    expect(analysis.reconciliation.reconciled).toBe(true);
    expect(analysis.catchUpEvents[0]!.month).toBe("2028-07");
  });

  it("recognizes a negative catch-up when consideration is reduced", () => {
    const analysis = analyzeContractModification(case11CatchUp(9_000_000));
    expect(analysis.totals.catchUpCents).toBe(-1_500_000);
    expect(analysis.totals.futureRevenueCents).toBe(4_500_000);
    expect(analysis.totals.scheduledRevenueCents).toBe(9_000_000);
    expect(analysis.reconciliation.reconciled).toBe(true);
    expect(monthTotal(analysis, "2028-07")).toBeLessThan(0);
  });
});

describe("Case 12 — mixed modification (ASC 606-10-25-13(c))", () => {
  it("Policy A allocates the updated total transaction price", () => {
    const analysis = analyzeContractModification(case12Mixed("updated_total_transaction_price"));
    expect(analysis.classification!.treatment).toBe("mixed");
    expect(analysis.totals.updatedTotalTransactionPriceCents).toBe(25_000_000);
    expect(analysis.allocationLayers![0]!.rows.map((r) => r.allocatedCents)).toEqual([
      15_000_000, 6_666_667, 3_333_333,
    ]);
    expect(analysis.totals.catchUpCents).toBe(1_500_000);
    expect(analysis.totals.historicalRevenueCents).toBe(6_000_000);
    // Prospective distinct obligations: training plus added support.
    expect(sourceAmount(analysis, "mpo-training", "2028-10")).toBe(6_666_667);
    expect(sourceAmount(analysis, "mpo-support", "2028-11")).toBe(3_333_333);
    expect(analysis.reconciliation.reconciled).toBe(true);
  });

  it("Policy B allocates the updated remaining transaction price", () => {
    const analysis = analyzeContractModification(
      case12Mixed("updated_remaining_transaction_price"),
    );
    expect(analysis.totals.remainingTransactionPriceCents).toBe(19_000_000);
    expect(analysis.allocationLayers![0]!.rows.map((r) => r.allocatedCents)).toEqual([
      9_500_000, 6_333_333, 3_166_667,
    ]);
    expect(analysis.catchUpEvents[0]!.entitlementBasisCents).toBe(15_500_000);
    expect(analysis.totals.catchUpCents).toBe(1_750_000);
    expect(sourceAmount(analysis, "mpo-training", "2028-10")).toBe(6_333_333);
    expect(sourceAmount(analysis, "mpo-support", "2028-11")).toBe(3_166_667);
    expect(analysis.reconciliation.reconciled).toBe(true);
    expect(analysis.totals.scheduledRevenueCents).toBe(25_000_000);
  });
});

describe("modification controls", () => {
  it("blocks a point-in-time obligation transferring on the effective date", () => {
    const input = case12Mixed("updated_total_transaction_price");
    input.contractModifications[0]!.postModificationPerformanceObligations[1]!.recognitionDate =
      "2028-07-02";
    const analysis = analyzeContractModification(input);
    expect(analysis.validation.blockingFailures.map((f) => f.id)).toContain(
      "modification.po.same_day",
    );
    expect(analysis.revenueSchedule).toBeNull();
    expect(analysis.reconciliation.reconciled).toBeNull();
  });

  it("blocks a mixed modification with no allocation policy", () => {
    const input = case12Mixed("updated_total_transaction_price");
    delete input.contractModifications[0]!.mixedAllocationPolicy;
    const analysis = analyzeContractModification(input);
    expect(analysis.validation.blockingFailures.map((f) => f.id)).toContain(
      "modification.mixed_policy",
    );
  });

  it("blocks a reduction that leaves negative remaining consideration", () => {
    const input = case10Prospective();
    input.contractModifications[0]!.considerationEffect = "decrease";
    input.contractModifications[0]!.considerationMagnitudeCents = 10_000_000;
    const analysis = analyzeContractModification(input);
    expect(analysis.validation.blockingFailures.length).toBeGreaterThan(0);
    expect(analysis.revenueSchedule).toBeNull();
  });

  it("blocks an original obligation that is neither continued nor removed", () => {
    const input = case12Mixed("updated_total_transaction_price");
    input.contractModifications[0]!.postModificationPerformanceObligations.splice(1, 1);
    const analysis = analyzeContractModification(input);
    expect(analysis.validation.blockingFailures.map((f) => f.id)).toContain(
      "modification.original.accounted",
    );
  });
});
