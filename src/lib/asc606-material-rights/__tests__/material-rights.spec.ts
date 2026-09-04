import { describe, expect, it } from "vitest";

import {
  analyzeMaterialRightLifecycle,
  materialRightSspCents,
  type MaterialRightContractInput,
  type MaterialRightInput,
} from "@/lib/asc606-material-rights";

const SUBSCRIPTION = {
  id: "po-1",
  seq: 1,
  name: "SaaS subscription",
  sspCents: 12_000_000,
  recognitionMethod: "over_time_ratable" as const,
  serviceStart: "2027-01-01",
  serviceEnd: "2027-12-31",
};

function contract(right: MaterialRightInput): MaterialRightContractInput {
  return {
    transactionPriceCents: 12_000_000,
    standardPerformanceObligations: [SUBSCRIPTION],
    materialRights: [right],
  };
}

const OUTSTANDING: MaterialRightInput = {
  id: "po-2",
  seq: 2,
  name: "Discounted renewal option",
  underlyingGoodOrServiceName: "Renewal subscription year 2",
  benefitAmountCents: 2_400_000,
  exerciseProbabilityBps: 8_000,
  status: "outstanding",
};

// Inception allocation (locked for the whole lifecycle):
//   total SSP = 12,000,000 + 1,920,000 = 13,920,000
const EXPECTED_SUBSCRIPTION_ALLOCATION = 10_344_828;
const EXPECTED_RIGHT_ALLOCATION = 1_655_172;

describe("material-right measurement", () => {
  it("multiplies benefit by exercise probability exactly", () => {
    expect(materialRightSspCents(2_400_000, 8_000)).toBe(1_920_000);
    expect(materialRightSspCents(1_000_001, 5_000)).toBe(500_001); // half-up
  });
});

describe("Case 6 — outstanding material right", () => {
  const analysis = analyzeMaterialRightLifecycle(contract(OUTSTANDING));

  it("allocates the original transaction price across the PO and the material right", () => {
    expect(analysis.validation.blockingFailures).toEqual([]);
    expect(analysis.allocation?.map((row) => row.allocatedCents)).toEqual([
      EXPECTED_SUBSCRIPTION_ALLOCATION,
      EXPECTED_RIGHT_ALLOCATION,
    ]);
    expect(analysis.totals.originalAllocatedCents).toBe(12_000_000);
  });

  it("never fabricates recognition dates for an outstanding option", () => {
    expect(analysis.revenueSchedule?.totalCents).toBe(EXPECTED_SUBSCRIPTION_ALLOCATION);
    expect(analysis.totals.unscheduledMaterialRightCents).toBe(EXPECTED_RIGHT_ALLOCATION);
    expect(analysis.revenueSources.map((s) => s.sourceType)).toEqual(["original_po"]);
    expect(analysis.materialRights[0]!.unscheduledCents).toBe(EXPECTED_RIGHT_ALLOCATION);
  });

  it("reconciles scheduled plus unscheduled to lifecycle consideration", () => {
    expect(analysis.totals.lifecycleConsiderationCents).toBe(12_000_000);
    expect(analysis.reconciliation).toEqual({
      scheduledPlusUnscheduledCents: 12_000_000,
      differenceCents: 0,
      reconciled: true,
    });
  });
});

describe("Case 6 — exercised material right", () => {
  const analysis = analyzeMaterialRightLifecycle(
    contract({
      ...OUTSTANDING,
      status: "exercised",
      exercise: {
        exerciseDate: "2027-12-01",
        newConsiderationCents: 2_400_000,
        recognitionMethod: "over_time_ratable",
        serviceStart: "2028-01-01",
        serviceEnd: "2028-12-31",
      },
    }),
  );

  it("keeps the original allocation locked and carries it into the exercise segment", () => {
    expect(analysis.allocation?.map((row) => row.allocatedCents)).toEqual([
      EXPECTED_SUBSCRIPTION_ALLOCATION,
      EXPECTED_RIGHT_ALLOCATION,
    ]);
    expect(analysis.materialRights[0]!.exerciseRecognitionBasisCents).toBe(
      EXPECTED_RIGHT_ALLOCATION + 2_400_000,
    );
    expect(analysis.materialRights[0]!.unscheduledCents).toBe(0);
  });

  it("schedules the exercise segment as its own revenue source", () => {
    const source = analysis.revenueSources.find((s) => s.sourceType === "material_right_exercise");
    expect(source?.id).toBe("po-2::exercise");
    expect(source?.materialRightPoId).toBe("po-2");
    const exerciseRevenue = analysis.revenueSchedule!.byPo.filter((r) => r.poId === source!.id).reduce(
      (t, r) => t + r.revenueCents,
      0,
    );
    expect(exerciseRevenue).toBe(EXPECTED_RIGHT_ALLOCATION + 2_400_000);
    expect(analysis.revenueSchedule!.lastMonth).toBe("2028-12");
  });

  it("reconciles to original price plus new consideration", () => {
    expect(analysis.totals.lifecycleConsiderationCents).toBe(14_400_000);
    expect(analysis.totals.scheduledRevenueCents).toBe(14_400_000);
    expect(analysis.totals.unscheduledMaterialRightCents).toBe(0);
    expect(analysis.reconciliation.reconciled).toBe(true);
  });
});

describe("Case 6 — expired material right", () => {
  const analysis = analyzeMaterialRightLifecycle(
    contract({ ...OUTSTANDING, status: "expired", expirationDate: "2027-12-31" }),
  );

  it("recognizes the allocated amount on expiration and reconciles", () => {
    const row = analysis.revenueSchedule!.byPo.find((r) => r.poId === "po-2::expiration");
    expect(row?.month).toBe("2027-12");
    expect(row?.revenueCents).toBe(EXPECTED_RIGHT_ALLOCATION);
    expect(analysis.totals.scheduledRevenueCents).toBe(12_000_000);
    expect(analysis.totals.unscheduledMaterialRightCents).toBe(0);
    expect(analysis.reconciliation.reconciled).toBe(true);
  });
});

describe("material-right validation blocks authoritative output", () => {
  const cases: Array<[string, MaterialRightInput]> = [
    ["zero probability", { ...OUTSTANDING, exerciseProbabilityBps: 0 }],
    ["probability above 100%", { ...OUTSTANDING, exerciseProbabilityBps: 10_001 }],
    ["non-integer probability", { ...OUTSTANDING, exerciseProbabilityBps: 12.5 }],
    ["zero benefit", { ...OUTSTANDING, benefitAmountCents: 0 }],
    ["exercised without exercise data", { ...OUTSTANDING, status: "exercised" }],
    ["expired without expiration date", { ...OUTSTANDING, status: "expired" }],
    [
      "outstanding carrying exercise data",
      {
        ...OUTSTANDING,
        exercise: {
          exerciseDate: "2027-12-01",
          newConsiderationCents: 1,
          recognitionMethod: "point_in_time",
          recognitionDate: "2027-12-01",
        },
      },
    ],
    [
      "exercise period beyond the supported horizon",
      {
        ...OUTSTANDING,
        status: "exercised",
        exercise: {
          exerciseDate: "2027-12-01",
          newConsiderationCents: 2_400_000,
          recognitionMethod: "over_time_ratable",
          serviceStart: "0002-01-01",
          serviceEnd: "2028-12-31",
        },
      },
    ],
  ];

  for (const [label, right] of cases) {
    it(`blocks: ${label}`, () => {
      const analysis = analyzeMaterialRightLifecycle(contract(right));
      expect(analysis.validation.blockingFailures.length).toBeGreaterThan(0);
      expect(analysis.allocation).toBeNull();
      expect(analysis.revenueSchedule).toBeNull();
      expect(analysis.reconciliation).toEqual({
        scheduledPlusUnscheduledCents: null,
        differenceCents: null,
        reconciled: null,
      });
    });
  }
});
