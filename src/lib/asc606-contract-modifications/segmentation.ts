/**
 * Phase 5C segmentation — cutoff dates, stable accounting identity, and the
 * preserved historical revenue segment.
 *
 * Accounting rule: revenue recognized under the ORIGINAL contract through the
 * day before the modification effective date is immutable. Nothing in this
 * module ever rewrites a historical period.
 *
 * This module is NOT a general-purpose revenue engine. It contains exactly one
 * revenue calculation — `historicalRevenue()` — and that calculation cannot be
 * delegated to the core engine: it is a TRUNCATION of the original contract's
 * already-running recognition clock (original allocated amount, original
 * total-days denominator) at an arbitrary mid-month cutoff. Re-running the core
 * engine on a shortened window would re-base the denominator and could restate
 * history by a cent, which the immutability rule forbids. All ordinary
 * post-modification recognition lives in `recognition.ts` and delegates to the
 * core engine.
 */

import {
  addCalendarDays,
  enumerateMonths,
  inclusiveDayCount,
  monthKeyOf,
  overlapDaysInMonth,
  proportionOfCents,
  type Cents,
  type Explanation,
  type IsoDate,
  type MonthKey,
  type PerformanceObligationInput,
} from "@/lib/asc606";

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

// ---------------------------------------------------------------------------
// Stable deterministic accounting identity (no timestamps, no array indexes)
// ---------------------------------------------------------------------------

export const ORIGINAL_SEGMENT_ID = "segment::original";
export const ORIGINAL_CONTRACT_ID = "contract::original";

export type ModificationSegmentKind =
  "historical" | "separate" | "prospective" | "catch_up" | "mixed";

export const HISTORICAL_SEGMENT_ID = "segment::historical";

export function modificationSegmentId(
  modificationId: string,
  kind: ModificationSegmentKind,
): string {
  return `segment::mod::${modificationId}::${kind}`;
}

export function modificationContractId(modificationId: string): string {
  return `contract::mod::${modificationId}`;
}

export type ModificationSourceKind =
  | "original_historical"
  | "separate_contract_po"
  | "prospective_modified_po"
  | "modification_catch_up"
  | "mixed_prospective_po"
  | "mixed_catch_up"
  | "modification_continuation";

export function modificationSourceId(
  modificationId: string,
  kind: ModificationSourceKind,
  poId: string,
): string {
  return `source::mod::${modificationId}::${kind}::${poId}`;
}

// ---------------------------------------------------------------------------
// Preserved historical revenue
// ---------------------------------------------------------------------------

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
