/**
 * Phase 9G-R3 Part 2 — Stage A-G acceptance.
 *
 * Matrix groups B (specific series period), C (usage), F (progressive output),
 * G (reconciliation), H (review / provenance) and I (integrated Genomix).
 */

import { describe, expect, it } from "vitest";

import { analyzeProgressiveContract, type ProgressiveContractInput } from "../contract";
import { assessSignificantFinancing } from "../financing";
import { priceUsageActuals, type UsageRule } from "../usage";
import { buildVcLayers, type ProgressiveVcComponent } from "../variable-consideration";
import {
  carryForwardReviewConclusions,
  diffMaterialFacts,
  findOrphanDetails,
  materialFacts,
} from "../review";
import {
  GENOMIX_FIXED_CENTS,
  GENOMIX_SAAS_CENTS,
  GENOMIX_SERIES_PERIODS,
  GENOMIX_SUPPORT_CENTS,
  GENOMIX_VALIDATION_CENTS,
  genomixR3Input,
  withRealizedSlaCredit,
  withSupportHours,
  withUsageActual,
  withValidationTransfer,
} from "./genomix-r3";

const SERIES_POS = [
  { id: "po-saas", name: "Hosted SaaS platform", isSeries: true },
  { id: "po-impl", name: "Implementation", isSeries: false },
];

function poRow(analysis: ReturnType<typeof analyzeProgressiveContract>, poId: string) {
  return analysis.recognition!.byPo.find((row) => row.poId === poId)!;
}

// ---------------------------------------------------------------------------
// Group B — specific series period
// ---------------------------------------------------------------------------

describe("B — variable-consideration allocation layers", () => {
  const base: ProgressiveVcComponent = {
    id: "vc-1",
    seq: 1,
    description: "Component",
    effect: "increase",
    treatment: "general",
    estimateCents: 500_000,
    includedCents: 500_000,
  };

  it("B6 allocates a general amount through the relative-SSP pool", () => {
    const layers = buildVcLayers([base], SERIES_POS);
    expect(layers.generalPoolCents).toBe(500_000);
    expect(layers.specificPo).toHaveLength(0);
    expect(layers.seriesPeriod).toHaveLength(0);
  });

  it("B7 allocates a specific_po amount entirely to its target obligation", () => {
    const layers = buildVcLayers(
      [{ ...base, treatment: "specific_po", targetPoId: "po-impl" }],
      SERIES_POS,
    );
    expect(layers.generalPoolCents).toBe(0);
    expect(layers.specificPo).toEqual([
      {
        id: "vc:vc-1:included",
        componentId: "vc-1",
        description: "Component",
        poId: "po-impl",
        amountCents: 500_000,
      },
    ]);
  });

  it("B8 keeps a specific_series_period amount out of the general SSP pool", () => {
    const layers = buildVcLayers(
      [
        {
          ...base,
          treatment: "specific_series_period",
          targetPoId: "po-saas",
          seriesPeriods: GENOMIX_SERIES_PERIODS,
          realizedEvents: [
            { id: "e1", date: "2027-04-30", amountCents: 500_000, seriesPeriodId: "y1" },
          ],
        },
      ],
      SERIES_POS,
    );
    expect(layers.generalPoolCents).toBe(0);
    expect(layers.specificPo).toHaveLength(0);
    expect(layers.seriesPeriod).toHaveLength(1);
  });

  it("B9 assigns a realized amount to the correct service period and month", () => {
    const layers = buildVcLayers(
      [
        {
          ...base,
          treatment: "specific_series_period",
          targetPoId: "po-saas",
          seriesPeriods: GENOMIX_SERIES_PERIODS,
          realizedEvents: [
            { id: "e1", date: "2028-01-31", amountCents: 500_000, seriesPeriodId: "y2" },
          ],
        },
      ],
      SERIES_POS,
    );
    expect(layers.seriesPeriod[0]).toMatchObject({
      id: "vc:vc-1:e1",
      seriesPeriodId: "y2",
      month: "2028-01",
      poId: "po-saas",
    });
  });

  it("B10 fails closed on an invalid target period, parent or date", () => {
    const withUnknownPeriod = buildVcLayers(
      [
        {
          ...base,
          treatment: "specific_series_period",
          targetPoId: "po-saas",
          seriesPeriods: GENOMIX_SERIES_PERIODS,
          realizedEvents: [
            { id: "e1", date: "2027-04-30", amountCents: 500_000, seriesPeriodId: "nope" },
          ],
        },
      ],
      SERIES_POS,
    );
    expect(withUnknownPeriod.state).toBe("blocked");

    const outsidePeriod = buildVcLayers(
      [
        {
          ...base,
          treatment: "specific_series_period",
          targetPoId: "po-saas",
          seriesPeriods: GENOMIX_SERIES_PERIODS,
          realizedEvents: [
            { id: "e1", date: "2029-04-30", amountCents: 500_000, seriesPeriodId: "y1" },
          ],
        },
      ],
      SERIES_POS,
    );
    expect(outsidePeriod.state).toBe("blocked");

    const notASeries = buildVcLayers(
      [{ ...base, treatment: "specific_series_period", targetPoId: "po-impl" }],
      SERIES_POS,
    );
    expect(notASeries.state).toBe("blocked");
  });

  it("B11 accepts a $0 no-trigger estimate without a fabricated future period", () => {
    const layers = buildVcLayers(
      [
        {
          ...base,
          effect: "decrease",
          treatment: "specific_series_period",
          targetPoId: "po-saas",
          estimateCents: 0,
          includedCents: 0,
        },
      ],
      SERIES_POS,
    );
    expect(layers.state).toBe("complete");
    expect(layers.pending).toHaveLength(0);
    expect(layers.seriesPeriod).toHaveLength(0);
    expect(layers.transactionPriceEffectCents).toBe(0);
  });

  it("B12 leaves the fixed allocation untouched for a $0 estimate", () => {
    const analysis = analyzeProgressiveContract(genomixR3Input());
    expect(analysis.transactionPriceCents).toBe(GENOMIX_FIXED_CENTS);
    expect(analysis.allocation!.map((row) => row.allocatedCents)).toEqual([
      GENOMIX_SAAS_CENTS,
      GENOMIX_VALIDATION_CENTS,
      GENOMIX_SUPPORT_CENTS,
    ]);
  });

  it("retains an included-but-unrealized series amount as pending, never dropped", () => {
    const layers = buildVcLayers(
      [
        {
          ...base,
          treatment: "specific_series_period",
          targetPoId: "po-saas",
          seriesPeriods: GENOMIX_SERIES_PERIODS,
        },
      ],
      SERIES_POS,
    );
    expect(layers.pending).toHaveLength(1);
    expect(layers.pending[0]).toMatchObject({
      poId: "po-saas",
      amountCents: 500_000,
      reason: "awaiting_variable_consideration_event",
    });
    expect(layers.transactionPriceEffectCents).toBe(500_000);
  });
});

// ---------------------------------------------------------------------------
// Group C — usage
// ---------------------------------------------------------------------------

describe("C — usage rule versus actual activity", () => {
  const rule: UsageRule = {
    componentId: "vc-usage",
    targetPoId: "po-saas",
    meters: [
      {
        id: "m-samples",
        seq: 1,
        name: "Tier 2 samples",
        rateAmountCents: 1_200,
        rateQuantity: 1,
        unit: "samples",
        includedQuantity: 100,
      },
    ],
    billing: { billOnRealization: true },
    seriesPeriods: GENOMIX_SERIES_PERIODS,
  };

  it("C13 produces no amount, invoice or error when no usage exists", () => {
    const analysis = analyzeProgressiveContract(genomixR3Input());
    expect(analysis.usageAmounts).toHaveLength(0);
    expect(analysis.blocked).toHaveLength(0);
    expect(analysis.billing.events.every((event) => event.kind === "fixed")).toBe(true);
    expect(analysis.billing.pendingRules.map((rule) => rule.reason)).toEqual([
      "awaiting_usage_actuals",
    ]);
  });

  it("C14 prices entered usage deterministically above the tier threshold", () => {
    const priced = priceUsageActuals(rule, [
      {
        id: "ua-1",
        month: "2027-02",
        seriesPeriodId: "y1",
        date: "2027-02-28",
        quantitiesByMeterId: { "m-samples": 500 },
      },
    ]);
    expect(priced[0]!.totalCents).toBe(400 * 1_200);
    expect(priced[0]!.id).toBe("usage:vc-usage:ua-1");
  });

  it("C15 assigns usage to the correct period and fails closed otherwise", () => {
    expect(() =>
      priceUsageActuals(rule, [
        {
          id: "ua-1",
          month: "2027-02",
          seriesPeriodId: "nope",
          date: "2027-02-28",
          quantitiesByMeterId: { "m-samples": 500 },
        },
      ]),
    ).toThrow();
    expect(() =>
      priceUsageActuals(rule, [
        {
          id: "ua-1",
          month: "2027-02",
          seriesPeriodId: "y1",
          date: "2027-02-28",
          quantitiesByMeterId: { "m-samples": -1 },
        },
      ]),
    ).toThrow();
  });

  it("C16 recognizes and bills entered usage in its own month only", () => {
    const analysis = analyzeProgressiveContract(withUsageActual(genomixR3Input()));
    const amount = 500 * 1_200;
    expect(analysis.usageAmounts[0]!.totalCents).toBe(amount);
    const feb = analysis.recognition!.schedule.byPo.filter(
      (row) =>
        row.month === "2027-02" &&
        row.explanation.template === "variable_consideration_series_period",
    );
    expect(feb).toHaveLength(1);
    expect(feb[0]!.revenueCents).toBe(amount);
    expect(analysis.billing.events.some((event) => event.kind === "variable_realized")).toBe(true);
    expect(analysis.transactionPriceCents).toBe(GENOMIX_FIXED_CENTS + amount);
    expect(analysis.reconciliation!.reconciled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Group F / G — progressive output and reconciliation
// ---------------------------------------------------------------------------

describe("F/G — progressive downstream output and reconciliation", () => {
  const analysis = analyzeProgressiveContract(genomixR3Input());

  it("F32 schedules hosted-service revenue while other obligations are pending", () => {
    expect(poRow(analysis, "po-saas").scheduledCents).toBe(GENOMIX_SAAS_CENTS);
    expect(poRow(analysis, "po-validation").pendingCents).toBe(GENOMIX_VALIDATION_CENTS);
    expect(poRow(analysis, "po-support").pendingCents).toBe(GENOMIX_SUPPORT_CENTS);
  });

  it("F33 keeps the fixed billing schedule available and independent", () => {
    expect(analysis.billing.events.filter((event) => event.kind === "fixed")).toHaveLength(2);
    expect(analysis.billing.totalCents).toBe(GENOMIX_FIXED_CENTS);
  });

  it("F36 produces a partial revenue schedule rather than a blank one", () => {
    expect(analysis.recognition!.schedule.byMonth.length).toBeGreaterThan(0);
    expect(analysis.recognition!.state).toBe("pending");
  });

  it("F37 exposes known balance components plus the explicit pending amount", () => {
    expect(analysis.balances!.totalBilledCents).toBe(GENOMIX_FIXED_CENTS);
    expect(analysis.balances!.pendingCents).toBe(GENOMIX_VALIDATION_CENTS + GENOMIX_SUPPORT_CENTS);
    expect(analysis.balances!.periods.every((period) => period.state === "pending")).toBe(true);
  });

  it("F38 emits known journal entries without fabricating pending ones", () => {
    expect(analysis.journals!.entries.length).toBeGreaterThan(0);
    expect(analysis.journals!.balanced).toBe(true);
    expect(analysis.journals!.pendingEvents.map((event) => event.reason).sort()).toEqual([
      "awaiting_progress_actuals",
      "awaiting_transfer_date",
    ]);
  });

  it("G40-G45 reconciles price, allocation, recognition and billing", () => {
    const reconciliation = analysis.reconciliation!;
    expect(reconciliation.reconciled).toBe(true);
    expect(reconciliation.allocatedCents).toBe(GENOMIX_FIXED_CENTS);
    expect(reconciliation.unresolvedCents).toBe(0);
    for (const row of reconciliation.byPo) {
      expect(row.recognizedCents + row.pendingCents + row.blockedCents).toBe(row.allocatedCents);
    }
    expect(reconciliation.scheduledRevenueCents + reconciliation.pendingCents).toBe(
      GENOMIX_FIXED_CENTS,
    );
  });

  it("G46 never lets a partial result present itself as complete", () => {
    expect(analysis.state).toBe("pending");
    expect(analysis.balances!.state).toBe("pending");
    expect(analysis.journals!.state).toBe("pending");
  });
});

// ---------------------------------------------------------------------------
// Stage E — significant financing
// ---------------------------------------------------------------------------

describe("E — narrow significant-financing normalization", () => {
  it("raises no adjustment for annual advance billing under the expedient", () => {
    const assessment = assessSignificantFinancing({
      intervals: [{ id: "y1", label: "Year 1", days: 365 }],
      practicalExpedientAccepted: true,
    });
    expect(assessment.conclusion).toBe("no_adjustment_practical_expedient");
    expect(assessment.adjustmentRequired).toBe(false);
    expect(assessment.state).toBe("complete");
  });

  it("treats an unconfirmed policy as a review matter, not a suppression", () => {
    const assessment = assessSignificantFinancing({
      intervals: [{ id: "y1", label: "Year 1", days: 365 }],
      practicalExpedientAccepted: null,
    });
    expect(assessment.conclusion).toBe("policy_not_confirmed");
    expect(assessment.state).toBe("provisional");
    expect(assessment.reviewRequired).toBe(true);
    // Steps 4 and 5 still calculate.
    const analysis = analyzeProgressiveContract({
      ...genomixR3Input(),
      financing: {
        intervals: [{ id: "y1", label: "Year 1", days: 365 }],
        practicalExpedientAccepted: null,
      },
    });
    expect(analysis.allocation).not.toBeNull();
    expect(analysis.recognition!.schedule.byMonth.length).toBeGreaterThan(0);
  });

  it("fails closed beyond one year instead of guessing a present value", () => {
    const assessment = assessSignificantFinancing({
      intervals: [{ id: "multi", label: "Three-year deferral", days: 1_095 }],
      practicalExpedientAccepted: true,
    });
    expect(assessment.conclusion).toBe("outside_narrow_treatment");
    expect(assessment.state).toBe("blocked");
  });
});

// ---------------------------------------------------------------------------
// Group H — review, provenance and identity
// ---------------------------------------------------------------------------

describe("H — material facts, review carry-forward and identity", () => {
  const before = materialFacts(genomixR3Input() as never);

  it("H46 reopens only the affected conclusion when the transfer date changes", () => {
    const after = materialFacts(withValidationTransfer(genomixR3Input()) as never);
    const diff = diffMaterialFacts(before, after);
    expect(diff.changedKeys).toEqual(["po:po-validation:transfer_status"]);
    const carried = carryForwardReviewConclusions(
      {
        "po:po-validation:transfer_status": "affirmed",
        "po:po-support:input_measure_denominator": "affirmed",
        "vc:vc-sla:treatment": "resolved",
      },
      diff,
    );
    expect(carried).toEqual({
      "po:po-validation:transfer_status": "open",
      "po:po-support:input_measure_denominator": "affirmed",
      "vc:vc-sla:treatment": "resolved",
    });
  });

  it("H47 reopens only the affected conclusion for progress, method and VC facts", () => {
    const hours = diffMaterialFacts(
      before,
      materialFacts(withSupportHours(genomixR3Input()) as never),
    );
    expect(hours.changedKeys).toEqual([]);
    expect(hours.addedKeys).toEqual(["po:po-support:progress:ph-1"]);

    const sla = diffMaterialFacts(
      before,
      materialFacts(withRealizedSlaCredit(genomixR3Input()) as never),
    );
    expect(sla.changedKeys).toEqual(["vc:vc-sla:treatment"]);
    expect(sla.addedKeys).toEqual(["vc:vc-sla:realized:sla-2027-04"]);

    const method = materialFacts({
      ...genomixR3Input(),
      performanceObligations: genomixR3Input().performanceObligations.map((po) =>
        po.id === "po-support" ? { ...po, totalExpectedUnits: 400 } : po,
      ),
    } as never);
    expect(diffMaterialFacts(before, method).changedKeys).toEqual([
      "po:po-support:input_measure_denominator",
    ]);
  });

  it("H50 keeps accountant-owned actuals across a re-analysis", () => {
    const withActuals = withUsageActual(withSupportHours(genomixR3Input()));
    const first = analyzeProgressiveContract(withActuals);
    const second = analyzeProgressiveContract(withActuals);
    expect(second.usageAmounts).toEqual(first.usageAmounts);
    expect(poRow(second, "po-support").scheduledCents).toBe(
      poRow(first, "po-support").scheduledCents,
    );
  });

  it("H51 rejects orphan details that reference no valid owner", () => {
    expect(
      findOrphanDetails({
        validPoIds: ["po-saas"],
        validComponentIds: ["vc-sla"],
        details: [
          { id: "d1", ownerId: "po-saas", ownerKind: "po" },
          { id: "d2", ownerId: "po-ghost", ownerKind: "po" },
          { id: "d3", ownerId: "vc-ghost", ownerKind: "component" },
        ],
      }),
    ).toEqual(["d2", "d3"]);
  });

  it("identifies pending events by stable component identity, not poId + reason", () => {
    const analysis = analyzeProgressiveContract({
      ...genomixR3Input(),
      variableComponents: [
        {
          id: "vc-sla",
          seq: 1,
          description: "SLA credits",
          effect: "increase",
          treatment: "specific_series_period",
          targetPoId: "po-saas",
          seriesPeriods: GENOMIX_SERIES_PERIODS,
          estimateCents: 200_000,
          includedCents: 200_000,
        },
      ],
    });
    expect(analysis.journals!.pendingEvents.map((event) => event.id)).toContain(
      "vc:vc-sla:unrealized",
    );
  });
});

// ---------------------------------------------------------------------------
// Group I — integrated Genomix acceptance
// ---------------------------------------------------------------------------

describe("I — integrated Genomix R3 acceptance", () => {
  it("calculates everything determinable at inception", () => {
    const analysis = analyzeProgressiveContract(genomixR3Input());
    expect(analysis.transactionPriceCents).toBe(49_000_000);
    expect(analysis.allocation!.map((row) => [row.poId, row.allocatedCents])).toEqual([
      ["po-saas", 44_600_000],
      ["po-validation", 2_960_000],
      ["po-support", 1_440_000],
    ]);
    expect(analysis.provisional.map((note) => note.poId)).toEqual([
      "po-saas",
      "po-validation",
      "po-support",
    ]);
    expect(poRow(analysis, "po-validation").reason).toBe("awaiting_transfer_date");
    expect(poRow(analysis, "po-support").reason).toBe("awaiting_progress_actuals");
    expect(analysis.billing.events).toHaveLength(2);
    expect(analysis.reconciliation!.reconciled).toBe(true);
  });

  it("adding a validation transfer date changes validation only", () => {
    const before = analyzeProgressiveContract(genomixR3Input());
    const after = analyzeProgressiveContract(withValidationTransfer(genomixR3Input()));
    expect(poRow(after, "po-validation").scheduledCents).toBe(GENOMIX_VALIDATION_CENTS);
    expect(poRow(after, "po-validation").state).toBe("complete");
    expect(poRow(after, "po-saas")).toEqual(poRow(before, "po-saas"));
    expect(poRow(after, "po-support")).toEqual(poRow(before, "po-support"));
    expect(after.billing.events).toEqual(before.billing.events);
    expect(after.reconciliation!.reconciled).toBe(true);
  });

  it("adding support hours changes support only", () => {
    const before = analyzeProgressiveContract(genomixR3Input());
    const after = analyzeProgressiveContract(withSupportHours(genomixR3Input()));
    const support = poRow(after, "po-support");
    expect(support.scheduledCents).toBe(720_000);
    expect(support.pendingCents).toBe(720_000);
    expect(support.progress!.cumulativePercentBps).toBe(5_000);
    expect(poRow(after, "po-saas")).toEqual(poRow(before, "po-saas"));
    expect(poRow(after, "po-validation")).toEqual(poRow(before, "po-validation"));
  });

  it("adding usage changes usage-driven amounts only", () => {
    const before = analyzeProgressiveContract(genomixR3Input());
    const after = analyzeProgressiveContract(withUsageActual(genomixR3Input()));
    expect(poRow(after, "po-validation")).toEqual(poRow(before, "po-validation"));
    expect(poRow(after, "po-support")).toEqual(poRow(before, "po-support"));
    expect(poRow(after, "po-saas").scheduledCents).toBe(
      poRow(before, "po-saas").scheduledCents + 600_000,
    );
  });

  it("a realized SLA credit adjusts its own service period only", () => {
    const before = analyzeProgressiveContract(genomixR3Input());
    const after = analyzeProgressiveContract(withRealizedSlaCredit(genomixR3Input()));
    expect(after.transactionPriceCents).toBe(49_000_000 - 150_000);
    const credited = after.recognition!.schedule.byPo.filter(
      (row) =>
        row.month === "2027-04" &&
        row.explanation.template === "variable_consideration_series_period",
    );
    expect(credited).toHaveLength(1);
    expect(credited[0]!.revenueCents).toBe(-150_000);
    expect(poRow(after, "po-validation")).toEqual(poRow(before, "po-validation"));
    expect(poRow(after, "po-support")).toEqual(poRow(before, "po-support"));
    expect(after.reconciliation!.reconciled).toBe(true);
  });
});
