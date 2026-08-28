/**
 * ASC 606 Step 5 — revenue recognition schedules.
 *
 * Version 1 supports exactly two patterns:
 *  - over_time_ratable with the "daily_ratable" convention
 *      monthly revenue = allocated x eligible service days in month
 *                                  / total inclusive service days
 *  - point_in_time: the full allocated amount in the month containing the
 *      accountant's recognition date.
 *
 * Invariant: each PO's schedule sums exactly to its allocated amount, so the
 * contract-level schedule sums exactly to the transaction price.
 */

import { enumerateMonths, inclusiveDayCount, isValidIsoDate, monthKeyOf, overlapDaysInMonth } from "./dates";
import { assertNonNegativeCents, proportionOfCents } from "./money";
import type {
  Cents,
  MonthKey,
  OverTimeConvention,
  PerformanceObligationInput,
  RevenueSchedule,
  RevenueScheduleRowByMonth,
  RevenueScheduleRowByPo,
} from "./types";

export class RecognitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecognitionError";
  }
}

export const SUPPORTED_OVER_TIME_CONVENTIONS: readonly OverTimeConvention[] = ["daily_ratable"];

export interface PoScheduleRow {
  month: MonthKey;
  revenueCents: Cents;
  explanation: RevenueScheduleRowByPo["explanation"];
}

/**
 * Daily-ratable over-time recognition.
 *
 * `convention` is an explicit parameter so additional time-based conventions
 * can be added later without rewriting this implementation.
 */
export function recognizeOverTime(
  po: PerformanceObligationInput,
  allocatedCents: Cents,
  convention: OverTimeConvention = po.overTimeConvention ?? "daily_ratable",
): PoScheduleRow[] {
  assertNonNegativeCents(allocatedCents, `allocation for "${po.name}"`);

  if (!SUPPORTED_OVER_TIME_CONVENTIONS.includes(convention)) {
    throw new RecognitionError(`unsupported over-time convention "${convention}"`);
  }
  if (!isValidIsoDate(po.serviceStart) || !isValidIsoDate(po.serviceEnd)) {
    throw new RecognitionError(`performance obligation "${po.name}" needs valid service dates`);
  }
  const start = po.serviceStart!;
  const end = po.serviceEnd!;
  if (end < start) {
    throw new RecognitionError(
      `performance obligation "${po.name}" has a service end date before its start date`,
    );
  }

  const totalDays = inclusiveDayCount(start, end);
  const months = enumerateMonths(start, end);

  const rows: PoScheduleRow[] = months.map((month) => {
    const days = overlapDaysInMonth(month, start, end);
    const revenueCents = proportionOfCents(allocatedCents, days, totalDays, `revenue for "${po.name}"`);
    return {
      month,
      revenueCents,
      explanation: {
        template: "ratable_daily_month",
        inputs: { allocatedCents, eligibleDays: days, totalServiceDays: totalDays, convention },
      },
    };
  });

  // The final recognition month absorbs the unavoidable residual cents so the
  // PO schedule ties exactly to its allocation.
  const priorTotal = rows.slice(0, -1).reduce((total, row) => total + row.revenueCents, 0);
  const last = rows[rows.length - 1]!;
  const finalAmount = allocatedCents - priorTotal;
  if (finalAmount !== last.revenueCents) {
    last.revenueCents = finalAmount;
    last.explanation = {
      template: "ratable_daily_final_month",
      inputs: {
        allocatedCents,
        eligibleDays: overlapDaysInMonth(last.month, start, end),
        totalServiceDays: totalDays,
        priorMonthsCents: priorTotal,
        convention,
      },
    };
  }

  return rows;
}

/** Point-in-time recognition: 100% in the month containing the recognition date. */
export function recognizePointInTime(
  po: PerformanceObligationInput,
  allocatedCents: Cents,
): PoScheduleRow[] {
  assertNonNegativeCents(allocatedCents, `allocation for "${po.name}"`);
  if (!isValidIsoDate(po.recognitionDate)) {
    throw new RecognitionError(
      `performance obligation "${po.name}" needs a valid point-in-time recognition date`,
    );
  }
  const recognitionDate = po.recognitionDate!;
  return [
    {
      month: monthKeyOf(recognitionDate),
      revenueCents: allocatedCents,
      explanation: {
        template: "point_in_time",
        inputs: { allocatedCents, recognitionDate },
      },
    },
  ];
}

/** Dispatches a single PO to the correct recognition pattern. */
export function recognizePerformanceObligation(
  po: PerformanceObligationInput,
  allocatedCents: Cents,
): PoScheduleRow[] {
  switch (po.recognitionMethod) {
    case "over_time_ratable":
      return recognizeOverTime(po, allocatedCents);
    case "point_in_time":
      return recognizePointInTime(po, allocatedCents);
    default:
      throw new RecognitionError(
        `performance obligation "${po.name}" has an unsupported recognition method`,
      );
  }
}

export interface ScheduleInput {
  po: PerformanceObligationInput;
  allocatedCents: Cents;
}

/** Builds the contract revenue schedule in by-PO and by-month views. */
export function generateRevenueSchedule(inputs: readonly ScheduleInput[]): RevenueSchedule {
  const ordered = [...inputs].sort((a, b) => a.po.seq - b.po.seq);

  const byPo: RevenueScheduleRowByPo[] = [];
  for (const { po, allocatedCents } of ordered) {
    const rows = recognizePerformanceObligation(po, allocatedCents);
    const poTotal = rows.reduce((total, row) => total + row.revenueCents, 0);
    if (poTotal !== allocatedCents) {
      throw new RecognitionError(
        `recognition invariant violated for "${po.name}": scheduled ${poTotal} != allocated ${allocatedCents}`,
      );
    }
    for (const row of rows) {
      byPo.push({ poId: po.id, month: row.month, revenueCents: row.revenueCents, explanation: row.explanation });
    }
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
