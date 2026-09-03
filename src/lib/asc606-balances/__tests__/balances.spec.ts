import { describe, expect, it } from "vitest";

import {
  analyzeContractBalances,
  type CashCollectionEvent,
  type ConsiderationEvent,
  type ContractBalanceInput,
  type MonthlyContractBalanceRow,
} from "../index";
import { saasRevenueSchedule } from "./helpers";

const PRICE = 24_000_000; // $240,000
const schedule = () => saasRevenueSchedule(PRICE);

function event(over: Partial<ConsiderationEvent> = {}): ConsiderationEvent {
  return {
    id: "ce-1",
    seq: 1,
    amountCents: PRICE,
    unconditionalRightDate: "2027-03-31",
    invoiceDate: "2027-04-01",
    ...over,
  };
}

function cash(over: Partial<CashCollectionEvent> = {}): CashCollectionEvent {
  return {
    id: "cc-1",
    seq: 1,
    considerationEventId: "ce-1",
    amountCents: PRICE,
    collectionDate: "2027-05-15",
    ...over,
  };
}

function input(over: Partial<ContractBalanceInput> = {}): ContractBalanceInput {
  return {
    transactionPriceCents: PRICE,
    revenueSchedule: schedule(),
    considerationEvents: [event()],
    cashCollections: [],
    ...over,
  };
}

const blockingIds = (i: ContractBalanceInput) =>
  analyzeContractBalances(i).validation.blockingFailures.map((f) => f.id);

const row = (rows: MonthlyContractBalanceRow[], month: string) => {
  const found = rows.find((r) => r.month === month);
  if (!found) throw new Error(`month ${month} missing from schedule`);
  return found;
};

describe("consideration-event validation", () => {
  it("blocks empty and duplicate ids", () => {
    expect(blockingIds(input({ considerationEvents: [event({ id: "  " })] }))).toContain(
      "consideration.id.empty",
    );
    expect(
      blockingIds(
        input({
          considerationEvents: [
            event({ amountCents: 12_000_000 }),
            event({ seq: 2, amountCents: 12_000_000 }),
          ],
        }),
      ),
    ).toContain("consideration.id.unique");
  });

  it("blocks invalid and duplicate sequences", () => {
    expect(blockingIds(input({ considerationEvents: [event({ seq: 0 })] }))).toContain(
      "consideration.seq.valid",
    );
    expect(
      blockingIds(
        input({
          considerationEvents: [
            event({ amountCents: 12_000_000 }),
            event({ id: "ce-2", amountCents: 12_000_000 }),
          ],
        }),
      ),
    ).toContain("consideration.seq.unique");
  });

  it("blocks non-positive or non-integer amounts", () => {
    expect(blockingIds(input({ considerationEvents: [event({ amountCents: 0 })] }))).toContain(
      "consideration.amount.valid",
    );
    expect(blockingIds(input({ considerationEvents: [event({ amountCents: -1 })] }))).toContain(
      "consideration.amount.valid",
    );
    expect(blockingIds(input({ considerationEvents: [event({ amountCents: 10.5 })] }))).toContain(
      "consideration.amount.valid",
    );
  });

  it("blocks invalid dates", () => {
    expect(
      blockingIds(input({ considerationEvents: [event({ unconditionalRightDate: "2027-02-30" })] })),
    ).toContain("consideration.unconditional_right_date.valid");
    expect(blockingIds(input({ considerationEvents: [event({ invoiceDate: "" })] }))).toContain(
      "consideration.invoice_date.valid",
    );
  });

  it("requires consideration events to equal the transaction price exactly", () => {
    expect(blockingIds(input({ considerationEvents: [event({ amountCents: 18_000_000 })] }))).toContain(
      "consideration.total.equals_transaction_price",
    );
    expect(blockingIds(input({ considerationEvents: [event({ amountCents: 30_000_000 })] }))).toContain(
      "consideration.total.equals_transaction_price",
    );
    expect(blockingIds(input())).not.toContain("consideration.total.equals_transaction_price");
  });
});

describe("cash collection validation", () => {
  it("accepts a valid collection on or after both dates", () => {
    const result = analyzeContractBalances(input({ cashCollections: [cash()] }));
    expect(result.validation.blockingFailures).toEqual([]);
    expect(result.billingSchedule).not.toBeNull();
  });

  it("accepts partial and multiple collections against one event", () => {
    const result = analyzeContractBalances(
      input({
        cashCollections: [
          cash({ id: "cc-1", seq: 1, amountCents: 2_000_000, collectionDate: "2027-05-15" }),
          cash({ id: "cc-2", seq: 2, amountCents: 4_000_000, collectionDate: "2027-06-15" }),
        ],
      }),
    );
    expect(result.validation.blockingFailures).toEqual([]);
    expect(result.billingSchedule![0]!.cashCollectedCents).toBe(6_000_000);
    expect(result.billingSchedule![0]!.outstandingCents).toBe(PRICE - 6_000_000);
  });

  it("blocks cash before the invoice date", () => {
    expect(blockingIds(input({ cashCollections: [cash({ collectionDate: "2027-03-31" })] }))).toContain(
      "cash.before_invoice_date",
    );
  });

  it("blocks cash before the unconditional-right date", () => {
    expect(
      blockingIds(
        input({
          considerationEvents: [event({ unconditionalRightDate: "2027-06-30", invoiceDate: "2027-01-01" })],
          cashCollections: [cash({ collectionDate: "2027-02-01" })],
        }),
      ),
    ).toContain("cash.before_unconditional_right_date");
  });

  it("blocks a nonexistent consideration-event reference", () => {
    expect(
      blockingIds(input({ cashCollections: [cash({ considerationEventId: "nope" })] })),
    ).toContain("cash.event_reference.valid");
  });

  it("blocks collections exceeding the event amount", () => {
    expect(
      blockingIds(input({ cashCollections: [cash({ amountCents: PRICE + 1 })] })),
    ).toContain("cash.exceeds_event_amount");
  });

  it("blocks invalid ids, sequences, amounts and dates", () => {
    expect(blockingIds(input({ cashCollections: [cash({ id: "" })] }))).toContain("cash.id.empty");
    expect(blockingIds(input({ cashCollections: [cash({ seq: 1.5 })] }))).toContain("cash.seq.valid");
    expect(blockingIds(input({ cashCollections: [cash({ amountCents: 0 })] }))).toContain(
      "cash.amount.valid",
    );
    expect(blockingIds(input({ cashCollections: [cash({ collectionDate: "bad" })] }))).toContain(
      "cash.collection_date.valid",
    );
    expect(
      blockingIds(
        input({
          cashCollections: [
            cash({ id: "cc-1", seq: 1, amountCents: 1_000_000 }),
            cash({ id: "cc-1", seq: 2, amountCents: 1_000_000 }),
          ],
        }),
      ),
    ).toContain("cash.id.unique");
    expect(
      blockingIds(
        input({
          cashCollections: [
            cash({ id: "cc-1", seq: 1, amountCents: 1_000_000 }),
            cash({ id: "cc-2", seq: 1, amountCents: 1_000_000 }),
          ],
        }),
      ),
    ).toContain("cash.seq.unique");
  });
});

describe("accounting horizon", () => {
  it("extends past the revenue schedule for later invoice and cash activity", () => {
    const result = analyzeContractBalances(
      input({
        considerationEvents: [
          event({ unconditionalRightDate: "2027-12-31", invoiceDate: "2028-01-01" }),
        ],
        cashCollections: [cash({ collectionDate: "2028-01-31" })],
      }),
    );
    const months = result.monthly!.map((r) => r.month);
    expect(months[0]).toBe("2027-01");
    expect(months[months.length - 1]).toBe("2028-01");
    const jan = row(result.monthly!, "2028-01");
    expect(jan.revenueCents).toBe(0);
    expect(jan.invoicesIssuedCents).toBe(PRICE);
    expect(jan.cashCollectedCents).toBe(PRICE);
    expect(jan.totalArCents).toBe(0);
  });
});

describe("AR classification", () => {
  it("moves right → unbilled AR, invoice → billed AR, cash → cleared", () => {
    const result = analyzeContractBalances(
      input({
        considerationEvents: [
          event({ unconditionalRightDate: "2027-03-31", invoiceDate: "2027-04-01" }),
        ],
        cashCollections: [cash({ collectionDate: "2027-05-15" })],
      }),
    );
    const rows = result.monthly!;
    expect(row(rows, "2027-03").unbilledArCents).toBe(PRICE);
    expect(row(rows, "2027-03").billedArCents).toBe(0);
    expect(row(rows, "2027-04").billedArCents).toBe(PRICE);
    expect(row(rows, "2027-04").unbilledArCents).toBe(0);
    expect(row(rows, "2027-05").totalArCents).toBe(0);
  });

  it("supports an invoice issued before the unconditional right arises", () => {
    const result = analyzeContractBalances(
      input({
        considerationEvents: [
          event({ unconditionalRightDate: "2027-02-01", invoiceDate: "2027-01-01" }),
        ],
      }),
    );
    const rows = result.monthly!;
    expect(row(rows, "2027-01").totalArCents).toBe(0);
    expect(row(rows, "2027-02").billedArCents).toBe(PRICE);
    expect(row(rows, "2027-02").unbilledArCents).toBe(0);
  });

  it("reduces the outstanding balance for partial then full collection", () => {
    const partial = analyzeContractBalances(
      input({
        considerationEvents: [event({ amountCents: PRICE })],
        cashCollections: [cash({ amountCents: 2_000_000, collectionDate: "2027-05-15" })],
      }),
    );
    expect(row(partial.monthly!, "2027-05").billedArCents).toBe(PRICE - 2_000_000);

    const full = analyzeContractBalances(
      input({
        cashCollections: [
          cash({ id: "cc-1", seq: 1, amountCents: 2_000_000, collectionDate: "2027-05-15" }),
          cash({ id: "cc-2", seq: 2, amountCents: PRICE - 2_000_000, collectionDate: "2027-06-15" }),
        ],
      }),
    );
    expect(row(full.monthly!, "2027-06").billedArCents).toBe(0);
  });
});

describe("blocked analyses produce no authoritative accounting", () => {
  it("returns null schedules and a null reconciliation", () => {
    const result = analyzeContractBalances(
      input({ considerationEvents: [event({ amountCents: 18_000_000 })] }),
    );
    expect(result.monthly).toBeNull();
    expect(result.billingSchedule).toBeNull();
    expect(result.reconciliation.reconciled).toBeNull();
    expect(result.reconciliation.differenceCents).toBeNull();
  });
});

describe("monthly accounting invariants", () => {
  it("holds for every month of a representative arrears-billing contract", () => {
    const events: ConsiderationEvent[] = [
      { id: "q1", seq: 1, amountCents: 6_000_000, unconditionalRightDate: "2027-03-31", invoiceDate: "2027-04-01" },
      { id: "q2", seq: 2, amountCents: 6_000_000, unconditionalRightDate: "2027-06-30", invoiceDate: "2027-07-01" },
      { id: "q3", seq: 3, amountCents: 6_000_000, unconditionalRightDate: "2027-09-30", invoiceDate: "2027-10-01" },
      { id: "q4", seq: 4, amountCents: 6_000_000, unconditionalRightDate: "2027-12-31", invoiceDate: "2028-01-01" },
    ];
    const collections: CashCollectionEvent[] = [
      { id: "c1", seq: 1, considerationEventId: "q1", amountCents: 6_000_000, collectionDate: "2027-04-30" },
      { id: "c2", seq: 2, considerationEventId: "q2", amountCents: 6_000_000, collectionDate: "2027-07-31" },
      { id: "c3", seq: 3, considerationEventId: "q3", amountCents: 6_000_000, collectionDate: "2027-10-31" },
      { id: "c4", seq: 4, considerationEventId: "q4", amountCents: 6_000_000, collectionDate: "2028-01-31" },
    ];
    const result = analyzeContractBalances(
      input({ considerationEvents: events, cashCollections: collections }),
    );
    expect(result.validation.blockingFailures).toEqual([]);
    for (const r of result.monthly!) {
      const billed = BigInt(r.billedArCents);
      const unbilled = BigInt(r.unbilledArCents);
      const ca = BigInt(r.contractAssetCents);
      const cl = BigInt(r.contractLiabilityCents);
      const cumRev = BigInt(r.cumulativeRevenueCents);
      const cumRights = BigInt(r.cumulativeUnconditionalRightsCents);
      const cumCash = BigInt(r.cumulativeCashCollectedCents);

      expect(billed >= 0n).toBe(true);
      expect(unbilled >= 0n).toBe(true);
      expect(ca >= 0n).toBe(true);
      expect(cl >= 0n).toBe(true);
      expect(ca > 0n && cl > 0n).toBe(false);
      expect(billed + unbilled).toBe(BigInt(r.totalArCents));
      expect(billed + unbilled).toBe(cumRights - cumCash);
      expect(cumRev + cl).toBe(cumRights + ca);
      expect(billed + unbilled + ca - cl).toBe(cumRev - cumCash);
    }
    expect(result.reconciliation.reconciled).toBe(true);
    expect(result.reconciliation.differenceCents).toBe(0);
  });
});
