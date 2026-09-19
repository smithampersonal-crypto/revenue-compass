/**
 * Phase 9G-R3 Part 2, Stage B — usage-based consideration.
 *
 * The contractual RULE and the ACTUAL ACTIVITY are separate facts:
 *
 *   rule    — meters, rates, tiers/thresholds, billing cadence, target series
 *             obligation. Known at inception, interpretable from the contract.
 *   actual  — quantities actually consumed in a period. Accountant/operational
 *             data that does not exist until it happens.
 *
 * A rule with no actuals is NOT an error: it produces no quantity, no invoice,
 * no revenue and no red review item. ARC never invents future usage.
 */

import { isValidCents, proportionOfCents, sumCents, type Cents, type MonthKey } from "@/lib/asc606";

import { ProgressiveAccountingError } from "./types";
import type { VcRealizedEvent, VcSeriesPeriod } from "./variable-consideration";

/** One fixed-rate meter, stored as exact ratio terms (never a unit price). */
export interface UsageMeterRule {
  id: string;
  seq: number;
  name: string;
  /** Rate numerator, integer cents. */
  rateAmountCents: Cents;
  /** Rate denominator, positive integer quantity. */
  rateQuantity: number;
  unit: string;
  /** Tier threshold: only quantity ABOVE this is chargeable. Defaults to 0. */
  includedQuantity?: number;
}

export interface UsageBillingRule {
  /** True when the accepted contract rule makes realized usage billable. */
  billOnRealization: boolean;
}

export interface UsageRule {
  componentId: string;
  targetPoId: string;
  meters: readonly UsageMeterRule[];
  billing: UsageBillingRule;
  /** Declared distinct service periods the usage can be assigned to. */
  seriesPeriods: readonly VcSeriesPeriod[];
}

/** An actual, accountant-owned usage observation for one accounting month. */
export interface UsageActualEvent {
  id: string;
  month: MonthKey;
  /** The declared service period this month's usage belongs to. */
  seriesPeriodId: string;
  /** Date the amount becomes attributable; normally the period end. */
  date: string;
  /** Meter id -> actual quantity. A missing meter is blank, never zero. */
  quantitiesByMeterId: Readonly<Record<string, number>>;
}

export interface UsageMeterAmount {
  meterId: string;
  meterName: string;
  quantity: number;
  chargeableQuantity: number;
  rateAmountCents: Cents;
  rateQuantity: number;
  amountCents: Cents;
}

export interface UsageActualAmount {
  /** Stable identity: `usage:<componentId>:<eventId>`. */
  id: string;
  componentId: string;
  eventId: string;
  month: MonthKey;
  seriesPeriodId: string;
  date: string;
  meters: UsageMeterAmount[];
  totalCents: Cents;
  billable: boolean;
}

function validMeter(meter: UsageMeterRule): boolean {
  return (
    isValidCents(meter.rateAmountCents) &&
    meter.rateAmountCents >= 0 &&
    Number.isFinite(meter.rateQuantity) &&
    Number.isInteger(meter.rateQuantity) &&
    meter.rateQuantity > 0
  );
}

/**
 * Deterministically prices actual usage under the accepted contractual rule.
 *
 * Only actual events produce amounts. Throws (category A) when the rule or an
 * actual quantity is unusable — never silently zero.
 */
export function priceUsageActuals(
  rule: UsageRule,
  actuals: readonly UsageActualEvent[],
): UsageActualAmount[] {
  const meters = [...rule.meters].sort((a, b) => a.seq - b.seq);
  for (const meter of meters) {
    if (!validMeter(meter)) {
      throw new ProgressiveAccountingError(
        `usage meter "${meter.name}" has an invalid rate; usage cannot be priced`,
      );
    }
  }
  const meterById = new Map(meters.map((meter) => [meter.id, meter]));
  const periodIds = new Set(rule.seriesPeriods.map((period) => period.id));

  const seen = new Set<string>();
  const ordered = [...actuals].sort((a, b) =>
    a.month === b.month ? a.id.localeCompare(b.id) : a.month < b.month ? -1 : 1,
  );

  return ordered.map((event) => {
    if (seen.has(event.id)) {
      throw new ProgressiveAccountingError(`duplicate usage event "${event.id}"`);
    }
    seen.add(event.id);
    if (!periodIds.has(event.seriesPeriodId)) {
      throw new ProgressiveAccountingError(
        `usage for ${event.month} references a service period that does not exist`,
      );
    }

    const rows: UsageMeterAmount[] = [];
    for (const [meterId, quantity] of Object.entries(event.quantitiesByMeterId)) {
      const meter = meterById.get(meterId);
      if (!meter) {
        throw new ProgressiveAccountingError(
          `usage for ${event.month} references a meter that does not exist`,
        );
      }
      if (!Number.isFinite(quantity) || quantity < 0) {
        throw new ProgressiveAccountingError(
          `usage for meter "${meter.name}" in ${event.month} is negative or invalid`,
        );
      }
      const chargeable = Math.max(quantity - (meter.includedQuantity ?? 0), 0);
      const amountCents =
        chargeable === 0
          ? 0
          : proportionOfCents(
              meter.rateAmountCents,
              chargeable,
              meter.rateQuantity,
              `usage for meter "${meter.name}" in ${event.month}`,
            );
      rows.push({
        meterId: meter.id,
        meterName: meter.name,
        quantity,
        chargeableQuantity: chargeable,
        rateAmountCents: meter.rateAmountCents,
        rateQuantity: meter.rateQuantity,
        amountCents,
      });
    }
    rows.sort((a, b) => (meterById.get(a.meterId)!.seq ?? 0) - (meterById.get(b.meterId)!.seq ?? 0));

    return {
      id: `usage:${rule.componentId}:${event.id}`,
      componentId: rule.componentId,
      eventId: event.id,
      month: event.month,
      seriesPeriodId: event.seriesPeriodId,
      date: event.date,
      meters: rows,
      totalCents: sumCents(rows.map((row) => row.amountCents)),
      billable: rule.billing.billOnRealization,
    };
  });
}

/**
 * Converts priced usage into realized variable-consideration events so usage
 * flows through exactly one deterministic allocation path: the accepted
 * specific-series-period exception.
 */
export function usageAsRealizedEvents(
  amounts: readonly UsageActualAmount[],
): VcRealizedEvent[] {
  return amounts
    .filter((amount) => amount.totalCents > 0)
    .map((amount) => ({
      id: amount.eventId,
      date: amount.date,
      amountCents: amount.totalCents,
      seriesPeriodId: amount.seriesPeriodId,
      billable: amount.billable,
      description: `Actual usage for ${amount.month}`,
    }));
}
