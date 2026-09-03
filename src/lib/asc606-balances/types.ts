/**
 * Phase 3 contract-balance subsystem — shared types.
 *
 * Conventions match the approved Phase 1 engine: integer cents everywhere,
 * "YYYY-MM-DD" calendar dates, "YYYY-MM" reporting periods, no React/DOM/
 * network/database/AI dependency and no mutable global state.
 *
 * Accounting note: contract asset and contract liability are determined at the
 * contract level from cumulative revenue versus cumulative unconditional
 * rights. Invoicing and cash never enter that comparison.
 */

import type { Cents, IsoDate, MonthKey, RevenueSchedule } from "@/lib/asc606";

/** One contractual amount that becomes unconditional and is then invoiced. */
export interface ConsiderationEvent {
  id: string;
  seq: number;
  amountCents: Cents;
  /** Date the entity's right to consideration becomes unconditional. */
  unconditionalRightDate: IsoDate;
  /** Date the customer invoice is issued. */
  invoiceDate: IsoDate;
}

/** One cash receipt applied to exactly one consideration event. */
export interface CashCollectionEvent {
  id: string;
  seq: number;
  considerationEventId: string;
  amountCents: Cents;
  collectionDate: IsoDate;
}

export interface ContractBalanceInput {
  transactionPriceCents: Cents;
  /** Authoritative revenue output from the approved ASC 606 engine. */
  revenueSchedule: RevenueSchedule;
  considerationEvents: ConsiderationEvent[];
  cashCollections: CashCollectionEvent[];
}

export type BalanceCheckSeverity = "blocking" | "warning";

export interface BalanceCheckResult {
  id: string;
  category: "consideration" | "cash" | "reconciliation" | "revenue_schedule" | "accounting_horizon";
  severity: BalanceCheckSeverity;
  message: string;
  passed: boolean;
  detail?: Record<string, number | string | boolean>;
}

export interface BalanceValidationOutcome {
  status: "passed" | "attention";
  results: BalanceCheckResult[];
  blockingFailures: BalanceCheckResult[];
}

/** Event-level, engine-derived billing schedule row (read-only for the UI). */
export interface BillingScheduleRow {
  seq: number;
  eventId: string;
  amountCents: Cents;
  unconditionalRightDate: IsoDate;
  invoiceDate: IsoDate;
  cashCollectedCents: Cents;
  outstandingCents: Cents;
}

export interface MonthlyContractBalanceRow {
  month: MonthKey;

  revenueCents: Cents;
  cumulativeRevenueCents: Cents;

  unconditionalRightsCents: Cents;
  cumulativeUnconditionalRightsCents: Cents;

  invoicesIssuedCents: Cents;
  cumulativeInvoicesIssuedCents: Cents;

  cashCollectedCents: Cents;
  cumulativeCashCollectedCents: Cents;

  billedArCents: Cents;
  unbilledArCents: Cents;
  totalArCents: Cents;

  contractAssetCents: Cents;
  contractLiabilityCents: Cents;
}

export interface ContractBalanceReconciliation {
  transactionPriceCents: Cents;
  totalConsiderationEventsCents: Cents;
  /** transaction price − total consideration events; null when blocked. */
  differenceCents: Cents | null;
  /** Total revenue from the approved ASC 606 revenue schedule; null when blocked. */
  totalRevenueCents: Cents | null;
  /** true only when price, consideration and revenue agree; null when blocked. */
  reconciled: boolean | null;
}

export interface ContractBalanceAnalysis {
  validation: BalanceValidationOutcome;
  /** Present only when no blocking validation failure exists. */
  billingSchedule: BillingScheduleRow[] | null;
  /** Present only when no blocking validation failure exists. */
  monthly: MonthlyContractBalanceRow[] | null;
  reconciliation: ContractBalanceReconciliation;
}

export class ContractBalanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractBalanceError";
  }
}
