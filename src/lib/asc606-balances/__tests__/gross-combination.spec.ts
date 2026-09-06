/**
 * Phase 5C: the combined presentation adds each contract's separately
 * determined balances GROSS. A contract asset in one presentation group is
 * never netted against a contract liability in another, even in the same month.
 *
 * All companies, customers and amounts are fictional.
 */

import { describe, expect, it } from "vitest";

import { analyzeGroupedContractBalances } from "../groups";
import { saasRevenueSchedule } from "./helpers";

/** Group A: revenue runs ahead of the unconditional right → contract asset. */
function groupA() {
  return {
    groupId: "contract::original",
    label: "Original contract",
    input: {
      transactionPriceCents: 12_000_000,
      revenueSchedule: saasRevenueSchedule(12_000_000),
      considerationEvents: [
        {
          id: "a-ce-1",
          seq: 1,
          amountCents: 12_000_000,
          unconditionalRightDate: "2027-12-31",
          invoiceDate: "2027-12-31",
        },
      ],
      cashCollections: [],
    },
  };
}

/** Group B: the unconditional right runs ahead of revenue → contract liability. */
function groupB() {
  return {
    groupId: "contract::mod::mod-1",
    label: "Separate contract — 2027-01-01",
    input: {
      transactionPriceCents: 6_000_000,
      revenueSchedule: saasRevenueSchedule(6_000_000),
      considerationEvents: [
        {
          id: "b-ce-1",
          seq: 1,
          amountCents: 6_000_000,
          unconditionalRightDate: "2027-01-01",
          invoiceDate: "2027-01-01",
        },
      ],
      cashCollections: [],
    },
  };
}

describe("combined contract balances are gross, never netted", () => {
  const grouped = analyzeGroupedContractBalances([groupA(), groupB()]);
  const month = "2027-06";
  const rowFor = (groupId: string) =>
    grouped.groups
      .find((group) => group.groupId === groupId)!
      .analysis.monthly!.find((row) => row.month === month)!;

  it("produces a contract asset in one group and a contract liability in the other", () => {
    expect(grouped.reconciled).toBe(true);
    expect(rowFor("contract::original").contractAssetCents).toBeGreaterThan(0);
    expect(rowFor("contract::original").contractLiabilityCents).toBe(0);
    expect(rowFor("contract::mod::mod-1").contractLiabilityCents).toBeGreaterThan(0);
    expect(rowFor("contract::mod::mod-1").contractAssetCents).toBe(0);
  });

  it("adds both balances gross in the combined presentation", () => {
    const combined = grouped.combinedMonthly!.find((row) => row.month === month)!;
    const a = rowFor("contract::original");
    const b = rowFor("contract::mod::mod-1");
    expect(combined.contractAssetCents).toBe(a.contractAssetCents + b.contractAssetCents);
    expect(combined.contractLiabilityCents).toBe(
      a.contractLiabilityCents + b.contractLiabilityCents,
    );
    expect(combined.contractAssetCents).toBeGreaterThan(0);
    expect(combined.contractLiabilityCents).toBeGreaterThan(0);
  });
});
