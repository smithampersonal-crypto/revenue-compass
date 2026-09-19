/**
 * Phase 9G-R3 Part 2, Stage C — progressive journal entries.
 *
 * The ACCEPTED Phase 4 engine generates every entry. This module supplies it
 * the same Phase 3 input the progressive balances used, and adds only the
 * pending-event metadata R3 needs: an accounting event that has not happened
 * yet is reported explicitly instead of being fabricated, and it never
 * suppresses another obligation's known entries.
 *
 * Gross presentation, contract asset / contract liability behaviour, billed
 * versus unbilled receivables, invoice reclassification, cash collection and
 * revenue reversal all remain exactly as Phase 4 defines them.
 */

import type { Cents } from "@/lib/asc606";
import type { ContractBalanceInput } from "@/lib/asc606-balances";
import {
  analyzeJournalEntries,
  type JournalAnalysis,
  type JournalEntry,
  type JournalLedgerMonth,
} from "@/lib/asc606-journals";

import { PENDING_REASON_LABELS, type CalculationState, type PendingComponent } from "./types";

export interface PendingAccountingEvent {
  /** Stable identity of the unresolved component. */
  id: string;
  poId: string;
  poName: string;
  amountCents: Cents;
  direction: "increase" | "decrease";
  reason: PendingComponent["reason"];
  label: string;
}

export interface ProgressiveJournals {
  state: CalculationState;
  /** Accepted Phase 4 entries; empty when the Phase 4 engine is blocked. */
  entries: JournalEntry[];
  ledgerByMonth: JournalLedgerMonth[];
  pendingEvents: PendingAccountingEvent[];
  totalDebitCents: Cents;
  totalCreditCents: Cents;
  balanced: boolean;
  analysis: JournalAnalysis;
}

export interface ProgressiveJournalsInput {
  /** The same Phase 3 input the progressive balances used. */
  contractBalanceInput: ContractBalanceInput;
  pending: readonly PendingComponent[];
  /** True when a future operational fact keeps the contract incomplete. */
  partial: boolean;
}

export function buildProgressiveJournals(input: ProgressiveJournalsInput): ProgressiveJournals {
  const analysis = analyzeJournalEntries(input.contractBalanceInput);
  const entries = analysis.entries ?? [];

  const pendingEvents: PendingAccountingEvent[] = input.pending.map((component) => ({
    id:
      typeof component.detail?.["identity"] === "string"
        ? (component.detail["identity"] as string)
        : `pending:${component.poId}:${component.reason}`,
    poId: component.poId,
    poName: component.poName,
    amountCents: component.amountCents,
    direction: component.direction ?? "increase",
    reason: component.reason,
    label: PENDING_REASON_LABELS[component.reason],
  }));

  let totalDebitCents = 0;
  let totalCreditCents = 0;
  for (const entry of entries) {
    totalDebitCents += entry.totalDebitsCents;
    totalCreditCents += entry.totalCreditsCents;
  }

  const state: CalculationState =
    analysis.validation.blockingFailures.length > 0
      ? "blocked"
      : pendingEvents.length > 0 || input.partial
        ? "pending"
        : "complete";

  return {
    state,
    entries,
    ledgerByMonth: analysis.ledgerByMonth ?? [],
    pendingEvents,
    totalDebitCents,
    totalCreditCents,
    balanced: totalDebitCents === totalCreditCents,
    analysis,
  };
}
