/**
 * Phase 9G-R3 Part 2, Stage C — progressive journal entries.
 *
 * Entries are generated for accounting events that are ACTUALLY known:
 * known billings, and revenue recognized under a known schedule (hosted
 * service, a completed point-in-time transfer, entered support hours, priced
 * actual usage).
 *
 * A component whose accounting event has not happened yet produces an explicit
 * "pending accounting event" status instead of a fabricated entry — and never
 * suppresses another obligation's known entries.
 *
 * Presentation stays gross: no netting behaviour is introduced here.
 */

import { sumCents, type Cents, type MonthKey, type RevenueSchedule } from "@/lib/asc606";

import type { ProgressiveBillingEvent } from "./billing";
import { PENDING_REASON_LABELS, type CalculationState, type PendingComponent } from "./types";

export interface ProgressiveJournalLine {
  account: string;
  debitCents: Cents;
  creditCents: Cents;
}

export interface ProgressiveJournalEntry {
  /** Stable identity derived from the originating event. */
  id: string;
  month: MonthKey;
  date: string;
  description: string;
  lines: ProgressiveJournalLine[];
}

export interface PendingAccountingEvent {
  /** Stable identity of the unresolved component. */
  id: string;
  poId: string;
  poName: string;
  amountCents: Cents;
  reason: PendingComponent["reason"];
  label: string;
}

export interface ProgressiveJournals {
  state: CalculationState;
  entries: ProgressiveJournalEntry[];
  pendingEvents: PendingAccountingEvent[];
  totalDebitCents: Cents;
  totalCreditCents: Cents;
  balanced: boolean;
}

export interface ProgressiveJournalsInput {
  billing: readonly ProgressiveBillingEvent[];
  schedule: RevenueSchedule;
  poNames: ReadonlyMap<string, string>;
  pending: readonly PendingComponent[];
}

export function buildProgressiveJournals(
  input: ProgressiveJournalsInput,
): ProgressiveJournals {
  const entries: ProgressiveJournalEntry[] = [];

  for (const event of input.billing) {
    entries.push({
      id: `je:${event.id}`,
      month: event.month,
      date: event.date,
      description: `Billing — ${event.description}`,
      lines: [
        { account: "Accounts receivable", debitCents: event.amountCents, creditCents: 0 },
        { account: "Contract liability", debitCents: 0, creditCents: event.amountCents },
      ],
    });
  }

  for (const row of input.schedule.byPo) {
    if (row.revenueCents === 0) continue;
    const name = input.poNames.get(row.poId) ?? row.poId;
    entries.push({
      id: `je:revenue:${row.poId}:${row.month}`,
      month: row.month,
      date: `${row.month}-01`,
      description: `Revenue recognized — ${name}`,
      lines: [
        { account: "Contract liability", debitCents: row.revenueCents, creditCents: 0 },
        { account: "Revenue", debitCents: 0, creditCents: row.revenueCents },
      ],
    });
  }

  entries.sort((a, b) => (a.month === b.month ? a.id.localeCompare(b.id) : a.month < b.month ? -1 : 1));

  const pendingEvents: PendingAccountingEvent[] = input.pending.map((component) => ({
    id:
      typeof component.detail?.["identity"] === "string"
        ? (component.detail["identity"] as string)
        : `pending:${component.poId}:${component.reason}`,
    poId: component.poId,
    poName: component.poName,
    amountCents: component.amountCents,
    reason: component.reason,
    label: PENDING_REASON_LABELS[component.reason],
  }));

  const totalDebitCents = sumCents(
    entries.flatMap((entry) => entry.lines.map((line) => line.debitCents)),
  );
  const totalCreditCents = sumCents(
    entries.flatMap((entry) => entry.lines.map((line) => line.creditCents)),
  );

  return {
    state: pendingEvents.length > 0 ? "pending" : "complete",
    entries,
    pendingEvents,
    totalDebitCents,
    totalCreditCents,
    balanced: totalDebitCents === totalCreditCents,
  };
}
