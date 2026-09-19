/**
 * Phase 9G-R3 Part 2 — folding the variable-consideration layer into Step 5.
 *
 * The Part 1 recognition engine is frozen. This module takes its result and
 * applies the specific-series-period layer on top:
 *
 *  - a REALIZED amount adjusts ONLY the service period it actually arose in;
 *  - an INCLUDED-but-unrealized amount is retained against its obligation as
 *    pending, with a stable component identity;
 *  - conservation is re-proved: allocated = scheduled + pending + blocked.
 *
 * General and specific-PO amounts never pass through here: they are part of
 * the allocated transaction price and are recognized by the obligation's own
 * accepted method.
 */

import { sumCents, type Cents, type MonthKey, type RevenueSchedule } from "@/lib/asc606";

import type { ProgressivePoRecognition, ProgressiveRevenueResult } from "./recognition";
import { mergeCalculationState, ProgressiveAccountingError, type PendingComponent } from "./types";
import type { ProgressiveVcLayers } from "./variable-consideration";

export function applyVariableLayers(
  base: ProgressiveRevenueResult,
  layers: ProgressiveVcLayers,
): ProgressiveRevenueResult {
  const byPoIndex = new Map(base.byPo.map((row) => [row.poId, row]));

  // Orphan rejection: a variable detail may never reference a missing owner.
  for (const row of layers.seriesPeriod) {
    if (!byPoIndex.has(row.poId)) {
      throw new ProgressiveAccountingError(
        `realized variable consideration "${row.id}" references an obligation that has no recognition result`,
      );
    }
  }
  for (const component of layers.pending) {
    if (!byPoIndex.has(component.poId)) {
      throw new ProgressiveAccountingError(
        `pending variable consideration for "${component.poName}" references an obligation that has no recognition result`,
      );
    }
  }

  const scheduleRows = [...base.schedule.byPo];
  const scheduledByPo = new Map<string, Cents>();
  for (const row of layers.seriesPeriod) {
    scheduledByPo.set(row.poId, sumCents([scheduledByPo.get(row.poId) ?? 0, row.amountCents]));
    scheduleRows.push({
      poId: row.poId,
      month: row.month,
      revenueCents: row.amountCents,
      explanation: {
        template: "variable_consideration_series_period",
        inputs: {
          componentId: row.componentId,
          eventId: row.eventId,
          seriesPeriod: row.seriesPeriodLabel,
          date: row.date,
          amountCents: row.amountCents,
        },
      },
    });
  }

  const pendingByPo = new Map<string, Cents>();
  for (const component of layers.pending) {
    pendingByPo.set(
      component.poId,
      sumCents([pendingByPo.get(component.poId) ?? 0, component.amountCents]),
    );
  }

  const byPo: ProgressivePoRecognition[] = base.byPo.map((row) => {
    const extraScheduled = scheduledByPo.get(row.poId) ?? 0;
    const extraPending = pendingByPo.get(row.poId) ?? 0;
    if (extraScheduled === 0 && extraPending === 0) return row;
    if (row.state === "blocked") {
      throw new ProgressiveAccountingError(
        `variable consideration cannot be applied to "${row.poName}" because its recognition is blocked`,
      );
    }
    const scheduledCents = sumCents([row.scheduledCents, extraScheduled]);
    const pendingCents = sumCents([row.pendingCents, extraPending]);
    return {
      ...row,
      allocatedCents: sumCents([row.allocatedCents, extraScheduled, extraPending]),
      scheduledCents,
      pendingCents,
      state:
        pendingCents > 0
          ? "pending"
          : row.state === "pending" && row.pendingCents === 0
            ? "complete"
            : row.state,
      reason: pendingCents > 0 ? (row.reason ?? "awaiting_variable_consideration_event") : row.reason,
    };
  });

  for (const row of byPo) {
    if (sumCents([row.scheduledCents, row.pendingCents, row.blockedCents]) !== row.allocatedCents) {
      throw new ProgressiveAccountingError(
        `progressive conservation violated for "${row.poName}" after applying variable consideration`,
      );
    }
  }

  const pending: PendingComponent[] = [...base.pending, ...layers.pending];

  return {
    state: mergeCalculationState(
      base.state,
      layers.state,
      ...byPo.map((row) => row.state),
    ),
    schedule: rebuildSchedule(scheduleRows),
    byPo,
    pending,
    blocked: [...base.blocked, ...layers.blocked],
  };
}

function rebuildSchedule(rows: RevenueSchedule["byPo"]): RevenueSchedule {
  if (rows.length === 0) {
    return { byPo: [], byMonth: [], totalCents: 0, firstMonth: null, lastMonth: null };
  }
  const months: MonthKey[] = [...new Set(rows.map((row) => row.month))].sort();
  let cumulative = 0;
  const byMonth = months.map((month) => {
    const perPo: Record<string, Cents> = {};
    let totalCents = 0;
    for (const row of rows) {
      if (row.month !== month) continue;
      perPo[row.poId] = sumCents([perPo[row.poId] ?? 0, row.revenueCents]);
      totalCents = sumCents([totalCents, row.revenueCents]);
    }
    cumulative = sumCents([cumulative, totalCents]);
    return { month, perPo, totalCents, cumulativeCents: cumulative };
  });
  return {
    byPo: [...rows].sort((a, b) => (a.month === b.month ? a.poId.localeCompare(b.poId) : a.month < b.month ? -1 : 1)),
    byMonth,
    totalCents: cumulative,
    firstMonth: months[0] ?? null,
    lastMonth: months[months.length - 1] ?? null,
  };
}
