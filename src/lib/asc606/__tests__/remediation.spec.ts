/**
 * Phase 1 remediation regression tests.
 *
 * Issue 1 — duplicate performance-obligation IDs
 * Issue 2 — negative final-month revenue from independent monthly rounding
 * Issue 3 — aggregate SSP outside the supported exact range
 */

import { describe, expect, it } from "vitest";

import { allocateTransactionPrice } from "../allocation";
import { analyzePhase1 } from "../index";
import { MAX_CENTS } from "../money";
import { recognizeOverTime } from "../recognition";
import { overTimePo, pointInTimePo } from "./fixtures";

describe("Issue 1 — duplicate performance obligation IDs", () => {
  const analysis = analyzePhase1({
    transactionPriceCents: 12_000_000,
    performanceObligations: [
      overTimePo({ id: "same", seq: 1, sspCents: 12_000_000, name: "SaaS" }),
      pointInTimePo({ id: "same", seq: 2, sspCents: 2_000_000, name: "Training" }),
    ],
  });

  it("blocks the analysis instead of silently losing an allocation", () => {
    expect(analysis.validation.status).toBe("attention");
    expect(analysis.validation.blockingFailures.map((f) => f.id)).toContain("po.id.unique");
    expect(analysis.allocation).toBeNull();
    expect(analysis.revenueSchedule).toBeNull();
  });

  it("blocks empty performance obligation IDs", () => {
    const empty = analyzePhase1({
      transactionPriceCents: 1_000_000,
      performanceObligations: [overTimePo({ id: "  ", seq: 1, sspCents: 1_000_000 })],
    });
    expect(empty.validation.blockingFailures.map((f) => f.id)).toContain("po.id.unique");
    expect(empty.allocation).toBeNull();
  });

  it("rejects duplicate and empty IDs in allocateTransactionPrice directly", () => {
    expect(() =>
      allocateTransactionPrice({
        transactionPriceCents: 1000,
        performanceObligations: [
          overTimePo({ id: "a", seq: 1, sspCents: 500 }),
          overTimePo({ id: "a", seq: 2, sspCents: 500 }),
        ],
      }),
    ).toThrow(/duplicate performance obligation id/i);
    expect(() =>
      allocateTransactionPrice({
        transactionPriceCents: 1000,
        performanceObligations: [overTimePo({ id: "", seq: 1, sspCents: 500 })],
      }),
    ).toThrow(/non-empty/i);
  });
});

describe("Issue 2 — cumulative-to-date rounding", () => {
  it("never produces a negative month for a 7-cent annual PO", () => {
    const rows = recognizeOverTime(overTimePo({ id: "po", seq: 1, sspCents: 7 }), 7);
    expect(rows.map((row) => row.revenueCents)).toEqual([1, 0, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1]);
    expect(rows.reduce((total, row) => total + row.revenueCents, 0)).toBe(7);
  });

  it("never produces negative monthly revenue across small allocations and periods", () => {
    const periods: Array<[string, string]> = [
      ["2027-01-01", "2027-12-31"],
      ["2027-01-15", "2027-12-31"],
      ["2028-01-01", "2028-12-31"],
      ["2027-02-14", "2029-03-02"],
      ["2027-06-30", "2027-06-30"],
    ];
    for (let allocated = 0; allocated <= 60; allocated += 1) {
      for (const [serviceStart, serviceEnd] of periods) {
        const rows = recognizeOverTime(
          overTimePo({ id: "po", seq: 1, sspCents: Math.max(allocated, 1), serviceStart, serviceEnd }),
          allocated,
        );
        expect(rows.every((row) => row.revenueCents >= 0)).toBe(true);
        let cumulative = 0;
        for (const row of rows) {
          cumulative += row.revenueCents;
          expect(cumulative).toBeGreaterThanOrEqual(0);
        }
        expect(cumulative).toBe(allocated);
      }
    }
  });
});

describe("Issue 3 — aggregate SSP supported range", () => {
  it("blocks instead of throwing when total SSP exceeds the supported range", () => {
    const half = Math.floor(MAX_CENTS / 2);
    const analysis = analyzePhase1({
      transactionPriceCents: 1_000_000,
      performanceObligations: [
        overTimePo({ id: "a", seq: 1, sspCents: half }),
        overTimePo({ id: "b", seq: 2, sspCents: half }),
        overTimePo({ id: "c", seq: 3, sspCents: half }),
      ],
    });
    expect(analysis.validation.status).toBe("attention");
    expect(analysis.validation.blockingFailures.map((f) => f.id)).toContain(
      "allocation.total_ssp.supported_range",
    );
    expect(analysis.allocation).toBeNull();
    expect(analysis.revenueSchedule).toBeNull();
  });

  it("requires every SSP to be strictly positive in allocateTransactionPrice", () => {
    expect(() =>
      allocateTransactionPrice({
        transactionPriceCents: 1000,
        performanceObligations: [
          overTimePo({ id: "a", seq: 1, sspCents: 1000 }),
          overTimePo({ id: "b", seq: 2, sspCents: 0 }),
        ],
      }),
    ).toThrow(/greater than zero/i);
  });
});
