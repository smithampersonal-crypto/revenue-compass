/**
 * Phase 4A journal-entry subsystem — shared types.
 *
 * Pure data: no React, DOM, network, database or AI dependency and no mutable
 * global accounting state. Every monetary value is integer cents; aggregation
 * and invariants use BigInt.
 */

import type { Cents, IsoDate, MonthKey } from "@/lib/asc606";

export type JournalAccount =
  | "cash"
  | "billed_ar"
  | "unbilled_ar"
  | "contract_asset"
  | "contract_liability"
  | "revenue";

export type JournalEventType =
  | "revenue_recognition"
  | "unconditional_right"
  | "invoice_reclassification"
  | "cash_collection";

export interface JournalLine {
  account: JournalAccount;
  debitCents: Cents;
  creditCents: Cents;
  /** Present for revenue lines only. */
  poId?: string;
}

export interface JournalEntry {
  id: string;
  date: IsoDate;
  month: MonthKey;
  eventType: JournalEventType;
  /** Related consideration or cash event, where applicable. */
  sourceId: string | null;
  description: string;
  lines: JournalLine[];
  totalDebitsCents: Cents;
  totalCreditsCents: Cents;
}

export interface JournalCheckResult {
  id: string;
  category: "phase3" | "revenue_split";
  severity: "blocking" | "warning";
  message: string;
  passed: boolean;
}

export interface JournalValidationOutcome {
  status: "passed" | "attention";
  results: JournalCheckResult[];
  blockingFailures: JournalCheckResult[];
}

/** Journal-derived ledger position at each Phase 3 month-end. */
export interface JournalLedgerMonth {
  month: MonthKey;
  cashCents: Cents;
  billedArCents: Cents;
  unbilledArCents: Cents;
  contractAssetCents: Cents;
  contractLiabilityCents: Cents;
  cumulativeCashCents: Cents;
  cumulativeRevenueCents: Cents;
  revenueByPoCents: Record<string, Cents>;
}

export interface JournalReconciliation {
  allEntriesBalanced: boolean | null;
  monthlyBalancesTie: boolean | null;
  revenueByPoTies: boolean | null;
  sourceEventsComplete: boolean | null;
  reconciled: boolean | null;
}

export interface JournalAnalysis {
  validation: JournalValidationOutcome;
  /** null when blocked. */
  entries: JournalEntry[] | null;
  /** null when blocked. */
  ledgerByMonth: JournalLedgerMonth[] | null;
  reconciliation: JournalReconciliation;
}

export class JournalEntryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JournalEntryError";
  }
}
