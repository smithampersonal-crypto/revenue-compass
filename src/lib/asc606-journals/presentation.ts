import type { JournalAnalysis, JournalReconciliation } from "./types";

/**
 * Presentation-only control totals for an already generated journal analysis.
 * Sums existing engine amounts; performs no accounting and never changes which
 * entries are authoritative.
 */
export type JournalSummaryStatus =
  | { kind: "reconciled" }
  | { kind: "out_of_balance"; differenceCents: number }
  | { kind: "not_reconciled" };

export interface JournalSummary {
  entryCount: number;
  periodCount: number;
  totalDebitsCents: number;
  totalCreditsCents: number;
  status: JournalSummaryStatus;
  /** Existing reconciliation checks that failed or were not evaluated. */
  issues: Array<{ label: string; state: "failed" | "not_evaluated" }>;
}

export const RECONCILIATION_CHECK_LABELS: Array<[keyof JournalReconciliation, string]> = [
  ["allEntriesBalanced", "All entries balanced"],
  ["monthlyBalancesTie", "Monthly balances tie"],
  ["revenueByPoTies", "Revenue by PO ties"],
  ["sourceEventsComplete", "Source events complete"],
  ["reconciled", "Overall reconciled"],
];

/** Returns null when journal output is blocked (no entries). */
export function summarizeJournal(analysis: JournalAnalysis): JournalSummary | null {
  const { entries, reconciliation } = analysis;
  if (entries === null) return null;

  const ids = new Set(entries.map((entry) => entry.id));
  const months = new Set(entries.map((entry) => entry.month));
  const totalDebitsCents = entries.reduce((sum, entry) => sum + entry.totalDebitsCents, 0);
  const totalCreditsCents = entries.reduce((sum, entry) => sum + entry.totalCreditsCents, 0);

  const issues = RECONCILIATION_CHECK_LABELS.flatMap(([key, label]) => {
    const value = reconciliation[key];
    if (value === true) return [];
    return [{ label, state: value === null ? ("not_evaluated" as const) : ("failed" as const) }];
  });

  const status: JournalSummaryStatus =
    totalDebitsCents !== totalCreditsCents
      ? { kind: "out_of_balance", differenceCents: Math.abs(totalDebitsCents - totalCreditsCents) }
      : reconciliation.reconciled === true
        ? { kind: "reconciled" }
        : { kind: "not_reconciled" };

  return {
    entryCount: ids.size,
    periodCount: months.size,
    totalDebitsCents,
    totalCreditsCents,
    status,
    issues: status.kind === "reconciled" ? [] : issues,
  };
}
