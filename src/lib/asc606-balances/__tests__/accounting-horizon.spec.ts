/**
 * Accounting-horizon protection: transient/absurd dates must produce a normal
 * blocking validation state, never an enormous month enumeration.
 */

import { describe, expect, it } from "vitest";
import {
  inclusiveMonthCount,
  monthRange,
  nextMonth,
  toIsoDate,
  MAX_SUPPORTED_ACCOUNTING_HORIZON_MONTHS,
} from "@/lib/asc606";
import { analyzeContractBalances, type ContractBalanceInput } from "@/lib/asc606-balances";
import { saasRevenueSchedule } from "./helpers";

const AMOUNT = 12_000_00;

function baseInput(overrides: Partial<ContractBalanceInput> = {}): ContractBalanceInput {
  return {
    transactionPriceCents: AMOUNT,
    revenueSchedule: saasRevenueSchedule(AMOUNT),
    considerationEvents: [
      {
        id: "ce-1",
        seq: 1,
        amountCents: AMOUNT,
        unconditionalRightDate: "2027-01-31",
        invoiceDate: "2027-01-31",
      },
    ],
    cashCollections: [
      {
        id: "cash-1",
        seq: 1,
        considerationEventId: "ce-1",
        amountCents: AMOUNT,
        collectionDate: "2027-02-28",
      },
    ],
    ...overrides,
  };
}

const horizonBlocked = (analysis: ReturnType<typeof analyzeContractBalances>) =>
  analysis.validation.blockingFailures.some((f) => f.id === "accounting_horizon.supported_range");

describe("four-digit year padding remains intact", () => {
  it("pads month keys and ISO dates", () => {
    expect(nextMonth("0002-10")).toBe("0002-11");
    expect(monthRange("0002-10", "0002-12")).toEqual(["0002-10", "0002-11", "0002-12"]);
    expect(toIsoDate({ year: 2, month: 11, day: 1 })).toBe("0002-11-01");
    expect(nextMonth("0999-12")).toBe("1000-01");
  });
});

describe("Phase 3 accounting horizon", () => {
  it("blocks a transient small-year unconditional-right date", () => {
    const analysis = analyzeContractBalances(
      baseInput({
        considerationEvents: [
          {
            id: "ce-1",
            seq: 1,
            amountCents: AMOUNT,
            unconditionalRightDate: "0002-03-31",
            invoiceDate: "2027-01-31",
          },
        ],
      }),
    );
    expect(horizonBlocked(analysis)).toBe(true);
    expect(analysis.monthly).toBeNull();
    expect(analysis.billingSchedule).toBeNull();
    expect(analysis.reconciliation.reconciled).toBeNull();
  });

  it("blocks a far-future cash collection outlier", () => {
    const analysis = analyzeContractBalances(
      baseInput({
        cashCollections: [
          {
            id: "cash-1",
            seq: 1,
            considerationEventId: "ce-1",
            amountCents: AMOUNT,
            collectionDate: "2099-01-31",
          },
        ],
      }),
    );
    expect(horizonBlocked(analysis)).toBe(true);
    expect(analysis.monthly).toBeNull();
  });

  it("produces normal output once the dates are valid", () => {
    const analysis = analyzeContractBalances(baseInput());
    expect(horizonBlocked(analysis)).toBe(false);
    expect(analysis.monthly).not.toBeNull();
    expect(analysis.reconciliation.reconciled).toBe(true);
  });

  it("accepts a 240-month horizon and blocks 241 months", () => {
    expect(inclusiveMonthCount("2027-01", "2046-12")).toBe(MAX_SUPPORTED_ACCOUNTING_HORIZON_MONTHS);
    expect(inclusiveMonthCount("2027-01", "2047-01")).toBe(
      MAX_SUPPORTED_ACCOUNTING_HORIZON_MONTHS + 1,
    );

    const accepted = analyzeContractBalances(
      baseInput({
        cashCollections: [
          {
            id: "cash-1",
            seq: 1,
            considerationEventId: "ce-1",
            amountCents: AMOUNT,
            collectionDate: "2046-12-31",
          },
        ],
      }),
    );
    expect(horizonBlocked(accepted)).toBe(false);

    const rejected = analyzeContractBalances(
      baseInput({
        cashCollections: [
          {
            id: "cash-1",
            seq: 1,
            considerationEventId: "ce-1",
            amountCents: AMOUNT,
            collectionDate: "2047-01-31",
          },
        ],
      }),
    );
    expect(horizonBlocked(rejected)).toBe(true);
    expect(rejected.monthly).toBeNull();
  });
});
