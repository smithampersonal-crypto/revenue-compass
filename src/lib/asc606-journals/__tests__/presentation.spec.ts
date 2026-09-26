import { describe, expect, it } from "vitest";

import type { JournalAnalysis, JournalEntry } from "../types";
import { summarizeJournal } from "../presentation";

function entry(id: string, month: string, debit: number, credit = debit): JournalEntry {
  return {
    id,
    date: `${month}-01` as JournalEntry["date"],
    month: month as JournalEntry["month"],
    eventType: "revenue_recognition",
    sourceId: null,
    description: id,
    lines: [],
    totalDebitsCents: debit as JournalEntry["totalDebitsCents"],
    totalCreditsCents: credit as JournalEntry["totalCreditsCents"],
  };
}

const ok = {
  allEntriesBalanced: true,
  monthlyBalancesTie: true,
  revenueByPoTies: true,
  sourceEventsComplete: true,
  reconciled: true,
};

function analysis(entries: JournalEntry[] | null, reconciliation = ok): JournalAnalysis {
  return {
    validation: { status: "passed", results: [], blockingFailures: [] },
    entries,
    ledgerByMonth: null,
    reconciliation,
  } as JournalAnalysis;
}

describe("summarizeJournal (3D-P presentation only)", () => {
  it("counts distinct entries and periods and sums debits/credits", () => {
    const s = summarizeJournal(
      analysis([entry("a", "2026-01", 100), entry("b", "2026-01", 250), entry("c", "2026-02", 50)]),
    )!;
    expect(s.entryCount).toBe(3);
    expect(s.periodCount).toBe(2);
    expect(s.totalDebitsCents).toBe(400);
    expect(s.totalCreditsCents).toBe(400);
    expect(s.status).toEqual({ kind: "reconciled" });
    expect(s.issues).toEqual([]);
  });

  it("reports an out-of-balance difference", () => {
    const s = summarizeJournal(
      analysis([entry("a", "2026-01", 1000, 850)], { ...ok, allEntriesBalanced: false, reconciled: false }),
    )!;
    expect(s.status).toEqual({ kind: "out_of_balance", differenceCents: 150 });
    expect(s.issues.map((i) => i.label)).toEqual(["All entries balanced", "Overall reconciled"]);
  });

  it("reports not reconciled with failed and not-evaluated checks", () => {
    const s = summarizeJournal(
      analysis([entry("a", "2026-01", 10)], {
        ...ok,
        monthlyBalancesTie: false,
        sourceEventsComplete: null as unknown as boolean,
        reconciled: false,
      }),
    )!;
    expect(s.status).toEqual({ kind: "not_reconciled" });
    expect(s.issues).toEqual([
      { label: "Monthly balances tie", state: "failed" },
      { label: "Source events complete", state: "not_evaluated" },
      { label: "Overall reconciled", state: "failed" },
    ]);
  });

  it("returns null for blocked output", () => {
    expect(summarizeJournal(analysis(null))).toBeNull();
  });
});
