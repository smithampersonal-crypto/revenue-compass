/**
 * Phase 9G-R3 Part 2, Stage C — progressive contract balances.
 *
 * One unresolved revenue component no longer erases every determinable
 * balance. Four things stay distinct and are never conflated:
 *
 *   known billings
 *   known recognized revenue
 *   allocated consideration not yet scheduled because an operational fact is
 *     pending (explicitly surfaced, never treated as permanent zero revenue)
 *   whether the period is complete or partial
 *
 * A period whose required actuals are all known calculates normally. A period
 * that would be misleading because material revenue is still unscheduled is
 * marked partial and carries the unresolved amount with it.
 */

import { sumCents, type Cents, type MonthKey, type RevenueSchedule } from "@/lib/asc606";

import type { CalculationState, PendingComponent } from "./types";
import { sumPendingCents } from "./types";
import type { ProgressiveBillingEvent } from "./billing";

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
  /** Allocated consideration still unscheduled as at the end of this period. */
  pendingCents: Cents;
  state: CalculationState;
}

export interface ProgressiveBalances {
  state: CalculationState;
  periods: ProgressiveBalancePeriod[];
  totalBilledCents: Cents;
  totalRevenueCents: Cents;
  /** Explicit unresolved amount; never silently zero. */
  pendingCents: Cents;
  pending: PendingComponent[];
}

export interface ProgressiveBalancesInput {
  billing: readonly ProgressiveBillingEvent[];
  schedule: RevenueSchedule;
  pending: readonly PendingComponent[];
}

export function buildProgressiveBalances(input: ProgressiveBalancesInput): ProgressiveBalances {
  const months = [
    ...new Set([
      ...input.billing.map((event) => event.month),
      ...input.schedule.byMonth.map((row) => row.month),
    ]),
  ].sort();

  const pendingCents = sumPendingCents(input.pending);

  let cumulativeBilled = 0;
  let cumulativeRevenue = 0;
  const periods: ProgressiveBalancePeriod[] = months.map((month) => {
    const billedCents = sumCents(
      input.billing.filter((event) => event.month === month).map((event) => event.amountCents),
    );
    const revenueCents = sumCents(
      input.schedule.byMonth.filter((row) => row.month === month).map((row) => row.totalCents),
    );
    cumulativeBilled = sumCents([cumulativeBilled, billedCents]);
    cumulativeRevenue = sumCents([cumulativeRevenue, revenueCents]);
    const net = cumulativeBilled - cumulativeRevenue;
    return {
      month,
      billedCents,
      revenueCents,
      cumulativeBilledCents: cumulativeBilled,
      cumulativeRevenueCents: cumulativeRevenue,
      contractLiabilityCents: net > 0 ? net : 0,
      contractAssetCents: net < 0 ? -net : 0,
      // A period is only "complete" when nothing material remains unscheduled.
      state: pendingCents > 0 ? "pending" : "complete",
      pendingCents,
    };
  });

  return {
    state: pendingCents > 0 ? "pending" : "complete",
    periods,
    totalBilledCents: cumulativeBilled,
    totalRevenueCents: cumulativeRevenue,
    pendingCents,
    pending: [...input.pending],
  };
}
