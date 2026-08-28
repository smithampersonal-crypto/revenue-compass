/**
 * ASC 606 validation suite — Phase 1 scenarios (Tests 1-7, 11, 12).
 *
 * Every monetary expectation below is a predetermined integer-cent value taken
 * from the approved specification, asserted with toBe(). No test recomputes the
 * implementation formula to compare the engine against itself.
 */

import { describe, expect, it } from "vitest";

import { analyzePhase1 } from "../index";
import { allocateTransactionPrice } from "../allocation";
import { deriveDistinctConclusion } from "../types";
import { overTimePo, pointInTimePo, promise } from "./fixtures";

const monthTotals = (analysis: ReturnType<typeof analyzePhase1>) =>
  analysis.revenueSchedule!.byMonth.map((row) => row.totalCents);

describe("Test 1 — annual SaaS, daily ratable", () => {
  const analysis = analyzePhase1({
    transactionPriceCents: 12_000_000,
    performanceObligations: [overTimePo({ id: "po1", seq: 1, sspCents: 12_000_000, name: "SaaS Platform Access" })],
  });

  it("recognizes revenue on a pure daily basis", () => {
    expect(monthTotals(analysis)).toEqual([
      1_019_178, 920_548, 1_019_178, 986_301, 1_019_178, 986_301, 1_019_178, 1_019_178, 986_301,
      1_019_178, 986_301, 1_019_180,
    ]);
  });

  it("ties to the transaction price and spans the recognition horizon", () => {
    expect(analysis.revenueSchedule!.totalCents).toBe(12_000_000);
    expect(analysis.revenueSchedule!.firstMonth).toBe("2027-01");
    expect(analysis.revenueSchedule!.lastMonth).toBe("2027-12");
    expect(analysis.validation.status).toBe("passed");
  });
});

describe("Test 2 — mid-month commencement", () => {
  const analysis = analyzePhase1({
    transactionPriceCents: 3_510_000,
    performanceObligations: [
      overTimePo({ id: "po1", seq: 1, sspCents: 3_510_000, serviceStart: "2027-01-15", serviceEnd: "2027-12-31" }),
    ],
  });

  it("prorates the stub month on calendar days ($100.00/day over 351 days)", () => {
    expect(monthTotals(analysis)).toEqual([
      170_000, 280_000, 310_000, 300_000, 310_000, 300_000, 310_000, 310_000, 300_000, 310_000,
      300_000, 310_000,
    ]);
    expect(analysis.revenueSchedule!.totalCents).toBe(3_510_000);
  });
});

describe("Test 3 — leap year", () => {
  const analysis = analyzePhase1({
    transactionPriceCents: 36_600_000,
    performanceObligations: [
      overTimePo({ id: "po1", seq: 1, sspCents: 36_600_000, serviceStart: "2028-01-01", serviceEnd: "2028-12-31" }),
    ],
  });

  it("spreads $1,000.00 per day across 366 days", () => {
    expect(monthTotals(analysis)).toEqual([
      3_100_000, 2_900_000, 3_100_000, 3_000_000, 3_100_000, 3_000_000, 3_100_000, 3_100_000,
      3_000_000, 3_100_000, 3_000_000, 3_100_000,
    ]);
    expect(analysis.revenueSchedule!.byMonth[1]!.month).toBe("2028-02");
    expect(analysis.revenueSchedule!.byMonth[1]!.totalCents).toBe(2_900_000);
    expect(analysis.revenueSchedule!.totalCents).toBe(36_600_000);
  });
});

describe("Test 4 — relative SSP allocation across multiple POs", () => {
  const allocation = allocateTransactionPrice({
    transactionPriceCents: 12_000_000,
    performanceObligations: [
      overTimePo({ id: "saas", seq: 1, sspCents: 12_000_000, name: "SaaS" }),
      pointInTimePo({ id: "training", seq: 2, sspCents: 2_000_000, name: "Training" }),
    ],
  });

  it("allocates $102,857.14 and $17,142.86", () => {
    expect(allocation[0]!.allocatedCents).toBe(10_285_714);
    expect(allocation[1]!.allocatedCents).toBe(1_714_286);
    expect(allocation[0]!.allocatedCents + allocation[1]!.allocatedCents).toBe(12_000_000);
    expect(allocation[0]!.totalSspCents).toBe(14_000_000);
  });
});

describe("Test 5 — equal SSP penny residual", () => {
  const allocation = allocateTransactionPrice({
    transactionPriceCents: 10_000_000,
    performanceObligations: [
      overTimePo({ id: "a", seq: 1, sspCents: 1_000_000 }),
      overTimePo({ id: "b", seq: 2, sspCents: 1_000_000 }),
      overTimePo({ id: "c", seq: 3, sspCents: 1_000_000 }),
    ],
  });

  it("gives the residual cent to the lowest sequence on a remainder tie", () => {
    expect(allocation.map((row) => row.allocatedCents)).toEqual([3_333_334, 3_333_333, 3_333_333]);
    expect(allocation.reduce((total, row) => total + row.allocatedCents, 0)).toBe(10_000_000);
  });
});

describe("Test 6 — multiple promises grouped into one performance obligation", () => {
  const promises = [
    promise("pr1", 1, "SaaS platform access", true, false, "po1"),
    promise("pr2", 2, "Implementation services", true, false, "po1"),
    promise("pr3", 3, "Training", true, true, "po2"),
  ];

  const analysis = analyzePhase1({
    transactionPriceCents: 13_500_000,
    promises,
    performanceObligations: [
      overTimePo({
        id: "po1",
        seq: 1,
        sspCents: 13_000_000,
        name: "SaaS platform access and implementation",
        classification: "bundle_not_distinct",
      }),
      pointInTimePo({ id: "po2", seq: 2, sspCents: 2_000_000, name: "Training", recognitionDate: "2027-02-10" }),
    ],
  });

  it("allocates only at the PO level, not to the underlying promises", () => {
    expect(analysis.allocation).toHaveLength(2);
    expect(analysis.allocation!.map((row) => row.poId)).toEqual(["po1", "po2"]);
    expect(analysis.allocation![0]!.allocatedCents).toBe(11_700_000);
    expect(analysis.allocation![1]!.allocatedCents).toBe(1_800_000);
  });

  it("derives the distinct conclusion from the two Step 2 judgments", () => {
    expect(deriveDistinctConclusion(promises[0]!)).toBe(false);
    expect(deriveDistinctConclusion(promises[1]!)).toBe(false);
    expect(deriveDistinctConclusion(promises[2]!)).toBe(true);
  });
});

describe("Test 7 — SaaS over time plus distinct point-in-time training", () => {
  const analysis = analyzePhase1({
    transactionPriceCents: 12_000_000,
    performanceObligations: [
      overTimePo({ id: "saas", seq: 1, sspCents: 12_000_000, name: "SaaS Platform Access" }),
      pointInTimePo({ id: "training", seq: 2, sspCents: 2_000_000, name: "Training", recognitionDate: "2027-01-15" }),
    ],
  });

  const saas = analysis.revenueSchedule!.byPo.filter((row) => row.poId === "saas");

  it("recognizes training entirely in January", () => {
    const training = analysis.revenueSchedule!.byPo.filter((row) => row.poId === "training");
    expect(training).toHaveLength(1);
    expect(training[0]!.month).toBe("2027-01");
    expect(training[0]!.revenueCents).toBe(1_714_286);
  });

  it("recognizes $8,735.81 of SaaS revenue in January", () => {
    expect(saas[0]!.revenueCents).toBe(873_581);
    expect(saas.map((row) => row.revenueCents)).toEqual([
      873_581, 789_041, 873_581, 845_401, 873_581, 845_401, 873_581, 873_581, 845_401, 873_581,
      845_401, 873_583,
    ]);
  });

  it("reports January total revenue of $25,878.67 and ties to the transaction price", () => {
    expect(analysis.revenueSchedule!.byMonth[0]!.totalCents).toBe(2_587_867);
    expect(analysis.revenueSchedule!.totalCents).toBe(12_000_000);
    expect(analysis.validation.status).toBe("passed");
  });
});

describe("Test 11 — invalid recognition dates", () => {
  const analysis = analyzePhase1({
    transactionPriceCents: 12_000_000,
    performanceObligations: [
      overTimePo({ id: "po1", seq: 1, sspCents: 12_000_000, serviceStart: "2027-12-31", serviceEnd: "2027-01-01" }),
    ],
  });

  it("fails validation and produces no schedule", () => {
    expect(analysis.validation.status).toBe("attention");
    expect(analysis.validation.blockingFailures.map((f) => f.id)).toContain("po.service_dates.sequence");
    expect(analysis.revenueSchedule).toBeNull();
    expect(analysis.allocation).toBeNull();
  });

  it("also flags a missing point-in-time recognition date", () => {
    const missingDate = analyzePhase1({
      transactionPriceCents: 5_000_000,
      performanceObligations: [
        { id: "po1", seq: 1, name: "Training", sspCents: 5_000_000, recognitionMethod: "point_in_time" },
      ],
    });
    expect(missingDate.validation.blockingFailures.map((f) => f.id)).toContain(
      "po.recognition_date.present",
    );
    expect(missingDate.revenueSchedule).toBeNull();
  });
});

describe("Test 12 — missing or zero SSP", () => {
  it("cannot finalize allocation when a PO has zero SSP", () => {
    const analysis = analyzePhase1({
      transactionPriceCents: 12_000_000,
      performanceObligations: [
        overTimePo({ id: "po1", seq: 1, sspCents: 12_000_000 }),
        pointInTimePo({ id: "po2", seq: 2, sspCents: 0 }),
      ],
    });
    expect(analysis.validation.blockingFailures.map((f) => f.id)).toContain("po.ssp.positive");
    expect(analysis.allocation).toBeNull();
    expect(analysis.totals.allocatedCents).toBeNull();
  });

  it("cannot allocate when total SSP is zero", () => {
    const analysis = analyzePhase1({
      transactionPriceCents: 12_000_000,
      performanceObligations: [overTimePo({ id: "po1", seq: 1, sspCents: 0 })],
    });
    expect(analysis.validation.blockingFailures.map((f) => f.id)).toContain(
      "allocation.total_ssp.positive",
    );
    expect(analysis.revenueSchedule).toBeNull();
  });
});
