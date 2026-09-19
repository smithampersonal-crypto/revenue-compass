/**
 * Phase 9G-R3 Part 2, Stage C — progressive contract balances.
 *
 * The ACCEPTED Phase 3 engine remains the accounting authority: this module
 * feeds it the progressive facts and adds partial/unresolved metadata around
 * its output. It never recalculates contract asset, contract liability, billed
 * or unbilled receivables itself.
 *
 * Four things stay distinct and are never conflated:
 *
 *   known billings
 *   known recognized revenue
 *   allocated consideration not yet scheduled because an operational fact is
 *     pending (explicitly surfaced, never treated as permanent zero revenue)
 *   whether the period is complete or partial
 */

import type { Cents, MonthKey, RevenueSchedule } from "@/lib/asc606";
import {
  analyzeContractBalances,
  type BalanceValidationOutcome,
  type BillingScheduleRow,
  type ContractBalanceAnalysis,
  type ContractBalanceInput,
  type MonthlyContractBalanceRow,
} from "@/lib/asc606-balances";

import type { ProgressiveBillingEvent } from "./billing";
import { buildProgressiveBalanceInput, type ProgressiveCashCollection } from "./phase3-bridge";
import type { CalculationState, PendingComponent } from "./types";

export type { ProgressiveCashCollection } from "./phase3-bridge";

export interface ProgressiveBalancePeriod {
  month: MonthKey;
  billedCents: Cents;
  revenueCents: Cents;
  cumulativeBilledCents: Cents;
  cumulativeRevenueCents: Cents;
  /** Positive when billings exceed revenue: a contract liability. */
  contractLiabilityCents: Cents;
  /** Positive when revenue exceeds billings: a contract asset. */
  contractAssetCents: Cents;
  billedArCents: Cents;
  unbilledArCents: Cents;
  cashCollectedCents: Cents;
  /** Signed allocated consideration still unresolved at this period end. */
  pendingCents: Cents;
  state: CalculationState;
}

export interface ProgressiveBalances {
  state: CalculationState;
  periods: ProgressiveBalancePeriod[];
  totalBilledCents: Cents;
  totalRevenueCents: Cents;
  /** Explicit signed unresolved amount; never silently zero. */
  pendingCents: Cents;
  pending: PendingComponent[];
  /** True when a future operational fact keeps the contract incomplete. */
  partial: boolean;
  /** Accepted Phase 3 output, unmodified. */
  monthly: MonthlyContractBalanceRow[] | null;
  billingSchedule: BillingScheduleRow[] | null;
  validation: BalanceValidationOutcome;
  analysis: ContractBalanceAnalysis;
  /** The Phase 3 input actually used, reused by the journal layer. */
  contractBalanceInput: ContractBalanceInput;
}

export interface ProgressiveBalancesInput {
  billing: readonly ProgressiveBillingEvent[];
  cashCollections?: readonly ProgressiveCashCollection[];
  schedule: RevenueSchedule;
  pending: readonly PendingComponent[];
}

/**
 * Null when a billing fact the rollforward depends on cannot be used. No
 * balance is presented from manufactured invoice timing.
 */
export function buildProgressiveBalances(
  input: ProgressiveBalancesInput,
): ProgressiveBalances | null {
  const bridge = buildProgressiveBalanceInput(input);
  if (bridge.unusable) return null;
  const analysis = analyzeContractBalances(bridge.input);

  const monthly = analysis.monthly;
  const periods: ProgressiveBalancePeriod[] = (monthly ?? []).map((row) => ({
    month: row.month,
    billedCents: row.unconditionalRightsCents,
    revenueCents: row.revenueCents,
    cumulativeBilledCents: row.cumulativeUnconditionalRightsCents,
    cumulativeRevenueCents: row.cumulativeRevenueCents,
    contractLiabilityCents: row.contractLiabilityCents,
    contractAssetCents: row.contractAssetCents,
    billedArCents: row.billedArCents,
    unbilledArCents: row.unbilledArCents,
    cashCollectedCents: row.cashCollectedCents,
    pendingCents: bridge.unresolvedSignedCents,
    // A period is only "complete" when nothing material remains unresolved.
    state: bridge.partial ? "pending" : "complete",
  }));

  const last = periods[periods.length - 1];
  const state: CalculationState =
    analysis.validation.blockingFailures.length > 0
      ? "blocked"
      : bridge.partial
        ? "pending"
        : "complete";

  return {
    state,
    periods,
    totalBilledCents: last?.cumulativeBilledCents ?? 0,
    totalRevenueCents: last?.cumulativeRevenueCents ?? 0,
    pendingCents: bridge.unresolvedSignedCents,
    pending: [...input.pending],
    partial: bridge.partial,
    monthly,
    billingSchedule: analysis.billingSchedule,
    validation: analysis.validation,
    analysis,
    contractBalanceInput: bridge.input,
  };
}
