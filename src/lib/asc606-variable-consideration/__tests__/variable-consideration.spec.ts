import { describe, expect, it } from "vitest";

import { analyzeVariableConsideration } from "..";
import { meterPeriodAmountCents } from "../usage";
import { unconstrainedMagnitudeCents } from "../estimation";
import { case7Input, cloudAiInput, D, CLOUDAI_PLATFORM } from "./fixtures";
import type { EstimatedComponentInput, VcContractInput } from "../types";

const month = (analysis: ReturnType<typeof analyzeVariableConsideration>, key: string) =>
  analysis.revenueSchedule!.byMonth.find((row) => row.month === key)!;

describe("Case 7 — AtlasData / TitanEnergy completion bonus", () => {
  const analysis = analyzeVariableConsideration(case7Input());

  it("produces no blocking validation failures", () => {
    expect(analysis.validation.blockingFailures).toEqual([]);
  });

  it("allocates the fixed consideration on a relative SSP basis", () => {
    const base = Object.fromEntries(analysis.allocation!.base.map((r) => [r.poId, r.allocatedCents]));
    expect(base["po-implementation"]).toBe(D(55_200));
    expect(base["po-saas"]).toBe(D(404_800));
  });

  it("adds the specific bonus entirely to the implementation obligation", () => {
    expect(analysis.allocation!.specific).toEqual([
      {
        componentId: "vc-bonus",
        description: "Implementation completion bonus",
        poId: "po-implementation",
        poName: "Implementation services",
        amountCents: D(30_000),
      },
    ]);
    const final = Object.fromEntries(
      analysis.allocation!.currentFinal.map((r) => [r.poId, r.amountCents]),
    );
    expect(final["po-implementation"]).toBe(D(85_200));
    expect(final["po-saas"]).toBe(D(404_800));
    expect(analysis.totals.initialTransactionPriceCents).toBe(D(490_000));
    expect(analysis.totals.currentEstimatedConsiderationCents).toBe(D(490_000));
    expect(analysis.totals.lifecycleConsiderationCents).toBe(D(490_000));
  });

  it("recognizes implementation point in time on 3/20/2027", () => {
    expect(month(analysis, "2027-03").perPo["po-implementation"]).toBe(D(85_200));
  });

  it("recognizes the SaaS subscription ratably over 4/1/2027 - 3/31/2029", () => {
    const saas = analysis.revenueSchedule!.byPo.filter((row) => row.poId === "po-saas");
    expect(saas.reduce((total, row) => total + row.revenueCents, 0)).toBe(D(404_800));
    expect(saas[0]!.month).toBe("2027-04");
    expect(saas[saas.length - 1]!.month).toBe("2029-03");
  });

  it("records the resolution as a zero change with zero catch-up", () => {
    const resolution = analysis.changeEvents.find((e) => e.isResolution)!;
    expect(resolution.transactionPriceChangeCents).toBe(0);
    expect(resolution.catchUpCents).toBe(0);
    expect(resolution.futureImpactCents).toBe(0);
  });

  it("reconciles exactly", () => {
    expect(analysis.reconciliation.reconciled).toBe(true);
    expect(analysis.reconciliation.differenceCents).toBe(0);
    expect(analysis.revenueSchedule!.totalCents).toBe(D(490_000));
  });
});

describe("CloudAI / Acme Labs metered usage", () => {
  const analysis = analyzeVariableConsideration(cloudAiInput());

  it("calculates each meter-period on exact ratio terms", () => {
    const period = analysis.usagePeriods[0]!;
    expect(period.meters.map((m) => m.amountCents)).toEqual([D(32), D(40)]);
    expect(period.totalCents).toBe(D(72));
  });

  it("adds usage revenue to the January fixed revenue", () => {
    const january = month(analysis, "2027-01");
    expect(january.perPo["po-platform"]).toBe(1_019_178);
    expect(january.perPo["vc-usage::usage"]).toBe(D(72));
    expect(january.totalCents).toBe(1_026_378);
  });

  it("exposes usage as its own deterministic revenue source", () => {
    const source = analysis.revenueSources.find((s) => s.sourceType === "usage")!;
    expect(source.id).toBe("vc-usage::usage");
    expect(source.originalPoId).toBe("po-platform");
  });

  it("reconciles usage into lifecycle consideration", () => {
    expect(analysis.totals.usageConsiderationCents).toBe(D(72));
    expect(analysis.totals.lifecycleConsiderationCents).toBe(D(120_072));
    expect(analysis.reconciliation.reconciled).toBe(true);
  });
});

describe("estimation", () => {
  const assessment = (outcomes: { amountCents: number; probabilityBps: number }[]) => ({
    id: "a",
    seq: 1,
    effectiveDate: "2027-01-01",
    outcomes: outcomes.map((o, i) => ({ id: `o${i}`, seq: i + 1, ...o })),
    includedCents: 0,
    constraintRationale: "Fictional demonstration data.",
  });

  it("computes expected value as one aggregate rational calculation", () => {
    expect(
      unconstrainedMagnitudeCents(
        assessment([
          { amountCents: D(30_000), probabilityBps: 8_500 },
          { amountCents: 0, probabilityBps: 1_500 },
        ]),
        "expected_value",
      ),
    ).toBe(D(25_500));
  });

  it("rounds the expected value half-up exactly once", () => {
    // (333 x 5000 + 0 x 5000) / 10000 = 166.5 -> 167 (half-up, once)
    expect(
      unconstrainedMagnitudeCents(
        assessment([
          { amountCents: 333, probabilityBps: 5_000 },
          { amountCents: 0, probabilityBps: 5_000 },
        ]),
        "expected_value",
      ),
    ).toBe(167);
  });
});

// ---------------------------------------------------------------------------
// Validation and remeasurement behavior
// ---------------------------------------------------------------------------

function estimated(overrides: Partial<EstimatedComponentInput> = {}): EstimatedComponentInput {
  return {
    id: "vc-1",
    seq: 1,
    description: "Performance bonus",
    effect: "increase",
    estimationMethod: "most_likely_amount",
    allocationTreatment: "general",
    allocationRationale: "Fictional demonstration data.",
    inception: {
      id: "a1",
      seq: 1,
      effectiveDate: "2027-01-01",
      outcomes: [{ id: "o1", seq: 1, amountCents: D(12_000), isMostLikely: true }],
      includedCents: D(12_000),
      constraintRationale: "Fictional demonstration data.",
    },
    remeasurements: [],
    ...overrides,
  };
}

function contract(overrides: Partial<VcContractInput> = {}): VcContractInput {
  return {
    fixedConsiderationCents: D(120_000),
    standardPerformanceObligations: [CLOUDAI_PLATFORM],
    materialRights: [],
    estimatedComponents: [],
    usageComponents: [],
    ...overrides,
  };
}

const blockingIds = (analysis: ReturnType<typeof analyzeVariableConsideration>) =>
  analysis.validation.blockingFailures.map((f) => f.id);

describe("variable-consideration validation", () => {
  it("rejects expected-value probabilities that do not total 100%", () => {
    const analysis = analyzeVariableConsideration(
      contract({
        estimatedComponents: [
          estimated({
            estimationMethod: "expected_value",
            inception: {
              id: "a1",
              seq: 1,
              effectiveDate: "2027-01-01",
              outcomes: [
                { id: "o1", seq: 1, amountCents: D(10_000), probabilityBps: 5_000 },
                { id: "o2", seq: 2, amountCents: 0, probabilityBps: 4_000 },
              ],
              includedCents: 0,
              constraintRationale: "Fictional demonstration data.",
            },
          }),
        ],
      }),
    );
    expect(blockingIds(analysis)).toContain("vc.assessment.probability.total");
    expect(analysis.revenueSchedule).toBeNull();
  });

  it("requires exactly one most-likely outcome", () => {
    const analysis = analyzeVariableConsideration(
      contract({
        estimatedComponents: [
          estimated({
            inception: {
              id: "a1",
              seq: 1,
              effectiveDate: "2027-01-01",
              outcomes: [
                { id: "o1", seq: 1, amountCents: D(10_000), isMostLikely: true },
                { id: "o2", seq: 2, amountCents: D(5_000), isMostLikely: true },
              ],
              includedCents: D(10_000),
              constraintRationale: "Fictional demonstration data.",
            },
          }),
        ],
      }),
    );
    expect(blockingIds(analysis)).toContain("vc.assessment.most_likely.single");
  });

  it("rejects an included amount greater than the unconstrained estimate", () => {
    const analysis = analyzeVariableConsideration(
      contract({
        estimatedComponents: [
          estimated({
            inception: {
              id: "a1",
              seq: 1,
              effectiveDate: "2027-01-01",
              outcomes: [{ id: "o1", seq: 1, amountCents: D(10_000), isMostLikely: true }],
              includedCents: D(11_000),
              constraintRationale: "Fictional demonstration data.",
            },
          }),
        ],
      }),
    );
    expect(blockingIds(analysis)).toContain("vc.assessment.constraint.magnitude");
  });

  it("derives partial constraint and full exclusion conclusions", () => {
    const partial = analyzeVariableConsideration(
      contract({
        estimatedComponents: [
          estimated({
            inception: {
              id: "a1",
              seq: 1,
              effectiveDate: "2027-01-01",
              outcomes: [{ id: "o1", seq: 1, amountCents: D(10_000), isMostLikely: true }],
              includedCents: D(4_000),
              constraintRationale: "Fictional demonstration data.",
            },
          }),
        ],
      }),
    );
    expect(partial.components[0]!.assessments[0]!.constraintConclusion).toBe("partially_included");
    expect(partial.totals.initialTransactionPriceCents).toBe(D(124_000));

    const excluded = analyzeVariableConsideration(
      contract({
        estimatedComponents: [
          estimated({
            inception: {
              id: "a1",
              seq: 1,
              effectiveDate: "2027-01-01",
              outcomes: [{ id: "o1", seq: 1, amountCents: D(10_000), isMostLikely: true }],
              includedCents: 0,
              constraintRationale: "Fictional demonstration data.",
            },
          }),
        ],
      }),
    );
    expect(excluded.components[0]!.assessments[0]!.constraintConclusion).toBe("excluded");
    expect(excluded.totals.initialTransactionPriceCents).toBe(D(120_000));
  });

  it("applies a decreasing service-credit component as a negative amount", () => {
    const analysis = analyzeVariableConsideration(
      contract({
        estimatedComponents: [
          estimated({
            description: "SLA service credit",
            effect: "decrease",
            inception: {
              id: "a1",
              seq: 1,
              effectiveDate: "2027-01-01",
              outcomes: [{ id: "o1", seq: 1, amountCents: D(20_000), isMostLikely: true }],
              includedCents: D(20_000),
              constraintRationale: "Fictional demonstration data.",
            },
          }),
        ],
      }),
    );
    expect(analysis.components[0]!.initialIncludedCents).toBe(-D(20_000));
    expect(analysis.totals.initialTransactionPriceCents).toBe(D(100_000));
    expect(analysis.revenueSchedule!.totalCents).toBe(D(100_000));
  });

  it("requires both allocation-exception judgments for specific allocation", () => {
    const analysis = analyzeVariableConsideration(
      contract({
        estimatedComponents: [
          estimated({
            allocationTreatment: "specific_po",
            targetPoId: "po-platform",
            relatesSpecificallyToPo: true,
            consistentWithAllocationObjective: false,
          }),
        ],
      }),
    );
    expect(blockingIds(analysis)).toContain("vc.component.allocation_exception");
  });
});

describe("remeasurement recognition", () => {
  const remeasured = (effectiveDate: string, includedCents: number) =>
    analyzeVariableConsideration(
      contract({
        estimatedComponents: [
          estimated({
            allocationTreatment: "specific_po",
            targetPoId: "po-platform",
            relatesSpecificallyToPo: true,
            consistentWithAllocationObjective: true,
            inception: {
              id: "a1",
              seq: 1,
              effectiveDate: "2027-01-01",
              outcomes: [{ id: "o1", seq: 1, amountCents: D(12_000), isMostLikely: true }],
              includedCents: D(12_000),
              constraintRationale: "Fictional demonstration data.",
            },
            remeasurements: [
              {
                id: "a2",
                seq: 2,
                effectiveDate,
                outcomes: [{ id: "o1", seq: 1, amountCents: includedCents, isMostLikely: true }],
                includedCents,
                constraintRationale: "Fictional demonstration data.",
              },
            ],
          }),
        ],
      }),
    );

  it("produces a cumulative catch-up in the month of an over-time remeasurement", () => {
    const analysis = remeasured("2027-07-01", D(24_000));
    const event = analysis.changeEvents[0]!;
    expect(event.transactionPriceChangeCents).toBe(D(12_000));
    expect(event.month).toBe("2027-07");
    // 181 of 365 days elapsed through the 7/1/2027 effective date.
    expect(event.catchUpCents).toBe(598_356);
    expect(event.futureImpactCents).toBe(D(12_000) - 598_356);
    expect(analysis.revenueSchedule!.totalCents).toBe(D(144_000));
    expect(analysis.reconciliation.reconciled).toBe(true);
  });

  it("recognizes a post-satisfaction decrease as negative revenue in that month", () => {
    const analysis = analyzeVariableConsideration(
      contract({
        standardPerformanceObligations: [
          { ...CLOUDAI_PLATFORM, recognitionMethod: "point_in_time", recognitionDate: "2027-01-15" },
        ],
        estimatedComponents: [
          estimated({
            description: "SLA service credit",
            effect: "decrease",
            allocationTreatment: "specific_po",
            targetPoId: "po-platform",
            relatesSpecificallyToPo: true,
            consistentWithAllocationObjective: true,
            inception: {
              id: "a1",
              seq: 1,
              effectiveDate: "2027-01-01",
              outcomes: [{ id: "o1", seq: 1, amountCents: 0, isMostLikely: true }],
              includedCents: 0,
              constraintRationale: "Fictional demonstration data.",
            },
            remeasurements: [
              {
                id: "a2",
                seq: 2,
                effectiveDate: "2027-04-10",
                outcomes: [{ id: "o1", seq: 1, amountCents: D(5_000), isMostLikely: true }],
                includedCents: D(5_000),
                constraintRationale: "Fictional demonstration data.",
              },
            ],
          }),
        ],
      }),
    );
    const april = analysis.revenueSchedule!.byMonth.find((r) => r.month === "2027-04")!;
    expect(april.totalCents).toBe(-D(5_000));
    expect(analysis.revenueSchedule!.totalCents).toBe(D(115_000));
    expect(analysis.reconciliation.reconciled).toBe(true);
  });
});

describe("usage validation", () => {
  const usageContract = (overrides: Record<string, unknown>) =>
    analyzeVariableConsideration(
      contract({
        usageComponents: [
          {
            id: "vc-usage",
            seq: 1,
            description: "API usage",
            targetPoId: "po-platform",
            allocationTreatment: "specific_series_period",
            relatesSpecificallyToPeriod: true,
            consistentWithAllocationObjective: true,
            allocationRationale: "Fictional demonstration data.",
            meters: [
              { id: "m1", seq: 1, name: "Requests", rateAmountCents: 100, rateQuantity: 1_000, unit: "requests" },
            ],
            periods: [{ month: "2027-01", quantitiesByMeterId: { m1: 5_000 } }],
            ...overrides,
          },
        ],
      }),
    );

  it("recognizes single-meter usage in its period", () => {
    const analysis = usageContract({});
    expect(analysis.usagePeriods[0]!.totalCents).toBe(D(5));
  });

  it("treats explicit zero usage as valid and blank usage as blocking", () => {
    const zero = usageContract({ periods: [{ month: "2027-01", quantitiesByMeterId: { m1: 0 } }] });
    expect(zero.validation.blockingFailures).toEqual([]);
    expect(zero.usagePeriods[0]!.totalCents).toBe(0);

    const blank = usageContract({ periods: [{ month: "2027-01", quantitiesByMeterId: { m1: null } }] });
    expect(blockingIds(blank)).toContain("vc.usage.quantity.required");
  });

  it("rejects a usage target that is not a series", () => {
    const analysis = analyzeVariableConsideration(
      contract({
        standardPerformanceObligations: [{ ...CLOUDAI_PLATFORM, classification: "single_distinct" }],
        usageComponents: [
          {
            id: "vc-usage",
            seq: 1,
            description: "API usage",
            targetPoId: "po-platform",
            allocationTreatment: "specific_series_period",
            relatesSpecificallyToPeriod: true,
            consistentWithAllocationObjective: true,
            allocationRationale: "Fictional demonstration data.",
            meters: [
              { id: "m1", seq: 1, name: "Requests", rateAmountCents: 100, rateQuantity: 1_000, unit: "requests" },
            ],
            periods: [{ month: "2027-01", quantitiesByMeterId: { m1: 1_000 } }],
          },
        ],
      }),
    );
    expect(blockingIds(analysis)).toContain("vc.usage.target.series");
  });

  it("rejects an invalid rate denominator", () => {
    const analysis = usageContract({
      meters: [{ id: "m1", seq: 1, name: "Requests", rateAmountCents: 100, rateQuantity: 0, unit: "requests" }],
    });
    expect(blockingIds(analysis)).toContain("vc.usage.meter.rate_quantity");
  });

  it("rounds each meter-period half-up on exact ratio terms", () => {
    // 1 request at $1.00 / 1,000 requests = 0.1 cents -> 0 cents.
    expect(
      meterPeriodAmountCents(
        { id: "m1", seq: 1, name: "Requests", rateAmountCents: 100, rateQuantity: 1_000, unit: "requests" },
        1,
      ),
    ).toBe(0);
    // 5 requests -> 0.5 cents -> 1 cent (half-up).
    expect(
      meterPeriodAmountCents(
        { id: "m1", seq: 1, name: "Requests", rateAmountCents: 100, rateQuantity: 1_000, unit: "requests" },
        5,
      ),
    ).toBe(1);
  });
});
