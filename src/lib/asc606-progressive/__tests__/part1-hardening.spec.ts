/**
 * Phase 9G-R3 Part 1 — foundation hardening.
 *
 * These suites are deliberately separate from progressive.spec.ts so the
 * hardening evidence (items 1-5 of the Part 1 brief) can be identified on its
 * own in the Part 2 completion report.
 */

import { describe, expect, it } from "vitest";

import { MoneyError, type AllocationRow } from "@/lib/asc606";

import { allocateProgressively } from "../allocation";

import { generateProgressiveRevenueSchedule, type ProgressiveScheduleInput } from "../recognition";
import { reconcileProgressive } from "../reconciliation";
import { sumBlockedCents, sumPendingCents } from "../types";

const HOSTED = 44_600_000;
const VALIDATION = 2_960_000;

function hosted(): ProgressiveScheduleInput {
  return {
    po: {
      id: "po-hosted",
      seq: 1,
      name: "Hosted SaaS service",
      recognitionMethod: "over_time_ratable",
      serviceStart: "2026-11-01",
      serviceEnd: "2028-10-31",
    },
    allocatedCents: HOSTED,
  };
}

function pointInTime(
  overrides: {
    allocatedCents?: number;
    recognitionDate?: string;
    transferDateUnknown?: boolean;
  } = {},
): ProgressiveScheduleInput {
  const { allocatedCents = VALIDATION, ...po } = overrides;
  return {
    po: {
      id: "po-validation",
      seq: 2,
      name: "Validation package",
      recognitionMethod: "point_in_time",
      ...po,
    },
    allocatedCents: allocatedCents as number,
  };
}

// ---------------------------------------------------------------------------
// 1. Allocated consideration is validated at the recognition boundary
// ---------------------------------------------------------------------------

describe("1. allocation validity at the recognition boundary", () => {
  const invalid: [string, number][] = [
    ["negative", -1],
    ["fractional", 100.5],
    ["non-finite", Number.POSITIVE_INFINITY],
    ["not a number", Number.NaN],
    ["out of supported range", Number.MAX_SAFE_INTEGER],
  ];

  for (const [label, allocatedCents] of invalid) {
    it(`blocks a point-in-time obligation with an ${label} allocation before choosing pending`, () => {
      const result = generateProgressiveRevenueSchedule([
        hosted(),
        pointInTime({ allocatedCents, transferDateUnknown: true }),
      ]);

      const row = result.byPo.find((entry) => entry.poId === "po-validation")!;
      expect(row.state).toBe("blocked");
      // An invalid monetary amount is never preserved as a pending amount.
      expect(row.pendingCents).toBe(0);
      expect(result.pending).toEqual([]);
      expect(result.blocked.map((entry) => entry.code)).toEqual(["allocation.invalid"]);
      expect(result.blocked[0]!.amountCents).toBe(0);

      // It blocks ONLY that obligation: hosted revenue still schedules.
      const hostedRow = result.byPo.find((entry) => entry.poId === "po-hosted")!;
      expect(hostedRow.state).toBe("complete");
      expect(hostedRow.scheduledCents).toBe(HOSTED);
      expect(result.schedule.totalCents).toBe(HOSTED);
    });
  }
});

// ---------------------------------------------------------------------------
// 2. "Unknown future transfer date" is explicit
// ---------------------------------------------------------------------------

describe("2. explicit unknown transfer date", () => {
  it("treats an explicitly unknown transfer date as a pending future fact", () => {
    const result = generateProgressiveRevenueSchedule([pointInTime({ transferDateUnknown: true })]);
    const row = result.byPo[0]!;
    expect(row.state).toBe("pending");
    expect(row.reason).toBe("awaiting_transfer_date");
    expect(row.pendingCents).toBe(VALIDATION);
  });

  it("recognizes normally when a valid date is supplied and it is not marked unknown", () => {
    const result = generateProgressiveRevenueSchedule([
      pointInTime({ recognitionDate: "2027-03-15" }),
    ]);
    expect(result.byPo[0]!.state).toBe("complete");
    expect(result.byPo[0]!.scheduledCents).toBe(VALIDATION);
  });

  it("blocks contradictory input: marked unknown yet carrying a date", () => {
    const result = generateProgressiveRevenueSchedule([
      pointInTime({ transferDateUnknown: true, recognitionDate: "2027-03-15" }),
    ]);
    expect(result.byPo[0]!.state).toBe("blocked");
    expect(result.blocked[0]!.code).toBe("recognition.point_in_time.contradictory");
  });

  it("blocks an ordinary missing date instead of assuming a future transfer", () => {
    const result = generateProgressiveRevenueSchedule([pointInTime()]);
    expect(result.byPo[0]!.state).toBe("blocked");
    expect(result.blocked[0]!.code).toBe("recognition.point_in_time.date_missing");
    expect(result.pending).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3 & 4. Reconciliation of recognition rows and detail arrays
// ---------------------------------------------------------------------------

// Built through the accepted deterministic allocator — never hand-shaped.
const allocation: readonly AllocationRow[] = allocateProgressively({
  transactionPriceCents: HOSTED + VALIDATION,
  performanceObligations: [
    { id: "po-hosted", seq: 1, name: "Hosted SaaS service", sspCents: HOSTED },
    { id: "po-validation", seq: 2, name: "Validation package", sspCents: VALIDATION },
  ],
}).value!;

function recognition() {
  return generateProgressiveRevenueSchedule([hosted(), pointInTime({ transferDateUnknown: true })]);
}

describe("3. every allocated obligation needs exactly one recognition result", () => {
  it("reconciles the intact progressive result", () => {
    const result = reconcileProgressive({
      transactionPriceCents: HOSTED + VALIDATION,
      allocation,
      recognition: recognition(),
    });
    expect(result.failures).toEqual([]);
    expect(result.reconciled).toBe(true);
    expect(result.unresolvedCents).toBe(0);
  });

  it("fails when an allocated obligation has no recognition result", () => {
    const base = recognition();
    const result = reconcileProgressive({
      transactionPriceCents: HOSTED + VALIDATION,
      allocation,
      recognition: {
        ...base,
        byPo: base.byPo.filter((row) => row.poId !== "po-validation"),
        pending: [],
      },
    });
    expect(result.reconciled).toBe(false);
    expect(result.state).toBe("blocked");
    // The amount stays traceable as unresolved rather than a synthesized block.
    expect(result.unresolvedCents).toBe(VALIDATION);
    expect(result.byPo.find((row) => row.poId === "po-validation")!.blockedCents).toBe(0);
    expect(result.failures.join(" ")).toMatch(/no recognition result/);
  });

  it("fails when an obligation has duplicate recognition results", () => {
    const base = recognition();
    const result = reconcileProgressive({
      transactionPriceCents: HOSTED + VALIDATION,
      allocation,
      recognition: { ...base, byPo: [...base.byPo, base.byPo[1]!] },
    });
    expect(result.reconciled).toBe(false);
    expect(result.failures.join(" ")).toMatch(/more than one recognition result/);
  });

  it("fails when recognition output has no matching allocation", () => {
    const base = recognition();
    const result = reconcileProgressive({
      transactionPriceCents: HOSTED + VALIDATION,
      allocation,
      recognition: {
        ...base,
        byPo: [...base.byPo, { ...base.byPo[1]!, poId: "po-ghost", poName: "Ghost" }],
      },
    });
    expect(result.reconciled).toBe(false);
    expect(result.failures.join(" ")).toMatch(/without an allocation/);
  });
});

describe("4. detail arrays reconcile to the per-obligation monetary buckets", () => {
  it("fails when the pending detail disagrees with the pending amount", () => {
    const base = recognition();
    const result = reconcileProgressive({
      transactionPriceCents: HOSTED + VALIDATION,
      allocation,
      recognition: { ...base, pending: [] },
    });
    expect(result.reconciled).toBe(false);
    expect(result.failures.join(" ")).toMatch(/pending detail/);
  });

  it("fails when the same pending component is counted twice", () => {
    const base = recognition();
    const result = reconcileProgressive({
      transactionPriceCents: HOSTED + VALIDATION,
      allocation,
      recognition: { ...base, pending: [...base.pending, base.pending[0]!] },
    });
    expect(result.reconciled).toBe(false);
    expect(result.failures.join(" ")).toMatch(/duplicate pending component/);
  });

  it("fails when the blocked detail disagrees with the blocked amount", () => {
    const base = recognition();
    const result = reconcileProgressive({
      transactionPriceCents: HOSTED + VALIDATION,
      allocation,
      recognition: {
        ...base,
        blocked: [
          {
            poId: "po-validation",
            poName: "Validation package",
            amountCents: 100,
            code: "x",
            message: "x",
          },
        ],
      },
    });
    expect(result.reconciled).toBe(false);
    expect(result.failures.join(" ")).toMatch(/blocked detail/);
  });

  it("fails when the revenue schedule rows disagree with the scheduled amount", () => {
    const base = recognition();
    const result = reconcileProgressive({
      transactionPriceCents: HOSTED + VALIDATION,
      allocation,
      recognition: {
        ...base,
        schedule: { ...base.schedule, byPo: base.schedule.byPo.slice(1) },
      },
    });
    expect(result.reconciled).toBe(false);
    expect(result.failures.join(" ")).toMatch(/revenue schedule rows/);
  });
});

// ---------------------------------------------------------------------------
// 5. Exact money range guarantees
// ---------------------------------------------------------------------------

describe("5. exact money range guarantees", () => {
  it("rejects a pending aggregate outside the supported cent range", () => {
    expect(() =>
      sumPendingCents([
        {
          poId: "a",
          poName: "A",
          amountCents: 9_007_199_254_740_990,
          reason: "awaiting_transfer_date",
        },
        {
          poId: "b",
          poName: "B",
          amountCents: 9_007_199_254_740_990,
          reason: "awaiting_transfer_date",
        },
      ]),
    ).toThrow(MoneyError);
  });

  it("rejects an invalid blocked component amount instead of coercing it", () => {
    expect(() =>
      sumBlockedCents([{ poId: "a", poName: "A", amountCents: 0.5, code: "x", message: "x" }]),
    ).toThrow(MoneyError);
  });
});
