/**
 * Invariant tests: properties that must hold for every valid contract.
 */

import { describe, expect, it } from "vitest";

import { allocateTransactionPrice } from "../allocation";
import { analyzePhase1 } from "../index";
import { recognizeOverTime, recognizePointInTime } from "../recognition";
import { overTimePo, pointInTimePo } from "./fixtures";

const CASES = [
  { transactionPriceCents: 10_000_000, ssps: [1_000_000, 1_000_000, 1_000_000] },
  { transactionPriceCents: 12_000_000, ssps: [12_000_000, 2_000_000] },
  { transactionPriceCents: 13_500_000, ssps: [13_000_000, 2_000_000] },
  { transactionPriceCents: 999_999, ssps: [333_333, 333_333, 333_334] },
  { transactionPriceCents: 1, ssps: [7, 11, 13] },
  { transactionPriceCents: 8_437_513, ssps: [2_111_111, 3_333_333, 4_444_449] },
];

describe("allocation invariants", () => {
  it("always sums to the transaction price", () => {
    for (const testCase of CASES) {
      const rows = allocateTransactionPrice({
        transactionPriceCents: testCase.transactionPriceCents,
        performanceObligations: testCase.ssps.map((sspCents, index) =>
          overTimePo({ id: `po${index + 1}`, seq: index + 1, sspCents }),
        ),
      });
      expect(rows.reduce((total, row) => total + row.allocatedCents, 0)).toBe(
        testCase.transactionPriceCents,
      );
    }
  });

  it("is independent of the order the POs are supplied in", () => {
    const pos = [
      overTimePo({ id: "a", seq: 1, sspCents: 1_000_000 }),
      overTimePo({ id: "b", seq: 2, sspCents: 1_000_000 }),
      overTimePo({ id: "c", seq: 3, sspCents: 1_000_000 }),
    ];
    const forward = allocateTransactionPrice({ transactionPriceCents: 10_000_000, performanceObligations: pos });
    const reversed = allocateTransactionPrice({
      transactionPriceCents: 10_000_000,
      performanceObligations: [...pos].reverse(),
    });
    expect(reversed).toEqual(forward);
    expect(forward.map((row) => row.poId)).toEqual(["a", "b", "c"]);
  });

  it("breaks equal fractional remainders by lowest sequence number", () => {
    const rows = allocateTransactionPrice({
      transactionPriceCents: 100, // $1.00 across three equal POs
      performanceObligations: [
        overTimePo({ id: "later", seq: 7, sspCents: 500 }),
        overTimePo({ id: "earlier", seq: 2, sspCents: 500 }),
        overTimePo({ id: "middle", seq: 5, sspCents: 500 }),
      ],
    });
    expect(rows.map((row) => [row.poId, row.allocatedCents])).toEqual([
      ["earlier", 34],
      ["middle", 33],
      ["later", 33],
    ]);
  });

  it("rejects duplicate sequence numbers and negative SSP", () => {
    expect(() =>
      allocateTransactionPrice({
        transactionPriceCents: 1000,
        performanceObligations: [
          overTimePo({ id: "a", seq: 1, sspCents: 500 }),
          overTimePo({ id: "b", seq: 1, sspCents: 500 }),
        ],
      }),
    ).toThrow(/duplicate/);
    expect(() =>
      allocateTransactionPrice({
        transactionPriceCents: 1000,
        performanceObligations: [overTimePo({ id: "a", seq: 1, sspCents: -500 })],
      }),
    ).toThrow();
  });
});

describe("recognition invariants", () => {
  it("each PO schedule sums to its allocation", () => {
    const periods: Array<[string, string]> = [
      ["2027-01-01", "2027-12-31"],
      ["2027-01-15", "2027-12-31"],
      ["2028-01-01", "2028-12-31"],
      ["2027-02-14", "2029-03-02"],
      ["2027-06-30", "2027-06-30"],
    ];
    for (const allocated of [1, 999_999, 10_285_714, 11_700_000, 36_600_000]) {
      for (const [serviceStart, serviceEnd] of periods) {
        const rows = recognizeOverTime(
          overTimePo({ id: "po", seq: 1, sspCents: allocated, serviceStart, serviceEnd }),
          allocated,
        );
        expect(rows.reduce((total, row) => total + row.revenueCents, 0)).toBe(allocated);
        expect(rows.every((row) => Number.isInteger(row.revenueCents))).toBe(true);
      }
    }
  });

  it("point-in-time recognition books the full allocation in one month", () => {
    const rows = recognizePointInTime(
      pointInTimePo({ id: "po", seq: 1, sspCents: 1_714_286, recognitionDate: "2027-02-10" }),
      1_714_286,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.month).toBe("2027-02");
    expect(rows[0]!.revenueCents).toBe(1_714_286);
  });

  it("contract-level revenue always equals the transaction price", () => {
    for (const testCase of CASES) {
      const analysis = analyzePhase1({
        transactionPriceCents: testCase.transactionPriceCents,
        performanceObligations: testCase.ssps.map((sspCents, index) =>
          index % 2 === 0
            ? overTimePo({ id: `po${index}`, seq: index + 1, sspCents })
            : pointInTimePo({ id: `po${index}`, seq: index + 1, sspCents }),
        ),
      });
      expect(analysis.revenueSchedule!.totalCents).toBe(testCase.transactionPriceCents);
      expect(analysis.totals.allocatedCents).toBe(testCase.transactionPriceCents);
    }
  });

  it("refuses unsupported over-time conventions", () => {
    expect(() =>
      recognizeOverTime(
        overTimePo({ id: "po", seq: 1, sspCents: 1000 }),
        1000,
        "monthly_straight_line" as never,
      ),
    ).toThrow(/unsupported over-time convention/);
  });

  it("invalid date sequences cannot produce a schedule", () => {
    expect(() =>
      recognizeOverTime(
        overTimePo({ id: "po", seq: 1, sspCents: 1000, serviceStart: "2027-05-01", serviceEnd: "2027-04-30" }),
        1000,
      ),
    ).toThrow();
  });

  it("outputs remain JSON-serializable (no BigInt leakage)", () => {
    const analysis = analyzePhase1({
      transactionPriceCents: 12_000_000,
      performanceObligations: [overTimePo({ id: "po1", seq: 1, sspCents: 12_000_000 })],
    });
    expect(() => JSON.stringify(analysis)).not.toThrow();
  });
});
