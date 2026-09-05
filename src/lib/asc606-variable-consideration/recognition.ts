/**
 * Dynamic revenue recognition for remeasured consideration.
 *
 * The approved daily-ratable convention is preserved exactly. For each month:
 *
 *   current allocation   = inception allocation + all changes effective by month-end
 *   cumulative entitlement = round_half_up(current allocation x cumulative eligible days
 *                                          / total service days)
 *   month revenue        = cumulative entitlement - prior cumulative revenue
 *
 * which naturally produces the cumulative catch-up in the month a change
 * becomes effective, and a signed adjustment when a change occurs after the
 * performance obligation has been satisfied.
 *
 * A unit with no changes is delegated to the approved Phase 1 recognition
 * functions so frozen fixed-consideration behavior cannot drift.
 */

import {
  enumerateMonths,
  inclusiveDayCount,
  monthKeyOf,
  overlapDaysInMonth,
  recognizePerformanceObligation,
  type Cents,
  type IsoDate,
  type MonthKey,
  type RecognizableUnit,
  type RevenueSchedule,
  type RevenueScheduleRowByMonth,
  type RevenueScheduleRowByPo,
} from "@/lib/asc606";
import { signedProportionOfCents } from "./estimation";
import { VariableConsiderationError } from "./types";

export interface DynamicChange {
  id: string;
  date: IsoDate;
  /** Signed change in the amount allocated to this unit. */
  amountCents: Cents;
}

export interface DynamicUnitInput {
  unit: RecognizableUnit;
  /** Allocation before any dated change. */
  inceptionAllocatedCents: Cents;
  changes: DynamicChange[];
}

export interface DynamicRow {
  month: MonthKey;
  revenueCents: Cents;
  explanation: RevenueScheduleRowByPo["explanation"];
}

/** Cumulative progress of a unit through the end of `month`, as an exact ratio. */
export function progressThroughMonth(
  unit: RecognizableUnit,
  month: MonthKey,
): { numerator: number; denominator: number } {
  if (unit.recognitionMethod === "point_in_time") {
    if (!unit.recognitionDate) {
      throw new VariableConsiderationError(`"${unit.name}" needs a recognition date`);
    }
    return { numerator: month >= monthKeyOf(unit.recognitionDate) ? 1 : 0, denominator: 1 };
  }
  if (!unit.serviceStart || !unit.serviceEnd) {
    throw new VariableConsiderationError(`"${unit.name}" needs service dates`);
  }
  const totalDays = inclusiveDayCount(unit.serviceStart, unit.serviceEnd);
  let days = 0;
  for (const serviceMonth of enumerateMonths(unit.serviceStart, unit.serviceEnd)) {
    if (serviceMonth > month) break;
    days += overlapDaysInMonth(serviceMonth, unit.serviceStart, unit.serviceEnd);
  }
  return { numerator: days, denominator: totalDays };
}

/**
 * Cumulative progress of a unit through an exact date (not month-end).
 *
 * Used only for the event-level catch-up decomposition; the monthly revenue
 * schedule keeps the approved cumulative month-end convention.
 */
export function progressThroughDate(
  unit: RecognizableUnit,
  date: IsoDate,
): { numerator: number; denominator: number } {
  if (unit.recognitionMethod === "point_in_time") {
    if (!unit.recognitionDate) {
      throw new VariableConsiderationError(`"${unit.name}" needs a recognition date`);
    }
    return { numerator: unit.recognitionDate <= date ? 1 : 0, denominator: 1 };
  }
  if (!unit.serviceStart || !unit.serviceEnd) {
    throw new VariableConsiderationError(`"${unit.name}" needs service dates`);
  }
  const totalDays = inclusiveDayCount(unit.serviceStart, unit.serviceEnd);
  if (date < unit.serviceStart) return { numerator: 0, denominator: totalDays };
  const through = date > unit.serviceEnd ? unit.serviceEnd : date;
  return { numerator: inclusiveDayCount(unit.serviceStart, through), denominator: totalDays };
}

/** Cumulative entitlement of a unit at an exact date, given a signed allocation. */
export function cumulativeEntitlementAtDateCents(
  unit: RecognizableUnit,
  allocatedCents: Cents,
  date: IsoDate,
): Cents {
  const { numerator, denominator } = progressThroughDate(unit, date);
  return signedProportionOfCents(
    allocatedCents,
    numerator,
    denominator,
    `cumulative revenue for "${unit.name}"`,
  );
}

/** Cumulative entitlement of a unit at `month`, given a signed allocation. */
export function cumulativeEntitlementCents(
  unit: RecognizableUnit,
  allocatedCents: Cents,
  month: MonthKey,
): Cents {
  const { numerator, denominator } = progressThroughMonth(unit, month);
  return signedProportionOfCents(
    allocatedCents,
    numerator,
    denominator,
    `cumulative revenue for "${unit.name}"`,
  );
}

function unitMonths(input: DynamicUnitInput): MonthKey[] {
  const unit = input.unit;
  const natural =
    unit.recognitionMethod === "point_in_time"
      ? [monthKeyOf(unit.recognitionDate!)]
      : enumerateMonths(unit.serviceStart!, unit.serviceEnd!);
  const first = natural[0]!;
  const months = new Set(natural);
  for (const change of input.changes) {
    const month = monthKeyOf(change.date);
    if (month > first) months.add(month);
  }
  return [...months].sort();
}

/** Allocation of the unit including every change effective by month-end. */
export function allocationAtMonth(input: DynamicUnitInput, month: MonthKey): Cents {
  let total = BigInt(input.inceptionAllocatedCents);
  for (const change of input.changes) {
    if (monthKeyOf(change.date) <= month) total += BigInt(change.amountCents);
  }
  return Number(total);
}

export function finalAllocationCents(input: DynamicUnitInput): Cents {
  let total = BigInt(input.inceptionAllocatedCents);
  for (const change of input.changes) total += BigInt(change.amountCents);
  return Number(total);
}

export function recognizeDynamicUnit(input: DynamicUnitInput): DynamicRow[] {
  // Frozen path: no remeasurement means the approved Phase 1 engine decides.
  if (input.changes.length === 0) {
    return recognizePerformanceObligation(input.unit, input.inceptionAllocatedCents);
  }

  const months = unitMonths(input);
  let priorCumulative = 0;
  const rows: DynamicRow[] = months.map((month) => {
    const allocation = allocationAtMonth(input, month);
    const cumulative = cumulativeEntitlementCents(input.unit, allocation, month);
    const revenueCents = cumulative - priorCumulative;
    const row: DynamicRow = {
      month,
      revenueCents,
      explanation: {
        template:
          input.unit.recognitionMethod === "point_in_time"
            ? "point_in_time_remeasured"
            : "ratable_daily_cumulative_month_remeasured",
        inputs: {
          allocatedCents: allocation,
          cumulativeRevenueCents: cumulative,
          priorCumulativeRevenueCents: priorCumulative,
        },
      },
    };
    priorCumulative = cumulative;
    return row;
  });

  const expected = finalAllocationCents(input);
  if (priorCumulative !== expected) {
    throw new VariableConsiderationError(
      `recognition invariant violated for "${input.unit.name}": scheduled ${priorCumulative} != allocated ${expected}`,
    );
  }
  return rows;
}

export interface UsageScheduleRow {
  sourceId: string;
  month: MonthKey;
  revenueCents: Cents;
}

/**
 * Builds the combined revenue schedule from dynamic performance-obligation
 * units and deterministic usage revenue sources.
 */
export function buildDynamicRevenueSchedule(
  units: readonly DynamicUnitInput[],
  usageRows: readonly UsageScheduleRow[],
): RevenueSchedule {
  const byPo: RevenueScheduleRowByPo[] = [];
  const ordered = [...units].sort((a, b) => a.unit.seq - b.unit.seq);

  for (const input of ordered) {
    for (const row of recognizeDynamicUnit(input)) {
      byPo.push({
        poId: input.unit.id,
        month: row.month,
        revenueCents: row.revenueCents,
        explanation: row.explanation,
      });
    }
  }
  for (const row of usageRows) {
    byPo.push({
      poId: row.sourceId,
      month: row.month,
      revenueCents: row.revenueCents,
      explanation: {
        template: "usage_as_incurred_period",
        inputs: { month: row.month, revenueCents: row.revenueCents },
      },
    });
  }

  const monthKeys = [...new Set(byPo.map((row) => row.month))].sort();
  let cumulative = 0;
  const byMonth: RevenueScheduleRowByMonth[] = monthKeys.map((month) => {
    const perPo: Record<string, Cents> = {};
    let totalCents = 0;
    for (const row of byPo) {
      if (row.month !== month) continue;
      perPo[row.poId] = (perPo[row.poId] ?? 0) + row.revenueCents;
      totalCents += row.revenueCents;
    }
    cumulative += totalCents;
    return { month, perPo, totalCents, cumulativeCents: cumulative };
  });

  return {
    byPo,
    byMonth,
    totalCents: cumulative,
    firstMonth: monthKeys[0] ?? null,
    lastMonth: monthKeys[monthKeys.length - 1] ?? null,
  };
}
