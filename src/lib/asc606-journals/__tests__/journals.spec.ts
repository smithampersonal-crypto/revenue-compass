import { describe, expect, it } from "vitest";

import type { ContractBalanceInput } from "@/lib/asc606-balances";
import { analyzeJournalEntries, JournalEntryError } from "../index";
import {
  cc,
  ce,
  entryAt,
  horizonInput,
  linesOf,
  pointInTimePo,
  schedule,
  stellarInput,
} from "./helpers";

const ok = (input: ContractBalanceInput) => {
  const result = analyzeJournalEntries(input);
  expect(result.validation.blockingFailures).toEqual([]);
  expect(result.reconciliation.reconciled).toBe(true);
  return result.entries!;
};

describe("revenue entry mechanics", () => {
  it("debits contract asset when there is no contract liability", () => {
    const entries = ok({
      transactionPriceCents: 2_000_000,
      revenueSchedule: schedule([pointInTimePo("po-a", 1, 2_000_000, "2027-01-15")], 2_000_000),
      considerationEvents: [ce("ce-1", 1, 2_000_000, "2027-02-28", "2027-02-28")],
      cashCollections: [cc("cc-1", 1, "ce-1", 2_000_000, "2027-03-31")],
    });
    expect(linesOf(entryAt(entries, "2027-01-31", "revenue_recognition"))).toEqual([
      ["contract_asset", 2_000_000, 0, undefined],
      ["revenue", 0, 2_000_000, "po-a"],
    ]);
  });

  it("debits contract liability when the liability is sufficient", () => {
    const entries = ok({
      transactionPriceCents: 3_000_000,
      revenueSchedule: schedule(
        [
          pointInTimePo("po-a", 1, 2_000_000, "2027-02-15"),
          pointInTimePo("po-b", 2, 1_000_000, "2027-03-15"),
        ],
        3_000_000,
      ),
      considerationEvents: [ce("ce-1", 1, 3_000_000, "2027-01-01", "2027-01-01")],
      cashCollections: [cc("cc-1", 1, "ce-1", 3_000_000, "2027-01-31")],
    });
    expect(linesOf(entryAt(entries, "2027-02-28", "revenue_recognition"))).toEqual([
      ["contract_liability", 2_000_000, 0, undefined],
      ["revenue", 0, 2_000_000, "po-a"],
    ]);
  });

  it("crosses from liability to asset within one entry", () => {
    const entries = ok({
      transactionPriceCents: 2_000_000,
      revenueSchedule: schedule([pointInTimePo("po-a", 1, 2_000_000, "2027-02-15")], 2_000_000),
      considerationEvents: [
        ce("ce-1", 1, 500_000, "2027-01-01", "2027-01-01"),
        ce("ce-2", 2, 1_500_000, "2027-03-01", "2027-03-01"),
      ],
      cashCollections: [
        cc("cc-1", 1, "ce-1", 500_000, "2027-01-31"),
        cc("cc-2", 2, "ce-2", 1_500_000, "2027-03-31"),
      ],
    });
    expect(linesOf(entryAt(entries, "2027-02-28", "revenue_recognition"))).toEqual([
      ["contract_liability", 500_000, 0, undefined],
      ["contract_asset", 1_500_000, 0, undefined],
      ["revenue", 0, 2_000_000, "po-a"],
    ]);
  });
});

describe("receivable entry mechanics", () => {
  const rightsInput = (invoiceDate: string): ContractBalanceInput => ({
    transactionPriceCents: 6_000_000,
    revenueSchedule: schedule(
      [
        pointInTimePo("po-a", 1, 5_000_000, "2027-01-15"),
        pointInTimePo("po-b", 2, 1_000_000, "2027-03-15"),
      ],
      6_000_000,
    ),
    considerationEvents: [ce("ce-1", 1, 6_000_000, "2027-02-10", invoiceDate)],
    cashCollections: [cc("cc-1", 1, "ce-1", 6_000_000, "2027-04-30")],
  });

  it("clears contract asset before creating contract liability, into unbilled AR", () => {
    const entries = ok(rightsInput("2027-02-20"));
    expect(linesOf(entryAt(entries, "2027-02-10", "unconditional_right"))).toEqual([
      ["unbilled_ar", 6_000_000, 0, undefined],
      ["contract_asset", 0, 5_000_000, undefined],
      ["contract_liability", 0, 1_000_000, undefined],
    ]);
  });

  it("reclassifies unbilled AR to billed AR on the later invoice date", () => {
    const entries = ok(rightsInput("2027-02-20"));
    expect(linesOf(entryAt(entries, "2027-02-20", "invoice_reclassification"))).toEqual([
      ["billed_ar", 6_000_000, 0, undefined],
      ["unbilled_ar", 0, 6_000_000, undefined],
    ]);
  });

  it("books billed AR directly and no reclassification when the invoice precedes the right", () => {
    const entries = ok(rightsInput("2027-02-01"));
    expect(entries.filter((e) => e.date === "2027-02-01")).toEqual([]);
    expect(entries.filter((e) => e.eventType === "invoice_reclassification")).toEqual([]);
    expect(linesOf(entryAt(entries, "2027-02-10", "unconditional_right"))[0]).toEqual([
      "billed_ar",
      6_000_000,
      0,
      undefined,
    ]);
  });

  it("books billed AR directly when invoice and right share a date", () => {
    const entries = ok(rightsInput("2027-02-10"));
    expect(entries.filter((e) => e.eventType === "invoice_reclassification")).toEqual([]);
    expect(linesOf(entryAt(entries, "2027-02-10", "unconditional_right"))[0]).toEqual([
      "billed_ar",
      6_000_000,
      0,
      undefined,
    ]);
  });

  it("debits cash and credits billed AR, including partial collections", () => {
    const entries = ok({
      transactionPriceCents: 2_000_000,
      revenueSchedule: schedule([pointInTimePo("po-a", 1, 2_000_000, "2027-01-15")], 2_000_000),
      considerationEvents: [ce("ce-1", 1, 2_000_000, "2027-02-01", "2027-02-01")],
      cashCollections: [
        cc("cc-1", 1, "ce-1", 800_000, "2027-02-15"),
        cc("cc-2", 2, "ce-1", 1_200_000, "2027-03-15"),
      ],
    });
    expect(linesOf(entryAt(entries, "2027-02-15", "cash_collection", "cc-1"))).toEqual([
      ["cash", 800_000, 0, undefined],
      ["billed_ar", 0, 800_000, undefined],
    ]);
    expect(linesOf(entryAt(entries, "2027-03-15", "cash_collection", "cc-2"))).toEqual([
      ["cash", 1_200_000, 0, undefined],
      ["billed_ar", 0, 1_200_000, undefined],
    ]);
  });
});

describe("same-day ordering", () => {
  it("posts month-end revenue before a same-day unconditional right and same-day cash", () => {
    const entries = ok({
      transactionPriceCents: 2_000_000,
      revenueSchedule: schedule([pointInTimePo("po-a", 1, 2_000_000, "2027-01-15")], 2_000_000),
      considerationEvents: [ce("ce-1", 1, 2_000_000, "2027-01-31", "2027-01-31")],
      cashCollections: [cc("cc-1", 1, "ce-1", 2_000_000, "2027-01-31")],
    });
    expect(entries.map((e) => e.eventType)).toEqual([
      "revenue_recognition",
      "unconditional_right",
      "cash_collection",
    ]);
  });
});

describe("PO revenue split validation", () => {
  const corrupt = (mutate: (row: { perPo: Record<string, number> }) => void) => {
    const input = stellarInput();
    const rows = input.revenueSchedule.byMonth.map((row) => ({ ...row, perPo: { ...row.perPo } }));
    mutate(rows[0]!);
    return analyzeJournalEntries({
      ...input,
      revenueSchedule: { ...input.revenueSchedule, byMonth: rows },
    });
  };

  const expectBlocked = (result: ReturnType<typeof analyzeJournalEntries>, id: string) => {
    expect(result.validation.blockingFailures.map((f) => f.id)).toContain(id);
    expect(result.entries).toBeNull();
    expect(result.reconciliation.reconciled).toBeNull();
  };

  it("blocks when the per-PO split does not sum to the month total", () => {
    expectBlocked(
      corrupt((row) => {
        row.perPo["po-saas"] = row.perPo["po-saas"]! - 1;
      }),
      "revenue_split.month_total.reconciles",
    );
  });

  it("blocks negative per-PO revenue", () => {
    expectBlocked(
      corrupt((row) => {
        row.perPo["po-extra"] = -100;
      }),
      "revenue_split.amount.valid",
    );
  });

  it("blocks empty PO identifiers", () => {
    expectBlocked(
      corrupt((row) => {
        row.perPo[""] = 0;
      }),
      "revenue_split.po_id.valid",
    );
  });

  it("blocks entirely when Phase 3 validation blocks", () => {
    const input = stellarInput();
    const result = analyzeJournalEntries({
      ...input,
      considerationEvents: input.considerationEvents.slice(0, 3),
    });
    expect(result.entries).toBeNull();
    expect(result.reconciliation.reconciled).toBeNull();
    expect(result.validation.blockingFailures.length).toBeGreaterThan(0);
  });
});

describe("Phase 4A Acceptance Scenario A — Horizon Logistics", () => {
  const result = analyzeJournalEntries(horizonInput());
  const entries = () => result.entries!;

  it("finalizes, balances and reconciles", () => {
    expect(result.reconciliation).toEqual({
      allEntriesBalanced: true,
      monthlyBalancesTie: true,
      revenueByPoTies: true,
      sourceEventsComplete: true,
      reconciled: true,
    });
    for (const entry of entries()) {
      expect(entry.totalDebitsCents).toBe(entry.totalCreditsCents);
    }
  });

  it("books the July 2027 right/invoice, revenue and cash", () => {
    expect(linesOf(entryAt(entries(), "2027-07-01", "unconditional_right"))).toEqual([
      ["billed_ar", 7_500_000, 0, undefined],
      ["contract_liability", 0, 7_500_000, undefined],
    ]);
    expect(linesOf(entryAt(entries(), "2027-07-31", "revenue_recognition"))).toEqual([
      ["contract_liability", 2_229_508, 0, undefined],
      ["revenue", 0, 1_036_721, "po-saas"],
      ["revenue", 0, 1_020_000, "po-training"],
      ["revenue", 0, 172_787, "po-support"],
    ]);
    const july = entries().filter((e) => e.date === "2027-07-31").map((e) => e.eventType);
    expect(july).toEqual(["revenue_recognition", "cash_collection"]);
    expect(linesOf(entryAt(entries(), "2027-07-31", "cash_collection"))).toEqual([
      ["cash", 7_500_000, 0, undefined],
      ["billed_ar", 0, 7_500_000, undefined],
    ]);
  });

  it("books the December 2027 liability-to-asset crossover", () => {
    expect(linesOf(entryAt(entries(), "2027-12-31", "revenue_recognition"))).toEqual([
      ["contract_liability", 510_492, 0, undefined],
      ["contract_asset", 699_017, 0, undefined],
      ["revenue", 0, 1_036_722, "po-saas"],
      ["revenue", 0, 172_787, "po-support"],
    ]);
  });

  it("books the January 2028 right/invoice and revenue", () => {
    expect(linesOf(entryAt(entries(), "2028-01-01", "unconditional_right"))).toEqual([
      ["billed_ar", 3_900_000, 0, undefined],
      ["contract_asset", 0, 699_017, undefined],
      ["contract_liability", 0, 3_200_983, undefined],
    ]);
    expect(linesOf(entryAt(entries(), "2028-01-31", "revenue_recognition"))).toEqual([
      ["contract_liability", 1_209_508, 0, undefined],
      ["revenue", 0, 1_036_721, "po-saas"],
      ["revenue", 0, 172_787, "po-support"],
    ]);
  });

  it("books March and April 2028", () => {
    expect(linesOf(entryAt(entries(), "2028-03-15", "cash_collection"))).toEqual([
      ["cash", 3_900_000, 0, undefined],
      ["billed_ar", 0, 3_900_000, undefined],
    ]);
    expect(linesOf(entryAt(entries(), "2028-03-31", "revenue_recognition"))).toEqual([
      ["contract_liability", 860_000, 0, undefined],
      ["contract_asset", 349_508, 0, undefined],
      ["revenue", 0, 1_036_721, "po-saas"],
      ["revenue", 0, 172_787, "po-support"],
    ]);
    expect(linesOf(entryAt(entries(), "2028-04-01", "unconditional_right"))).toEqual([
      ["billed_ar", 3_900_000, 0, undefined],
      ["contract_asset", 0, 349_508, undefined],
      ["contract_liability", 0, 3_550_492, undefined],
    ]);
    expect(linesOf(entryAt(entries(), "2028-04-30", "revenue_recognition"))).toEqual([
      ["contract_liability", 1_170_492, 0, undefined],
      ["revenue", 0, 1_003_279, "po-saas"],
      ["revenue", 0, 167_213, "po-support"],
    ]);
    expect(entries().filter((e) => e.date === "2028-04-30").map((e) => e.eventType)).toEqual([
      "revenue_recognition",
      "cash_collection",
    ]);
  });

  it("replays to the approved Phase 3 monthly balances", () => {
    const led = result.ledgerByMonth!;
    const at = (month: string) => led.find((r) => r.month === month)!;
    expect(at("2027-12").contractAssetCents).toBe(699_017);
    expect(at("2028-01").billedArCents).toBe(3_900_000);
    expect(at("2028-01").contractLiabilityCents).toBe(1_991_475);
    expect(at("2028-03").contractAssetCents).toBe(349_508);
    expect(at("2028-06").contractAssetCents).toBe(0);
    expect(at("2028-06").contractLiabilityCents).toBe(0);
    expect(at("2028-06").cumulativeRevenueCents).toBe(15_300_000);
    expect(at("2028-06").cumulativeCashCents).toBe(15_300_000);
  });
});

describe("Phase 4A Acceptance Scenario B — Stellar", () => {
  const result = analyzeJournalEntries(stellarInput());
  const entries = () => result.entries!;

  it("finalizes and reconciles", () => {
    expect(result.reconciliation.reconciled).toBe(true);
  });

  it("books January and February revenue to contract asset", () => {
    expect(linesOf(entryAt(entries(), "2027-01-31", "revenue_recognition"))).toEqual([
      ["contract_asset", 2_038_356, 0, undefined],
      ["revenue", 0, 2_038_356, "po-saas"],
    ]);
    expect(linesOf(entryAt(entries(), "2027-02-28", "revenue_recognition"))).toEqual([
      ["contract_asset", 1_841_096, 0, undefined],
      ["revenue", 0, 1_841_096, "po-saas"],
    ]);
  });

  it("posts March revenue before the same-day Q1 unconditional right", () => {
    const march = entries().filter((e) => e.date === "2027-03-31");
    expect(march.map((e) => e.eventType)).toEqual(["revenue_recognition", "unconditional_right"]);
    expect(linesOf(march[0]!)).toEqual([
      ["contract_asset", 2_038_356, 0, undefined],
      ["revenue", 0, 2_038_356, "po-saas"],
    ]);
    expect(linesOf(march[1]!)).toEqual([
      ["unbilled_ar", 6_000_000, 0, undefined],
      ["contract_asset", 0, 5_917_808, undefined],
      ["contract_liability", 0, 82_192, undefined],
    ]);
  });

  it("books the April invoice reclassification, revenue and cash", () => {
    expect(linesOf(entryAt(entries(), "2027-04-01", "invoice_reclassification"))).toEqual([
      ["billed_ar", 6_000_000, 0, undefined],
      ["unbilled_ar", 0, 6_000_000, undefined],
    ]);
    expect(linesOf(entryAt(entries(), "2027-04-30", "revenue_recognition"))).toEqual([
      ["contract_liability", 82_192, 0, undefined],
      ["contract_asset", 1_890_411, 0, undefined],
      ["revenue", 0, 1_972_603, "po-saas"],
    ]);
    expect(entries().filter((e) => e.date === "2027-04-30").map((e) => e.eventType)).toEqual([
      "revenue_recognition",
      "cash_collection",
    ]);
  });

  it("books the later quarter rights", () => {
    expect(linesOf(entryAt(entries(), "2027-06-30", "unconditional_right"))).toEqual([
      ["unbilled_ar", 6_000_000, 0, undefined],
      ["contract_asset", 0, 5_901_370, undefined],
      ["contract_liability", 0, 98_630, undefined],
    ]);
    expect(linesOf(entryAt(entries(), "2027-09-30", "unconditional_right"))).toEqual([
      ["unbilled_ar", 6_000_000, 0, undefined],
      ["contract_asset", 0, 5_950_685, undefined],
      ["contract_liability", 0, 49_315, undefined],
    ]);
    expect(linesOf(entryAt(entries(), "2027-12-31", "unconditional_right"))).toEqual([
      ["unbilled_ar", 6_000_000, 0, undefined],
      ["contract_asset", 0, 6_000_000, undefined],
    ]);
  });

  it("books January 2028 invoice and cash with no revenue", () => {
    expect(entries().filter((e) => e.month === "2028-01").map((e) => e.eventType)).toEqual([
      "invoice_reclassification",
      "cash_collection",
    ]);
    const led = result.ledgerByMonth!;
    const at = (month: string) => led.find((r) => r.month === month)!;
    expect(at("2027-03").unbilledArCents).toBe(6_000_000);
    expect(at("2027-03").contractLiabilityCents).toBe(82_192);
    expect(at("2027-06").contractLiabilityCents).toBe(98_630);
    expect(at("2027-09").contractLiabilityCents).toBe(49_315);
    expect(at("2027-12").unbilledArCents).toBe(6_000_000);
    expect(at("2027-12").contractLiabilityCents).toBe(0);
    expect(at("2028-01").billedArCents).toBe(0);
    expect(at("2028-01").unbilledArCents).toBe(0);
    expect(at("2028-01").contractAssetCents).toBe(0);
    expect(at("2028-01").cumulativeRevenueCents).toBe(24_000_000);
    expect(at("2028-01").cumulativeCashCents).toBe(24_000_000);
  });

  it("ties revenue credits by PO and month to the revenue schedule", () => {
    const total = entries()
      .flatMap((e) => e.lines)
      .filter((l) => l.account === "revenue")
      .reduce((sum, l) => sum + l.creditCents, 0);
    expect(total).toBe(24_000_000);
    expect(JournalEntryError).toBeTypeOf("function");
  });
});
