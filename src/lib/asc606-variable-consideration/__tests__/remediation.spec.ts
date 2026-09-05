/**
 * Phase 5B remediation regressions for the pure engine:
 *
 *  - catch-up is measured at the exact effective date of a change, against the
 *    allocation state produced by strictly earlier changes only;
 *  - a negative allocation is a blocking validation result, never a thrown
 *    exception, and never accompanied by authoritative output;
 *  - usage must be reported for every month of the target service period.
 *
 * All companies, customers and amounts are fictional.
 */

import { describe, expect, it } from "vitest";

import type { PerformanceObligationInput } from "@/lib/asc606";
import { analyzeVariableConsideration } from "../index";
import type { EstimatedComponentInput, VcContractInput } from "../types";
import { cloudAiInput, D } from "./fixtures";

const ANNUAL_SERIES: PerformanceObligationInput = {
  id: "po-platform",
  seq: 1,
  name: "Annual platform service",
  sspCents: D(36_500),
  sspBasis: "Observable list pricing.",
  classification: "series",
  recognitionMethod: "over_time_ratable",
  serviceStart: "2027-01-01",
  serviceEnd: "2027-12-31",
  overTimeConvention: "daily_ratable",
};

function increase(
  id: string,
  effectiveDate: string,
  includedCents: number,
  seq: number,
): EstimatedComponentInput["remeasurements"][number] {
  return {
    id,
    seq,
    effectiveDate,
    outcomes: [{ id: `${id}-o1`, seq: 1, amountCents: includedCents, isMostLikely: true }],
    includedCents,
    constraintRationale: "A significant revenue reversal is not probable.",
  };
}

function baseComponent(
  remeasurements: EstimatedComponentInput["remeasurements"],
): EstimatedComponentInput {
  return {
    id: "vc-bonus",
    seq: 1,
    description: "Performance bonus",
    effect: "increase",
    estimationMethod: "most_likely_amount",
    allocationTreatment: "general",
    allocationRationale: "The bonus relates to the contract as a whole.",
    inception: {
      id: "vc-bonus-inception",
      seq: 1,
      effectiveDate: "2027-01-01",
      outcomes: [{ id: "i1", seq: 1, amountCents: 0, isMostLikely: true }],
      includedCents: 0,
      constraintRationale: "No amount is included at inception.",
    },
    remeasurements,
  };
}

function contract(component: EstimatedComponentInput): VcContractInput {
  return {
    fixedConsiderationCents: D(36_500),
    standardPerformanceObligations: [ANNUAL_SERIES],
    materialRights: [],
    estimatedComponents: [component],
    usageComponents: [],
  };
}

describe("catch-up uses the exact effective date", () => {
  it("measures a 7/1/2027 increase over 181 elapsed days, not the whole of July", () => {
    const result = analyzeVariableConsideration(
      contract(baseComponent([increase("rm-1", "2027-07-01", D(12_000), 2)])),
    );
    expect(result.validation.blockingFailures).toEqual([]);
    const event = result.changeEvents.find((e) => e.effectiveDate === "2027-07-01")!;
    expect(event.transactionPriceChangeCents).toBe(D(12_000));
    expect(event.catchUpCents).toBe(598_356);
    expect(event.futureImpactCents).toBe(D(12_000) - 598_356);
  });

  it("measures a second same-month change against the state after the first", () => {
    const result = analyzeVariableConsideration(
      contract(
        baseComponent([
          increase("rm-1", "2027-07-01", D(12_000), 2),
          increase("rm-2", "2027-07-16", D(15_650), 3),
        ]),
      ),
    );
    expect(result.validation.blockingFailures).toEqual([]);
    const first = result.changeEvents.find((e) => e.effectiveDate === "2027-07-01")!;
    const second = result.changeEvents.find((e) => e.effectiveDate === "2027-07-16")!;
    expect(first.catchUpCents).toBe(598_356);
    expect(second.transactionPriceChangeCents).toBe(D(3_650));
    expect(second.catchUpCents).toBe(197_000);
  });
});

describe("negative allocation is blocked, not thrown", () => {
  const twoPos: PerformanceObligationInput[] = [
    { ...ANNUAL_SERIES, id: "po-a", name: "Service A", sspCents: D(50) },
    {
      id: "po-b",
      seq: 2,
      name: "Service B",
      sspCents: D(50),
      sspBasis: "Observable.",
      classification: "single_distinct",
      recognitionMethod: "point_in_time",
      recognitionDate: "2027-01-15",
    },
  ];

  const decrease: EstimatedComponentInput = {
    id: "vc-penalty",
    seq: 1,
    description: "Service level penalty",
    effect: "decrease",
    estimationMethod: "most_likely_amount",
    allocationTreatment: "specific_po",
    targetPoId: "po-b",
    relatesSpecificallyToPo: true,
    consistentWithAllocationObjective: true,
    allocationRationale: "The penalty relates specifically to Service B.",
    inception: {
      id: "vc-penalty-inception",
      seq: 1,
      effectiveDate: "2027-01-01",
      outcomes: [{ id: "p1", seq: 1, amountCents: D(60), isMostLikely: true }],
      includedCents: D(60),
      constraintRationale: "A reversal is not probable.",
    },
    remeasurements: [],
  };

  it("reports a blocking validation result instead of throwing", () => {
    let result: ReturnType<typeof analyzeVariableConsideration>;
    expect(() => {
      result = analyzeVariableConsideration({
        fixedConsiderationCents: D(100),
        standardPerformanceObligations: twoPos,
        materialRights: [],
        estimatedComponents: [decrease],
        usageComponents: [],
      });
    }).not.toThrow();
    expect(result!.allocation).toBeNull();
    expect(result!.revenueSchedule).toBeNull();
    expect(result!.reconciliation.reconciled).not.toBe(true);
    expect(
      result!.validation.blockingFailures.some((f) => f.id === "vc.allocation.po.nonnegative"),
    ).toBe(true);
  });

  it("blocks when a later remeasurement drives an allocation negative", () => {
    const later: EstimatedComponentInput = {
      ...decrease,
      inception: {
        ...decrease.inception,
        includedCents: D(10),
        outcomes: [{ id: "p1", seq: 1, amountCents: D(10), isMostLikely: true }],
      },
      remeasurements: [
        {
          id: "vc-penalty-rm",
          seq: 2,
          effectiveDate: "2027-06-01",
          outcomes: [{ id: "p2", seq: 1, amountCents: D(90), isMostLikely: true }],
          includedCents: D(90),
          constraintRationale: "A reversal is not probable.",
        },
      ],
    };
    const result = analyzeVariableConsideration({
      fixedConsiderationCents: D(100),
      standardPerformanceObligations: twoPos,
      materialRights: [],
      estimatedComponents: [later],
      usageComponents: [],
    });
    expect(result.allocation).toBeNull();
    expect(
      result.validation.blockingFailures.some((f) => f.id === "vc.allocation.po.nonnegative"),
    ).toBe(true);
  });
});

describe("usage must cover the whole service period", () => {
  it("blocks when a month of the service period is not reported", () => {
    const input = cloudAiInput();
    const component = input.usageComponents[0]!;
    const result = analyzeVariableConsideration({
      ...input,
      usageComponents: [
        { ...component, periods: component.periods.filter((p) => p.month !== "2027-08") },
      ],
    });
    expect(result.revenueSchedule).toBeNull();
    expect(
      result.validation.blockingFailures.some((f) => f.id === "vc.usage.period.complete"),
    ).toBe(true);
  });

  it("accepts explicit zero usage months", () => {
    const result = analyzeVariableConsideration(cloudAiInput());
    expect(result.validation.blockingFailures).toEqual([]);
    expect(result.totals.usageConsiderationCents).toBe(7_200);
  });
});

describe("the running general pool must never go negative", () => {
  function generalDecrease(
    remeasurements: EstimatedComponentInput["remeasurements"],
    resolution?: EstimatedComponentInput["resolution"],
  ): EstimatedComponentInput {
    return {
      id: "vc-penalty",
      seq: 1,
      description: "Contract-wide penalty",
      effect: "decrease",
      estimationMethod: "most_likely_amount",
      allocationTreatment: "general",
      allocationRationale: "The penalty relates to the contract as a whole.",
      inception: {
        id: "vc-penalty-inception",
        seq: 1,
        effectiveDate: "2027-01-01",
        outcomes: [{ id: "p1", seq: 1, amountCents: D(1_000), isMostLikely: true }],
        includedCents: D(1_000),
        constraintRationale: "A reversal is not probable.",
      },
      remeasurements,
      resolution,
    };
  }

  it("blocks when a remeasurement drives the general pool below zero", () => {
    const result = analyzeVariableConsideration(
      contract(
        generalDecrease([
          {
            id: "vc-penalty-rm",
            seq: 2,
            effectiveDate: "2027-06-01",
            outcomes: [{ id: "p2", seq: 1, amountCents: D(40_000), isMostLikely: true }],
            includedCents: D(40_000),
            constraintRationale: "A reversal is not probable.",
          },
        ]),
      ),
    );
    expect(result.allocation).toBeNull();
    expect(result.revenueSchedule).toBeNull();
    expect(
      result.validation.blockingFailures.some((f) => f.id === "vc.allocation.general_pool.nonnegative"),
    ).toBe(true);
  });

  it("blocks when the resolved amount drives the general pool below zero", () => {
    const result = analyzeVariableConsideration(
      contract(
        generalDecrease([], {
          id: "vc-penalty-resolution",
          date: "2027-09-30",
          actualCents: D(50_000),
          rationale: "The final penalty assessed exceeded the estimate.",
        }),
      ),
    );
    expect(result.allocation).toBeNull();
    expect(
      result.validation.blockingFailures.some((f) => f.id === "vc.allocation.general_pool.nonnegative"),
    ).toBe(true);
  });
});

describe("a resolution that drives one allocation negative is blocked", () => {
  it("reports a blocking validation result at resolution, not an exception", () => {
    const pos: PerformanceObligationInput[] = [
      { ...ANNUAL_SERIES, id: "po-a", name: "Service A", sspCents: D(50) },
      {
        id: "po-b",
        seq: 2,
        name: "Service B",
        sspCents: D(50),
        sspBasis: "Observable.",
        classification: "single_distinct",
        recognitionMethod: "point_in_time",
        recognitionDate: "2027-01-15",
      },
    ];
    const component: EstimatedComponentInput = {
      id: "vc-penalty",
      seq: 1,
      description: "Service level penalty",
      effect: "decrease",
      estimationMethod: "most_likely_amount",
      allocationTreatment: "specific_po",
      targetPoId: "po-b",
      relatesSpecificallyToPo: true,
      consistentWithAllocationObjective: true,
      allocationRationale: "The penalty relates specifically to Service B.",
      inception: {
        id: "vc-penalty-inception",
        seq: 1,
        effectiveDate: "2027-01-01",
        outcomes: [{ id: "p1", seq: 1, amountCents: D(10), isMostLikely: true }],
        includedCents: D(10),
        constraintRationale: "A reversal is not probable.",
      },
      remeasurements: [],
      resolution: {
        id: "vc-penalty-resolution",
        date: "2027-08-31",
        actualCents: D(95),
        rationale: "The final penalty assessed exceeded the estimate.",
      },
    };
    let result: ReturnType<typeof analyzeVariableConsideration>;
    expect(() => {
      result = analyzeVariableConsideration({
        fixedConsiderationCents: D(100),
        standardPerformanceObligations: pos,
        materialRights: [],
        estimatedComponents: [component],
        usageComponents: [],
      });
    }).not.toThrow();
    expect(result!.allocation).toBeNull();
    expect(
      result!.validation.blockingFailures.some((f) => f.id === "vc.allocation.po.nonnegative"),
    ).toBe(true);
  });
});
