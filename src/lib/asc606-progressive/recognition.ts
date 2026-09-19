/**
 * Phase 9G-R3 — Step 5 progressive recognition.
 *
 * Adds two deterministic behaviours the all-or-nothing engine could not
 * express, without changing any accepted arithmetic:
 *
 *  1. over-time INPUT MEASURE recognition (for example support hours), where
 *     cumulative progress drives cumulative revenue; and
 *  2. a supported point-in-time obligation whose transfer date has not yet
 *     occurred, which stays PENDING instead of failing the whole contract.
 *
 * Every allocated dollar of every obligation is always exactly one of
 * scheduled, pending or blocked — never silently zero and never counted twice.
 */

import {
  isValidCents,
  isValidIsoDate,
  monthKeyOf,
  proportionOfCents,
  recognizeOverTime,
  recognizePointInTime,
  type Cents,
  type MonthKey,
  type RecognitionMethod,
  type RecognizableUnit,
  type RevenueSchedule,
  type RevenueScheduleRowByMonth,
  type RevenueScheduleRowByPo,
} from "@/lib/asc606";

import {
  mergeCalculationState,
  ProgressiveAccountingError,
  type BlockedComponent,
  type CalculationState,
  type PendingComponent,
  type PendingReason,
} from "./types";

/** R3 adds an over-time input-measure method to the accepted two. */
export type ProgressiveRecognitionMethod = RecognitionMethod | "over_time_input_measure";

/** One accountant-owned actual-progress observation (never AI-generated). */
export interface ProgressUnitEvent {
  id: string;
  /** Date the units were incurred, "YYYY-MM-DD". */
  date: string;
  /** Units incurred on that date. Zero is allowed; negative is invalid. */
  units: number;
}

export interface ProgressiveRecognizableUnit extends Omit<RecognizableUnit, "recognitionMethod"> {
  recognitionMethod: ProgressiveRecognitionMethod;
  /** Input measure only: contracted / expected total units. Must be > 0. */
  totalExpectedUnits?: number;
  /** Input measure only: display label, for example "hours". */
  unitLabel?: string;
  /** Input measure only: actual progress to date. */
  progressEvents?: readonly ProgressUnitEvent[];
  /**
   * Point in time only: true when the accountant has confirmed that no transfer
   * date is known yet. Absent/empty dates are treated the same way — R3 never
   * fabricates a transfer date.
   */
  transferDateUnknown?: boolean;
}

export interface ProgressiveScheduleInput {
  po: ProgressiveRecognizableUnit;
  allocatedCents: Cents;
}

export interface ProgressivePoRecognition {
  poId: string;
  poName: string;
  method: ProgressiveRecognitionMethod;
  allocatedCents: Cents;
  scheduledCents: Cents;
  pendingCents: Cents;
  blockedCents: Cents;
  state: CalculationState;
  reason: PendingReason | null;
  /** Input measure only. */
  progress: {
    unitLabel: string;
    totalExpectedUnits: number;
    cumulativeUnits: number;
    /** Basis points of completion (10000 = 100%). Display only. */
    cumulativePercentBps: number;
  } | null;
}

export interface ProgressiveRevenueResult {
  state: CalculationState;
  /** Always present: it contains every row that IS determinable today. */
  schedule: RevenueSchedule;
  byPo: ProgressivePoRecognition[];
  pending: PendingComponent[];
  blocked: BlockedComponent[];
}

interface PoRows {
  month: MonthKey;
  revenueCents: Cents;
  explanation: RevenueScheduleRowByPo["explanation"];
}

// ---------------------------------------------------------------------------
// Input measure
// ---------------------------------------------------------------------------

export interface InputMeasureResult {
  rows: PoRows[];
  scheduledCents: Cents;
  cumulativeUnits: number;
  cumulativePercentBps: number;
}

/**
 * Cumulative input-measure recognition.
 *
 *   cumulative % complete = cumulative units incurred / total expected units
 *   cumulative revenue    = allocated x cumulative % complete
 *   period revenue        = cumulative revenue - prior cumulative revenue
 *
 * Throws (category A) on an invalid denominator, negative units, a duplicate
 * event, an invalid date or progress that exceeds the expected total.
 */
export function recognizeInputMeasure(
  po: ProgressiveRecognizableUnit,
  allocatedCents: Cents,
): InputMeasureResult {
  const total = po.totalExpectedUnits;
  if (typeof total !== "number" || !Number.isFinite(total) || total <= 0) {
    throw new ProgressiveAccountingError(
      `performance obligation "${po.name}" needs a total expected ${po.unitLabel ?? "units"} greater than zero`,
    );
  }

  const events = [...(po.progressEvents ?? [])];
  const seen = new Set<string>();
  for (const event of events) {
    if (seen.has(event.id)) {
      throw new ProgressiveAccountingError(
        `performance obligation "${po.name}" has a duplicate progress event "${event.id}"`,
      );
    }
    seen.add(event.id);
    if (!isValidIsoDate(event.date)) {
      throw new ProgressiveAccountingError(
        `performance obligation "${po.name}" has a progress event without a valid date`,
      );
    }
    if (!Number.isFinite(event.units) || event.units < 0) {
      throw new ProgressiveAccountingError(
        `performance obligation "${po.name}" has a negative or invalid progress quantity`,
      );
    }
  }

  events.sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date < b.date ? -1 : 1));

  // Exact integer measure: units are scaled to avoid floating-point ratios.
  const SCALE = 1_000_000;
  const scaled = (value: number): number => {
    const result = Math.round(value * SCALE);
    if (!Number.isSafeInteger(result)) {
      throw new ProgressiveAccountingError(
        `performance obligation "${po.name}" has a progress quantity outside the supported range`,
      );
    }
    return result;
  };
  const totalScaled = scaled(total);

  const byMonth = new Map<MonthKey, number>();
  let cumulativeScaled = 0;
  for (const event of events) {
    cumulativeScaled += scaled(event.units);
    if (cumulativeScaled > totalScaled) {
      throw new ProgressiveAccountingError(
        `performance obligation "${po.name}" has cumulative progress exceeding the total expected ${po.unitLabel ?? "units"}`,
      );
    }
    const month = monthKeyOf(event.date);
    byMonth.set(month, (byMonth.get(month) ?? 0) + scaled(event.units));
  }

  const months = [...byMonth.keys()].sort();
  let runningScaled = 0;
  let priorCumulativeCents = 0;
  const rows: PoRows[] = [];
  for (const month of months) {
    runningScaled += byMonth.get(month)!;
    const cumulativeCents = proportionOfCents(
      allocatedCents,
      runningScaled,
      totalScaled,
      `cumulative revenue for "${po.name}"`,
    );
    const revenueCents = cumulativeCents - priorCumulativeCents;
    if (revenueCents < 0) {
      throw new ProgressiveAccountingError(
        `input-measure recognition produced negative revenue for "${po.name}"`,
      );
    }
    rows.push({
      month,
      revenueCents,
      explanation: {
        template: "input_measure_cumulative_month",
        inputs: {
          allocatedCents,
          unitLabel: po.unitLabel ?? "units",
          unitsInMonth: byMonth.get(month)! / SCALE,
          cumulativeUnits: runningScaled / SCALE,
          totalExpectedUnits: total,
          cumulativeRevenueCents: cumulativeCents,
          priorCumulativeRevenueCents: priorCumulativeCents,
        },
      },
    });
    priorCumulativeCents = cumulativeCents;
  }

  if (priorCumulativeCents > allocatedCents) {
    throw new ProgressiveAccountingError(
      `input-measure recognition for "${po.name}" exceeded its allocated amount`,
    );
  }

  return {
    rows,
    scheduledCents: priorCumulativeCents,
    cumulativeUnits: cumulativeScaled / SCALE,
    cumulativePercentBps: Math.round((cumulativeScaled / totalScaled) * 10_000),
  };
}

// ---------------------------------------------------------------------------
// Contract-level progressive schedule
// ---------------------------------------------------------------------------

function emptySchedule(): RevenueSchedule {
  return { byPo: [], byMonth: [], totalCents: 0, firstMonth: null, lastMonth: null };
}

/**
 * Builds the contract revenue schedule from whatever IS determinable, and
 * reports the rest as pending (future fact) or blocked (invalid input).
 *
 * One obligation's pending future fact never removes another obligation's
 * schedule rows.
 */
export function generateProgressiveRevenueSchedule(
  inputs: readonly ProgressiveScheduleInput[],
): ProgressiveRevenueResult {
  const ordered = [...inputs].sort((a, b) => a.po.seq - b.po.seq);

  const byPoRows: RevenueScheduleRowByPo[] = [];
  const byPo: ProgressivePoRecognition[] = [];
  const pending: PendingComponent[] = [];
  const blocked: BlockedComponent[] = [];

  for (const { po, allocatedCents } of ordered) {
    // R3 Part 1 hardening: an invalid allocation is category A at the boundary.
    // It is never carried into a pending bucket, and it blocks ONLY this PO.
    if (!isValidCents(allocatedCents) || allocatedCents < 0) {
      blocked.push({
        poId: po.id,
        poName: po.name,
        amountCents: 0,
        code: "allocation.invalid",
        message: `Performance obligation "${po.name}" has an invalid allocated amount.`,
      });
      byPo.push({
        poId: po.id,
        poName: po.name,
        method: po.recognitionMethod,
        allocatedCents: 0,
        progress: null,
        scheduledCents: 0,
        pendingCents: 0,
        blockedCents: 0,
        state: "blocked",
        reason: null,
      });
      continue;
    }

    const base = {
      poId: po.id,
      poName: po.name,
      method: po.recognitionMethod,
      allocatedCents,
      progress: null as ProgressivePoRecognition["progress"],
    };

    const push = (rows: PoRows[]): Cents => {
      let total = 0;
      for (const row of rows) {
        byPoRows.push({
          poId: po.id,
          month: row.month,
          revenueCents: row.revenueCents,
          explanation: row.explanation,
        });
        total += row.revenueCents;
      }
      return total;
    };

    const block = (code: string, message: string) => {
      blocked.push({ poId: po.id, poName: po.name, amountCents: allocatedCents, code, message });
      byPo.push({
        ...base,
        scheduledCents: 0,
        pendingCents: 0,
        blockedCents: allocatedCents,
        state: "blocked",
        reason: null,
      });
    };

    const pend = (reason: PendingReason, detail?: PendingComponent["detail"]) => {
      pending.push({
        poId: po.id,
        poName: po.name,
        amountCents: allocatedCents,
        reason,
        ...(detail ? { detail } : {}),
      });
      byPo.push({
        ...base,
        scheduledCents: 0,
        pendingCents: allocatedCents,
        blockedCents: 0,
        state: "pending",
        reason,
      });
    };

    switch (po.recognitionMethod) {
      case "over_time_ratable": {
        try {
          const scheduled = push(
            recognizeOverTime(po as RecognizableUnit, allocatedCents) as PoRows[],
          );
          byPo.push({
            ...base,
            scheduledCents: scheduled,
            pendingCents: 0,
            blockedCents: 0,
            state: "complete",
            reason: null,
          });
        } catch (error) {
          block("recognition.over_time", (error as Error).message);
        }
        break;
      }

      case "point_in_time": {
        const date = po.recognitionDate;
        const hasDate = date !== undefined && date !== null && date !== "";
        const markedUnknown = po.transferDateUnknown === true;
        if (markedUnknown && hasDate) {
          // Contradictory input: cannot be both "not yet transferred" and dated.
          block(
            "recognition.point_in_time.contradictory",
            `Performance obligation "${po.name}" is marked as having no known transfer date but also carries one.`,
          );
          break;
        }
        if (markedUnknown) {
          // Category C: the treatment is known, the transfer has not happened.
          // The allocated amount is RETAINED as pending, never recognized and
          // never dropped, and no date is fabricated.
          pend("awaiting_transfer_date");
          break;
        }
        if (!hasDate) {
          // An ordinary missing input is NOT a future-event assumption.
          block(
            "recognition.point_in_time.date_missing",
            `Performance obligation "${po.name}" needs a transfer date, or must be marked as not yet transferred.`,
          );
          break;
        }
        if (!isValidIsoDate(date)) {
          block(
            "recognition.point_in_time.date_invalid",
            `Performance obligation "${po.name}" has an invalid transfer date.`,
          );
          break;
        }
        const scheduled = push(
          recognizePointInTime(po as RecognizableUnit, allocatedCents) as PoRows[],
        );
        byPo.push({
          ...base,
          scheduledCents: scheduled,
          pendingCents: 0,
          blockedCents: 0,
          state: "complete",
          reason: null,
        });
        break;
      }

      case "over_time_input_measure": {
        let measured: InputMeasureResult;
        try {
          measured = recognizeInputMeasure(po, allocatedCents);
        } catch (error) {
          block("recognition.input_measure", (error as Error).message);
          break;
        }
        const scheduled = push(measured.rows);
        const remaining = allocatedCents - scheduled;
        const progress = {
          unitLabel: po.unitLabel ?? "units",
          totalExpectedUnits: po.totalExpectedUnits!,
          cumulativeUnits: measured.cumulativeUnits,
          cumulativePercentBps: measured.cumulativePercentBps,
        };
        if (remaining > 0) {
          // Known denominator with no (or partial) actuals is PENDING, never
          // invalid, and never converted to a ratable or point-in-time method.
          pending.push({
            poId: po.id,
            poName: po.name,
            amountCents: remaining,
            reason: "awaiting_progress_actuals",
            detail: {
              unitLabel: progress.unitLabel,
              totalExpectedUnits: progress.totalExpectedUnits,
              cumulativeUnits: progress.cumulativeUnits,
            },
          });
        }
        byPo.push({
          ...base,
          progress,
          scheduledCents: scheduled,
          pendingCents: remaining,
          blockedCents: 0,
          state: remaining > 0 ? "pending" : "complete",
          reason: remaining > 0 ? "awaiting_progress_actuals" : null,
        });
        break;
      }

      default: {
        block(
          "recognition.method.unsupported",
          `Performance obligation "${po.name}" has an unsupported recognition method.`,
        );
      }
    }
  }

  // Per-PO conservation: allocated = scheduled + pending + blocked, always.
  for (const row of byPo) {
    if (row.scheduledCents + row.pendingCents + row.blockedCents !== row.allocatedCents) {
      throw new ProgressiveAccountingError(
        `progressive conservation violated for "${row.poName}": ${row.scheduledCents} + ${row.pendingCents} + ${row.blockedCents} != ${row.allocatedCents}`,
      );
    }
  }

  const monthKeys = [...new Set(byPoRows.map((row) => row.month))].sort();
  let cumulative = 0;
  const byMonth: RevenueScheduleRowByMonth[] = monthKeys.map((month) => {
    const perPo: Record<string, Cents> = {};
    let totalCents = 0;
    for (const row of byPoRows) {
      if (row.month !== month) continue;
      perPo[row.poId] = (perPo[row.poId] ?? 0) + row.revenueCents;
      totalCents += row.revenueCents;
    }
    cumulative += totalCents;
    return { month, perPo, totalCents, cumulativeCents: cumulative };
  });

  const schedule: RevenueSchedule =
    monthKeys.length === 0
      ? emptySchedule()
      : {
          byPo: byPoRows,
          byMonth,
          totalCents: cumulative,
          firstMonth: monthKeys[0] ?? null,
          lastMonth: monthKeys[monthKeys.length - 1] ?? null,
        };

  return {
    state: mergeCalculationState(...byPo.map((row) => row.state)),
    schedule,
    byPo,
    pending,
    blocked,
  };
}
