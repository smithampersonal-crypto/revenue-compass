/**
 * Phase 5C recognition orchestration.
 *
 * ARCHITECTURE RULE (Phase 5C remediation item 2)
 * -----------------------------------------------
 * There is exactly ONE revenue-recognition engine in this application:
 * `src/lib/asc606/recognition.ts`. Whenever a post-modification accounting
 * segment can be expressed as an ordinary performance obligation
 * (allocated consideration + service window + recognition method), this module
 * MUST delegate to that engine and MUST NOT reproduce its arithmetic.
 *
 * Only one calculation in this file is genuinely modification-specific:
 * `continueFromRevisedCumulative()`. See its doc comment for why the ordinary
 * engine cannot represent it.
 */

import {
  enumerateMonths,
  inclusiveDayCount,
  monthEnd,
  monthKeyOf,
  proportionOfCents,
  recognizePerformanceObligation,
  type Cents,
  type IsoDate,
  type MonthKey,
  type RevenueSchedule,
  type RevenueScheduleRowByMonth,
  type RevenueScheduleRowByPo,
} from "@/lib/asc606";

import { ContractModificationError, type ModifiedPerformanceObligationInput } from "./types";
import type { SourceRow } from "./segmentation";

export type { SourceRow } from "./segmentation";

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
 * ORDINARY prospective recognition — ASC 606-10-25-12 separate contracts and
 * ASC 606-10-25-13(a)/(c) distinct remaining obligations.
 *
 * The segment begins a NEW recognition clock on the modification date, so it is
 * an ordinary performance obligation in every respect. This function therefore
 * does nothing but hand the obligation to the core engine and relabel the rows
 * with a modification-traceable source id. Any monthly amount produced here is
 * by construction identical to the core engine's output for the same inputs;
 * `__tests__/engine-equivalence.spec.ts` enforces that deep equality.
 */
export function prospectiveRecognition(
  po: ModifiedPerformanceObligationInput,
  sourceId: string,
  allocatedCents: Cents,
): SourceRow[] {
  return recognizePerformanceObligation(
    {
      id: po.id,
      seq: po.seq,
      name: po.name,
      recognitionMethod: po.recognitionMethod,
      ...(po.serviceStart ? { serviceStart: po.serviceStart } : {}),
      ...(po.serviceEnd ? { serviceEnd: po.serviceEnd } : {}),
      ...(po.recognitionDate ? { recognitionDate: po.recognitionDate } : {}),
    },
    allocatedCents,
  ).map((row) => ({
    sourceId,
    month: row.month,
    amountCents: row.revenueCents,
    explanation: row.explanation,
  }));
}

/**
 * MODIFICATION-SPECIFIC continuation — ASC 606-10-25-13(b) and the
 * non-distinct leg of 25-13(c).
 *
 * Why the core engine cannot express this
 * ---------------------------------------
 * A cumulative catch-up does not start a new recognition clock. The obligation
 * keeps its ORIGINAL service window and its ORIGINAL total-days denominator,
 * and on the modification date its cumulative entitlement is re-measured
 * against a REVISED total entitlement. Recognition after that date is therefore
 * the difference between the revised cumulative curve and a non-zero opening
 * cumulative balance (`priorCumulativeCents`), over a window that started
 * before the first scheduled month.
 *
 * The core `recognizePerformanceObligation()` API has no opening-cumulative
 * parameter and always begins its clock at zero on `serviceStart`, so it cannot
 * represent this pattern. This function is deliberately limited to that single
 * behaviour: it accepts only obligations that already progressed past the
 * modification date, and it uses the same shared exact primitives
 * (`proportionOfCents`, integer cents, shared date helpers) as the core engine
 * so the two can never diverge on rounding convention.
 */
export function continueFromRevisedCumulative(
  po: ModifiedPerformanceObligationInput,
  sourceId: string,
  revisedEntitlementCents: Cents,
  priorCumulativeCents: Cents,
  effectiveDate: IsoDate,
): SourceRow[] {
  if (po.recognitionMethod === "point_in_time") {
    const date = po.recognitionDate!;
    return [
      {
        sourceId,
        month: monthKeyOf(date),
        amountCents: revisedEntitlementCents - priorCumulativeCents,
        explanation: {
          template: "point_in_time",
          inputs: {
            allocatedCents: revisedEntitlementCents - priorCumulativeCents,
            recognitionDate: date,
          },
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

  let prior = priorCumulativeCents;
  const rows: SourceRow[] = enumerateMonths(from, end).map((month) => {
    const throughDate = monthEnd(month) < end ? monthEnd(month) : end;
    const cumulativeDays = throughDate < start ? 0 : inclusiveDayCount(start, throughDate);
    const cumulative = proportionOfCents(
      revisedEntitlementCents,
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
          allocatedCents: revisedEntitlementCents,
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

  if (prior !== revisedEntitlementCents) {
    throw new ContractModificationError(
      `post-modification recognition invariant violated for "${po.name}"`,
    );
  }
  return rows;
}

/** Assembles a RevenueSchedule from source rows, ordered by source then month. */
export function composeSchedule(
  rows: readonly SourceRow[],
  sourceOrder: readonly string[],
): RevenueSchedule {
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

  const monthKeys: MonthKey[] = [...new Set(byPo.map((row) => row.month))].sort();
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
