/**
 * Phase 9G-R3 — progressive / provisional accounting engine.
 *
 * These suites encode the R3 central invariant: a pending FUTURE fact, or a
 * usable-but-unconfirmed fact, limits only the output that depends on it.
 */

import { describe, expect, it } from "vitest";

import { allocateProgressively, type ProvisionalAllocatablePo } from "../allocation";
import {
  generateProgressiveRevenueSchedule,
  recognizeInputMeasure,
  type ProgressiveScheduleInput,
} from "../recognition";
import { reconcileProgressive } from "../reconciliation";
import { ProgressiveAccountingError } from "../types";

// Genomix synthetic benchmark (all amounts integer cents).
const GENOMIX_PRICE = 49_000_000; // $490,000.00
const HOSTED = 44_600_000; // $446,000.00
const VALIDATION = 2_960_000; // $29,600.00
const SUPPORT = 1_440_000; // $14,400.00

function genomixPos(
  confidence: ProvisionalAllocatablePo["sspConfidence"] = "provisional",
): ProvisionalAllocatablePo[] {
  return [
    {
      id: "po-hosted",
      seq: 1,
      name: "Hosted SaaS service",
      sspCents: HOSTED,
      sspConfidence: confidence,
    },
    {
      id: "po-validation",
      seq: 2,
      name: "Validation package",
      sspCents: VALIDATION,
      sspConfidence: confidence,
    },
    {
      id: "po-support",
      seq: 3,
      name: "Support hours",
      sspCents: SUPPORT,
      sspConfidence: confidence,
    },
  ];
}

function genomixSchedule(
  overrides: {
    transferDate?: string;
    supportEvents?: { id: string; date: string; units: number }[];
  } = {},
): ProgressiveScheduleInput[] {
  return [
    {
      po: {
        id: "po-hosted",
        seq: 1,
        name: "Hosted SaaS service",
        recognitionMethod: "over_time_ratable",
        serviceStart: "2026-11-01",
        serviceEnd: "2028-10-31",
      },
      allocatedCents: HOSTED,
    },
    {
      po: {
        id: "po-validation",
        seq: 2,
        name: "Validation package",
        recognitionMethod: "point_in_time",
        // R3 Part 1: "not yet transferred" must be explicit. An absent date on
        // its own is an ordinary missing input, not a future-event assumption.
        ...(overrides.transferDate
          ? { recognitionDate: overrides.transferDate }
          : { transferDateUnknown: true }),
      },
      allocatedCents: VALIDATION,
    },
    {
      po: {
        id: "po-support",
        seq: 3,
        name: "Support hours",
        recognitionMethod: "over_time_input_measure",
        totalExpectedUnits: 120,
        unitLabel: "hours",
        progressEvents: overrides.supportEvents ?? [],
      },
      allocatedCents: SUPPORT,
    },
  ];
}

// ---------------------------------------------------------------------------
// A. Provisional SSP
// ---------------------------------------------------------------------------

describe("A. provisional standalone selling prices", () => {
  it("1/2. allocates the Genomix transaction price from three provisional SSPs", () => {
    const result = allocateProgressively({
      transactionPriceCents: GENOMIX_PRICE,
      performanceObligations: genomixPos(),
    });
    expect(result.state).toBe("provisional");
    expect(result.value!.map((row) => row.allocatedCents)).toEqual([HOSTED, VALIDATION, SUPPORT]);
  });

  it("3. keeps provisional confirmation as a review note, not a calculation error", () => {
    const result = allocateProgressively({
      transactionPriceCents: GENOMIX_PRICE,
      performanceObligations: genomixPos(),
    });
    expect(result.blocked).toEqual([]);
    expect(result.provisional.map((note) => note.reason)).toEqual([
      "provisional_ssp_confirmation",
      "provisional_ssp_confirmation",
      "provisional_ssp_confirmation",
    ]);
  });

  it("4. still blocks allocation when a required SSP is genuinely unusable", () => {
    const pos = genomixPos();
    pos[1] = { ...pos[1]!, sspCents: 0 };
    const result = allocateProgressively({
      transactionPriceCents: GENOMIX_PRICE,
      performanceObligations: pos,
    });
    expect(result.state).toBe("blocked");
    expect(result.value).toBeNull();
    expect(result.blocked[0]!.code).toBe("allocation.ssp.unusable");
  });

  it("5. raises no duplicate hard intervention for a usable provisional SSP", () => {
    const result = allocateProgressively({
      transactionPriceCents: GENOMIX_PRICE,
      performanceObligations: genomixPos(),
    });
    const hostedNotes = result.provisional.filter((note) => note.poId === "po-hosted");
    expect(hostedNotes).toHaveLength(1);
    expect(result.blocked.some((item) => item.poId === "po-hosted")).toBe(false);
  });

  it("marks the allocation complete when every SSP is confirmed", () => {
    const result = allocateProgressively({
      transactionPriceCents: GENOMIX_PRICE,
      performanceObligations: genomixPos("confirmed"),
    });
    expect(result.state).toBe("complete");
    expect(result.provisional).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// D. Input measure
// ---------------------------------------------------------------------------

describe("D. over-time input measure", () => {
  const po = {
    id: "po-support",
    seq: 1,
    name: "Support hours",
    recognitionMethod: "over_time_input_measure" as const,
    totalExpectedUnits: 120,
    unitLabel: "hours",
  };

  it("19/20. accepts the method and stays pending with a known denominator and no actuals", () => {
    const result = generateProgressiveRevenueSchedule([
      { po: { ...po, progressEvents: [] }, allocatedCents: SUPPORT },
    ]);
    expect(result.state).toBe("pending");
    expect(result.blocked).toEqual([]);
    expect(result.pending[0]!.reason).toBe("awaiting_progress_actuals");
    expect(result.pending[0]!.amountCents).toBe(SUPPORT);
  });

  it("21/22/23. computes cumulative percentage, revenue and period revenue", () => {
    const measured = recognizeInputMeasure(
      {
        ...po,
        progressEvents: [
          { id: "e1", date: "2026-11-10", units: 30 },
          { id: "e2", date: "2026-12-05", units: 30 },
        ],
      },
      SUPPORT,
    );
    expect(measured.cumulativePercentBps).toBe(5_000); // 60 / 120
    expect(measured.scheduledCents).toBe(SUPPORT / 2);
    expect(measured.rows.map((row) => [row.month, row.revenueCents])).toEqual([
      ["2026-11", 360_000],
      ["2026-12", 360_000],
    ]);
  });

  it("24. fails closed on negative, duplicated or undated actuals", () => {
    expect(() =>
      recognizeInputMeasure(
        { ...po, progressEvents: [{ id: "e1", date: "2026-11-10", units: -1 }] },
        SUPPORT,
      ),
    ).toThrow(ProgressiveAccountingError);
    expect(() =>
      recognizeInputMeasure(
        {
          ...po,
          progressEvents: [
            { id: "e1", date: "2026-11-10", units: 5 },
            { id: "e1", date: "2026-11-11", units: 5 },
          ],
        },
        SUPPORT,
      ),
    ).toThrow(ProgressiveAccountingError);
    expect(() =>
      recognizeInputMeasure(
        { ...po, progressEvents: [{ id: "e1", date: "not-a-date", units: 5 }] },
        SUPPORT,
      ),
    ).toThrow(ProgressiveAccountingError);
  });

  it("24b. fails closed on a missing or non-positive denominator", () => {
    expect(() => recognizeInputMeasure({ ...po, totalExpectedUnits: 0 }, SUPPORT)).toThrow(
      ProgressiveAccountingError,
    );
    const { totalExpectedUnits: _omitted, ...withoutDenominator } = po;
    expect(() => recognizeInputMeasure(withoutDenominator, SUPPORT)).toThrow(
      ProgressiveAccountingError,
    );
  });

  it("25. never recognizes more than the allocated amount", () => {
    expect(() =>
      recognizeInputMeasure(
        { ...po, progressEvents: [{ id: "e1", date: "2026-11-10", units: 121 }] },
        SUPPORT,
      ),
    ).toThrow(ProgressiveAccountingError);
  });

  it("26. recognizes 100% once the contracted hours are complete", () => {
    const result = generateProgressiveRevenueSchedule([
      {
        po: { ...po, progressEvents: [{ id: "e1", date: "2027-01-31", units: 120 }] },
        allocatedCents: SUPPORT,
      },
    ]);
    expect(result.state).toBe("complete");
    expect(result.pending).toEqual([]);
    expect(result.byPo[0]!.scheduledCents).toBe(SUPPORT);
    expect(result.byPo[0]!.progress!.cumulativePercentBps).toBe(10_000);
  });
});

// ---------------------------------------------------------------------------
// E. Point in time with an unknown transfer date
// ---------------------------------------------------------------------------

describe("E. point in time with an unknown transfer date", () => {
  it("27/29. keeps the allocated amount pending and fabricates no date", () => {
    const result = generateProgressiveRevenueSchedule(genomixSchedule());
    const validation = result.byPo.find((row) => row.poId === "po-validation")!;
    expect(validation.state).toBe("pending");
    expect(validation.reason).toBe("awaiting_transfer_date");
    expect(validation.pendingCents).toBe(VALIDATION);
    expect(validation.scheduledCents).toBe(0);
    expect(result.schedule.byPo.some((row) => row.poId === "po-validation")).toBe(false);
  });

  it("28. does not block the hosted-service schedule", () => {
    const result = generateProgressiveRevenueSchedule(genomixSchedule());
    const hosted = result.byPo.find((row) => row.poId === "po-hosted")!;
    expect(hosted.state).toBe("complete");
    expect(hosted.scheduledCents).toBe(HOSTED);
    expect(result.schedule.byMonth[0]!.month).toBe("2026-11");
  });

  it("30/31. recognizes the full amount once a valid transfer date is supplied", () => {
    const result = generateProgressiveRevenueSchedule(
      genomixSchedule({ transferDate: "2027-02-15" }),
    );
    const validation = result.byPo.find((row) => row.poId === "po-validation")!;
    expect(validation.state).toBe("complete");
    expect(validation.scheduledCents).toBe(VALIDATION);
    expect(result.pending.some((item) => item.reason === "awaiting_transfer_date")).toBe(false);
    expect(
      result.schedule.byMonth.find((row) => row.month === "2027-02")!.perPo["po-validation"],
    ).toBe(VALIDATION);
  });

  it("blocks only that obligation when the transfer date is malformed", () => {
    const inputs = genomixSchedule();
    inputs[1]!.po.recognitionDate = "2027-13-45";
    const result = generateProgressiveRevenueSchedule(inputs);
    expect(result.blocked.map((item) => item.poId)).toEqual(["po-validation"]);
    expect(result.byPo.find((row) => row.poId === "po-hosted")!.scheduledCents).toBe(HOSTED);
  });
});

// ---------------------------------------------------------------------------
// F. Progressive output + G. reconciliation (Genomix integration)
// ---------------------------------------------------------------------------

describe("F/G. Genomix progressive output and reconciliation", () => {
  const allocation = allocateProgressively({
    transactionPriceCents: GENOMIX_PRICE,
    performanceObligations: genomixPos(),
  });

  it("32/33/36. schedules the hosted service while validation and support are pending", () => {
    const recognition = generateProgressiveRevenueSchedule(genomixSchedule());
    expect(recognition.state).toBe("pending");
    expect(recognition.schedule.byMonth.length).toBeGreaterThan(0);
    expect(recognition.schedule.totalCents).toBe(HOSTED);
    expect(recognition.pending.map((item) => item.reason).sort()).toEqual([
      "awaiting_progress_actuals",
      "awaiting_transfer_date",
    ]);
  });

  it("37/40/41/42. reconciles allocation to recognized plus pending with no double count", () => {
    const recognition = generateProgressiveRevenueSchedule(genomixSchedule());
    const reconciliation = reconcileProgressive({
      transactionPriceCents: GENOMIX_PRICE,
      allocation: allocation.value!,
      recognition,
    });
    expect(reconciliation.reconciled).toBe(true);
    expect(reconciliation.allocatedCents).toBe(GENOMIX_PRICE);
    expect(reconciliation.scheduledRevenueCents).toBe(HOSTED);
    expect(reconciliation.pendingCents).toBe(VALIDATION + SUPPORT);
    expect(reconciliation.scheduledRevenueCents + reconciliation.pendingCents).toBe(GENOMIX_PRICE);
    for (const row of reconciliation.byPo) {
      expect(row.recognizedCents + row.pendingCents + row.blockedCents).toBe(row.allocatedCents);
    }
  });

  it("45. never reports a partial result as complete", () => {
    const recognition = generateProgressiveRevenueSchedule(genomixSchedule());
    const reconciliation = reconcileProgressive({
      transactionPriceCents: GENOMIX_PRICE,
      allocation: allocation.value!,
      recognition,
    });
    expect(reconciliation.state).toBe("pending");
  });

  it("39. adding one missing fact changes only the dependent output", () => {
    const before = generateProgressiveRevenueSchedule(genomixSchedule());
    const after = generateProgressiveRevenueSchedule(
      genomixSchedule({ transferDate: "2027-02-15" }),
    );
    const hostedBefore = before.byPo.find((row) => row.poId === "po-hosted")!;
    const hostedAfter = after.byPo.find((row) => row.poId === "po-hosted")!;
    expect(hostedAfter).toEqual(hostedBefore);
    const supportBefore = before.byPo.find((row) => row.poId === "po-support")!;
    const supportAfter = after.byPo.find((row) => row.poId === "po-support")!;
    expect(supportAfter).toEqual(supportBefore);
    expect(after.byPo.find((row) => row.poId === "po-validation")!.scheduledCents).toBe(VALIDATION);
  });

  it("43. carries specifically allocated pending variable consideration without double counting", () => {
    const recognition = generateProgressiveRevenueSchedule(genomixSchedule());
    const reconciliation = reconcileProgressive({
      transactionPriceCents: GENOMIX_PRICE,
      allocation: allocation.value!,
      recognition,
      externalPending: [
        {
          poId: "po-hosted",
          poName: "Hosted SaaS service",
          amountCents: 0,
          reason: "awaiting_usage_actuals",
        },
      ],
    });
    expect(reconciliation.reconciled).toBe(true);
    expect(reconciliation.pendingCents).toBe(VALIDATION + SUPPORT);
    expect(reconciliation.pending.some((item) => item.reason === "awaiting_usage_actuals")).toBe(
      true,
    );
  });

  it("reports a reconciliation failure rather than hiding a lost amount", () => {
    const recognition = generateProgressiveRevenueSchedule(genomixSchedule());
    const tampered = {
      ...recognition,
      byPo: recognition.byPo.map((row) =>
        row.poId === "po-validation" ? { ...row, pendingCents: 0 } : row,
      ),
    };
    const reconciliation = reconcileProgressive({
      transactionPriceCents: GENOMIX_PRICE,
      allocation: allocation.value!,
      recognition: tampered,
    });
    expect(reconciliation.reconciled).toBe(false);
    expect(reconciliation.state).toBe("blocked");
  });
});
