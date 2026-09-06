/**
 * Phase 5C historical segmentation and schedule composition.
 *
 * Accounting rule: revenue recognized under the ORIGINAL contract through the
 * day before the modification effective date is immutable. Nothing in this
 * module ever rewrites a historical period.
 */

import {
  addCalendarDays,
  enumerateMonths,
  inclusiveDayCount,
  monthEnd,
  monthKeyOf,
  overlapDaysInMonth,
  proportionOfCents,
  type Cents,
  type Explanation,
  type IsoDate,
  type MonthKey,
  type PerformanceObligationInput,
  type RevenueSchedule,
  type RevenueScheduleRowByMonth,
  type RevenueScheduleRowByPo,
} from "@/lib/asc606";

import { ContractModificationError, type ModifiedPerformanceObligationInput } from "./types";

export interface SourceRow {
  sourceId: string;
  month: MonthKey;
  amountCents: Cents;
  explanation: Explanation;
}

/** Day before the modification effective date; the historical cutoff. */
export function historicalCutoffDate(effectiveDate: IsoDate): IsoDate {
  return addCalendarDays(effectiveDate, -1);
}

export interface HistoricalSegment {
  rows: SourceRow[];
  totalCents: Cents;
  progressDays: number | null;
  totalDays: number | null;
}

/** Preserved original-contract revenue for one obligation through the cutoff. */
export function historicalRevenue(
  po: PerformanceObligationInput,
  allocatedCents: Cents,
  cutoffDate: IsoDate,
): HistoricalSegment {
  if (po.recognitionMethod === "point_in_time") {
    const date = po.recognitionDate!;
    if (date > cutoffDate) return { rows: [], totalCents: 0, progressDays: null, totalDays: null };
    return {
      rows: [
        {
          sourceId: po.id,
          month: monthKeyOf(date),
          amountCents: allocatedCents,
          explanation: {
            template: "point_in_time",
            inputs: { allocatedCents, recognitionDate: date },
          },
        },
      ],
      totalCents: allocatedCents,
      progressDays: null,
      totalDays: null,
    };
  }

  const start = po.serviceStart!;
  const end = po.serviceEnd!;
  const totalDays = inclusiveDayCount(start, end);
  if (cutoffDate < start) {
    return { rows: [], totalCents: 0, progressDays: 0, totalDays };
  }
  const effectiveEnd = cutoffDate < end ? cutoffDate : end;
  const months = enumerateMonths(start, effectiveEnd);

  let cumulativeDays = 0;
  let prior = 0;
  const rows: SourceRow[] = months.map((month) => {
    cumulativeDays += overlapDaysInMonth(month, start, effectiveEnd);
    const cumulative = proportionOfCents(
      allocatedCents,
      cumulativeDays,
      totalDays,
      `historical revenue for "${po.name}"`,
    );
    const amountCents = cumulative - prior;
    const row: SourceRow = {
      sourceId: po.id,
      month,
      amountCents,
      explanation: {
        template: "ratable_daily_cumulative_month",
        inputs: {
          allocatedCents,
          cumulativeEligibleDays: cumulativeDays,
          totalServiceDays: totalDays,
          cumulativeRevenueCents: cumulative,
          priorCumulativeRevenueCents: prior,
          convention: "daily_ratable",
        },
      },
    };
    prior = cumulative;
    return row;
  });

  return { rows, totalCents: prior, progressDays: cumulativeDays, totalDays };
}

/** Inclusive progress days through the cutoff for an over-time obligation. */
export function progressThroughCutoff(
  po: ModifiedPerformanceObligationInput,
  cutoffDate: IsoDate,
): { progressDays: number; totalDays: number } {
  const start = po.serviceStart!;
  const end = po.serviceEnd!;
  const totalDays = inclusiveDayCount(start, end);
  if (cutoffDate < start) return { progressDays: 0, totalDays };
  const effectiveEnd = cutoffDate < end ? cutoffDate : end;
  return { progressDays: inclusiveDayCount(start, effectiveEnd), totalDays };
}

/**
 * Revenue recognized on and after the modification effective date for one
 * post-modification obligation, continuing from `priorCumulativeCents`.
 */
export function futureRevenue(
  po: ModifiedPerformanceObligationInput,
  sourceId: string,
  entitlementCents: Cents,
  priorCumulativeCents: Cents,
  effectiveDate: IsoDate,
): SourceRow[] {
  if (po.recognitionMethod === "point_in_time") {
    const date = po.recognitionDate!;
    return [
      {
        sourceId,
        month: monthKeyOf(date),
        amountCents: entitlementCents - priorCumulativeCents,
        explanation: {
          template: "point_in_time",
          inputs: { allocatedCents: entitlementCents - priorCumulativeCents, recognitionDate: date },
        },
      },
    ];
  }

  const start = po.serviceStart!;
  const end = po.serviceEnd!;
  const totalDays = inclusiveDayCount(start, end);
  const from = start > effectiveDate ? start : effectiveDate;
  if (end < from) {
    throw new ContractModificationError(
      `performance obligation "${po.name}" has no remaining service period after the modification`,
    );
  }
  const months = enumerateMonths(from, end);

  let prior = priorCumulativeCents;
  const rows: SourceRow[] = months.map((month) => {
    const throughDate = monthEnd(month) < end ? monthEnd(month) : end;
    const cumulativeDays = throughDate < start ? 0 : inclusiveDayCount(start, throughDate);
    const cumulative = proportionOfCents(
      entitlementCents,
      cumulativeDays,
      totalDays,
      `post-modification revenue for "${po.name}"`,
    );
    const amountCents = cumulative - prior;
    const row: SourceRow = {
      sourceId,
      month,
      amountCents,
      explanation: {
        template: "ratable_daily_cumulative_month",
        inputs: {
          allocatedCents: entitlementCents,
          cumulativeEligibleDays: cumulativeDays,
          totalServiceDays: totalDays,
          cumulativeRevenueCents: cumulative,
          priorCumulativeRevenueCents: prior,
          convention: "daily_ratable",
        },
      },
    };
    prior = cumulative;
    return row;
  });

  if (prior !== entitlementCents) {
    throw new ContractModificationError(
      `post-modification recognition invariant violated for "${po.name}"`,
    );
  }
  return rows;
}

/** Assembles a RevenueSchedule from source rows, ordered by source then month. */
export function composeSchedule(rows: readonly SourceRow[], sourceOrder: readonly string[]): RevenueSchedule {
  const orderIndex = new Map(sourceOrder.map((id, index) => [id, index]));
  const sorted = [...rows].sort((a, b) => {
    const bySource = (orderIndex.get(a.sourceId) ?? 0) - (orderIndex.get(b.sourceId) ?? 0);
    return bySource !== 0 ? bySource : a.month.localeCompare(b.month);
  });

  const byPo: RevenueScheduleRowByPo[] = sorted.map((row) => ({
    poId: row.sourceId,
    month: row.month,
    revenueCents: row.amountCents,
    explanation: row.explanation,
  }));

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
