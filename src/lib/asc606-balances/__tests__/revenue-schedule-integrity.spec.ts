/**
 * Phase 3 remediation — the balance engine must independently reject an
 * internally inconsistent RevenueSchedule before producing authoritative
 * billing, rollforward or reconciliation output.
 */

import { describe, expect, it } from "vitest";

import type { RevenueSchedule } from "@/lib/asc606";
import {
  analyzeContractBalances,
  type ConsiderationEvent,
  type ContractBalanceInput,
} from "../index";
import { saasRevenueSchedule } from "./helpers";

const PRICE = 24_000_000; // $240,000

const events: ConsiderationEvent[] = [
  {
    id: "ce-1",
    seq: 1,
    amountCents: PRICE,
    unconditionalRightDate: "2027-03-31",
    invoiceDate: "2027-04-01",
  },
];

function input(revenueSchedule: RevenueSchedule, price = PRICE): ContractBalanceInput {
  return {
    transactionPriceCents: price,
    revenueSchedule,
    considerationEvents: events,
    cashCollections: [],
  };
}

const blockingIds = (i: ContractBalanceInput) =>
  analyzeContractBalances(i).validation.blockingFailures.map((f) => f.id);

function expectFullyBlocked(i: ContractBalanceInput) {
  const analysis = analyzeContractBalances(i);
  expect(analysis.validation.status).toBe("attention");
  expect(analysis.validation.blockingFailures.length).toBeGreaterThan(0);
  expect(analysis.billingSchedule).toBeNull();
  expect(analysis.monthly).toBeNull();
  expect(analysis.reconciliation.reconciled).not.toBe(true);
  return analysis;
}

describe("revenue-schedule integrity validation", () => {
  it("Test 1 — blocks an empty monthly schedule with a nonzero total", () => {
    const schedule: RevenueSchedule = {
      ...saasRevenueSchedule(PRICE),
      byMonth: [],
      firstMonth: null,
      lastMonth: null,
    };
    expectFullyBlocked(input(schedule));
    expect(blockingIds(input(schedule))).toContain("revenue_schedule.monthly_total.reconciles");
  });

  it("Test 2 — blocks a one-cent monthly mismatch against totalCents", () => {
    const base = saasRevenueSchedule(PRICE);
    const byMonth = base.byMonth.map((row, index) =>
      index === 0
        ? { ...row, totalCents: row.totalCents + 1, cumulativeCents: row.cumulativeCents + 1 }
        : { ...row, cumulativeCents: row.cumulativeCents + 1 },
    );
    const schedule: RevenueSchedule = { ...base, byMonth };
    expectFullyBlocked(input(schedule));
    expect(blockingIds(input(schedule))).toContain("revenue_schedule.monthly_total.reconciles");
  });

  it("Test 3 — blocks a revenue total that differs from the transaction price", () => {
    const base = saasRevenueSchedule(PRICE);
    const last = base.byMonth.length - 1;
    const byMonth = base.byMonth.map((row, index) =>
      index === last
        ? { ...row, totalCents: row.totalCents - 1, cumulativeCents: row.cumulativeCents - 1 }
        : row,
    );
    const schedule: RevenueSchedule = { ...base, byMonth, totalCents: base.totalCents - 1 };
    expectFullyBlocked(input(schedule));
    expect(blockingIds(input(schedule))).toContain(
      "revenue_schedule.total.equals_transaction_price",
    );
  });

  it("Test 4 — blocks duplicate revenue months without silent aggregation", () => {
    const base = saasRevenueSchedule(PRICE);
    const first = base.byMonth[0]!;
    const schedule: RevenueSchedule = {
      ...base,
      byMonth: [{ ...first }, ...base.byMonth],
      totalCents: base.totalCents + first.totalCents,
    };
    expectFullyBlocked(input(schedule, PRICE + first.totalCents));
    expect(blockingIds(input(schedule, PRICE + first.totalCents))).toContain(
      "revenue_schedule.month.unique",
    );
  });

  it("Test 5 — blocks an invalid revenue month key", () => {
    const base = saasRevenueSchedule(PRICE);
    const byMonth = base.byMonth.map((row, index) =>
      index === 0 ? { ...row, month: "2027-13" } : row,
    );
    expectFullyBlocked(input({ ...base, byMonth }));
    expect(blockingIds(input({ ...base, byMonth }))).toContain("revenue_schedule.month.valid");
  });

  it("Test 6 — blocks a negative monthly revenue amount", () => {
    const base = saasRevenueSchedule(PRICE);
    const byMonth = base.byMonth.map((row, index) =>
      index === 0
        ? { ...row, totalCents: -100 }
        : index === 1
          ? { ...row, totalCents: row.totalCents + base.byMonth[0]!.totalCents + 100 }
          : row,
    );
    expectFullyBlocked(input({ ...base, byMonth }));
    expect(blockingIds(input({ ...base, byMonth }))).toContain("revenue_schedule.amount.valid");
  });

  it("Test 6b — blocks broken cumulative revenue metadata", () => {
    const base = saasRevenueSchedule(PRICE);
    const last = base.byMonth.length - 1;
    const byMonth = base.byMonth.map((row, index) =>
      index === last ? { ...row, cumulativeCents: row.cumulativeCents - 1 } : row,
    );
    expectFullyBlocked(input({ ...base, byMonth }));
    expect(blockingIds(input({ ...base, byMonth }))).toContain(
      "revenue_schedule.cumulative.reconciles",
    );
  });

  it("Test 7 — a valid revenue schedule still passes and reconciles", () => {
    const analysis = analyzeContractBalances({
      transactionPriceCents: PRICE,
      revenueSchedule: saasRevenueSchedule(PRICE),
      considerationEvents: events,
      cashCollections: [
        {
          id: "cc-1",
          seq: 1,
          considerationEventId: "ce-1",
          amountCents: PRICE,
          collectionDate: "2027-05-15",
        },
      ],
    });
    expect(analysis.validation.status).toBe("passed");
    expect(analysis.monthly).not.toBeNull();
    expect(analysis.billingSchedule).not.toBeNull();
    expect(analysis.reconciliation.reconciled).toBe(true);
    const rows = analysis.monthly!;
    expect(rows[rows.length - 1]!.cumulativeRevenueCents).toBe(PRICE);
  });
});
