/**
 * Usage-as-incurred (metered) consideration.
 *
 * Phase 5B supports simple fixed-rate metering only. Each meter stores exact
 * ratio terms (rate amount in cents / rate quantity), so no fractional-cent
 * unit price is ever stored:
 *
 *    meter-period amount = round_half_up(quantity x rateAmountCents / rateQuantity)
 *
 * Each meter-period is rounded once, then meters are summed for the period.
 * A blank quantity is missing information, never zero.
 */

import { bigIntToCents, roundRatioHalfUp, type Cents, type MonthKey } from "@/lib/asc606";
import {
  VariableConsiderationError,
  type UsageComponentInput,
  type UsageMeterInput,
  type UsageMeterPeriodResult,
  type UsagePeriodResult,
} from "./types";

/** Deterministic revenue-source id for a usage component. */
export function usageSourceId(componentId: string): string {
  return `${componentId}::usage`;
}

export function meterPeriodAmountCents(meter: UsageMeterInput, quantity: number): Cents {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new VariableConsiderationError(
      `usage quantity for meter "${meter.name}" must be a nonnegative whole number`,
    );
  }
  if (!Number.isInteger(meter.rateQuantity) || meter.rateQuantity <= 0) {
    throw new VariableConsiderationError(
      `meter "${meter.name}" needs a positive whole-number rate quantity`,
    );
  }
  if (!Number.isInteger(meter.rateAmountCents) || meter.rateAmountCents <= 0) {
    throw new VariableConsiderationError(
      `meter "${meter.name}" needs a rate amount greater than zero`,
    );
  }
  return bigIntToCents(
    roundRatioHalfUp(BigInt(quantity) * BigInt(meter.rateAmountCents), BigInt(meter.rateQuantity)),
    `usage revenue for meter "${meter.name}"`,
  );
}

/** Calculates every complete usage period of one component, in month order. */
export function usageComponentPeriods(component: UsageComponentInput): UsagePeriodResult[] {
  const metersById = new Map(component.meters.map((meter) => [meter.id, meter]));
  const periods = [...component.periods].sort((a, b) =>
    a.month < b.month ? -1 : a.month > b.month ? 1 : 0,
  );

  return periods.map((period) => {
    const meterResults: UsageMeterPeriodResult[] = [];
    let total = 0n;
    for (const meter of component.meters) {
      const quantity = period.quantitiesByMeterId[meter.id];
      if (quantity === null || quantity === undefined) continue; // blank: validation blocks
      const amountCents = meterPeriodAmountCents(meter, quantity);
      total += BigInt(amountCents);
      meterResults.push({
        meterId: meter.id,
        meterName: meter.name,
        quantity,
        rateAmountCents: meter.rateAmountCents,
        rateQuantity: meter.rateQuantity,
        amountCents,
      });
    }
    for (const meterId of Object.keys(period.quantitiesByMeterId)) {
      if (!metersById.has(meterId)) {
        throw new VariableConsiderationError(
          `usage period ${period.month} references unknown meter "${meterId}"`,
        );
      }
    }
    return {
      componentId: component.id,
      targetPoId: component.targetPoId,
      revenueSourceId: usageSourceId(component.id),
      month: period.month,
      meters: meterResults,
      totalCents: bigIntToCents(total, `usage revenue for ${period.month}`),
    };
  });
}

/** Usage revenue by month for one component. */
export function usageRevenueByMonth(periods: readonly UsagePeriodResult[]): Map<MonthKey, Cents> {
  const byMonth = new Map<MonthKey, Cents>();
  for (const period of periods) {
    byMonth.set(period.month, (byMonth.get(period.month) ?? 0) + period.totalCents);
  }
  return byMonth;
}
