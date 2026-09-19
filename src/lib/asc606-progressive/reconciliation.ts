/**
 * Phase 9G-R3 — progressive reconciliation.
 *
 * R3 strengthens reconciliation rather than weakening it. Progressive output
 * is only permitted when every allocated dollar is still traceable:
 *
 *   allocated = scheduled revenue + pending (future fact) + blocked (invalid)
 *
 * No allocated consideration may disappear because a future fact is unknown,
 * no unknown amount may be coerced to zero, and no amount may appear in both
 * the scheduled and the pending bucket.
 *
 * R3 Part 1 hardening adds two further guarantees:
 *
 *  - the recognition layer must account for every allocated PO EXACTLY once —
 *    a missing or duplicated recognition row is a reconciliation failure, never
 *    a silently synthesized blocked bucket; and
 *  - the pending / blocked / schedule DETAIL arrays must agree, per PO, with
 *    the per-PO monetary summary.
 */

import { sumCents, type AllocationRow, type Cents } from "@/lib/asc606";

import type { ProgressiveRevenueResult } from "./recognition";
import {
  mergeCalculationState,
  sumPendingCents,
  type CalculationState,
  type PendingComponent,
} from "./types";

export interface ProgressiveReconciliationRow {
  poId: string;
  poName: string;
  allocatedCents: Cents;
  recognizedCents: Cents;
  pendingCents: Cents;
  blockedCents: Cents;
  /** Allocated consideration the recognition layer has not accounted for. */
  unresolvedCents: Cents;
  reconciled: boolean;
}

export interface ProgressiveReconciliation {
  state: CalculationState;
  transactionPriceCents: Cents;
  allocatedCents: Cents;
  scheduledRevenueCents: Cents;
  pendingCents: Cents;
  blockedCents: Cents;
  unresolvedCents: Cents;
  byPo: ProgressiveReconciliationRow[];
  pending: PendingComponent[];
  /** True when price ties to allocation and every PO ties to its buckets. */
  reconciled: boolean;
  failures: string[];
}

export interface ProgressiveReconciliationInput {
  transactionPriceCents: Cents;
  allocation: readonly AllocationRow[];
  recognition: ProgressiveRevenueResult;
  /**
   * Amounts pending outside the PO recognition layer, for example specifically
   * allocated variable consideration awaiting a realized event.
   *
   * NOTE (R3 Part 2): this is a transitional surface only. Nonzero included
   * variable consideration must be expressed by the deterministic variable
   * consideration layer and reconciled together with the transaction price —
   * it may not live "outside" reconciliation merely because it is pending.
   */
  externalPending?: readonly PendingComponent[];
}

export function reconcileProgressive(
  input: ProgressiveReconciliationInput,
): ProgressiveReconciliation {
  const failures: string[] = [];

  // Exactly-once accounting: index recognition rows and detect duplicates.
  const recognitionByPo = new Map<string, ProgressiveRevenueResult["byPo"][number]>();
  const duplicated = new Set<string>();
  for (const row of input.recognition.byPo) {
    if (recognitionByPo.has(row.poId)) duplicated.add(row.poId);
    else recognitionByPo.set(row.poId, row);
  }

  // Detail arrays, grouped per PO, with duplicate-identity detection.
  const pendingByPo = new Map<string, Cents>();
  const pendingIdentities = new Set<string>();
  for (const component of input.recognition.pending) {
    const identity = `${component.poId}::${component.reason}`;
    if (pendingIdentities.has(identity)) {
      failures.push(
        `"${component.poName}" has a duplicate pending component for the same reason; an amount may not be counted twice.`,
      );
    }
    pendingIdentities.add(identity);
    pendingByPo.set(
      component.poId,
      sumCents([pendingByPo.get(component.poId) ?? 0, component.amountCents]),
    );
  }

  const blockedByPo = new Map<string, Cents>();
  const blockedIdentities = new Set<string>();
  for (const component of input.recognition.blocked) {
    const identity = `${component.poId}::${component.code}`;
    if (blockedIdentities.has(identity)) {
      failures.push(
        `"${component.poName}" has a duplicate blocked component for the same reason; an amount may not be counted twice.`,
      );
    }
    blockedIdentities.add(identity);
    blockedByPo.set(
      component.poId,
      sumCents([blockedByPo.get(component.poId) ?? 0, component.amountCents]),
    );
  }

  const scheduledByPo = new Map<string, Cents>();
  for (const row of input.recognition.schedule.byPo) {
    scheduledByPo.set(row.poId, sumCents([scheduledByPo.get(row.poId) ?? 0, row.revenueCents]));
  }

  let allocatedTotal = 0n;
  let scheduledTotal = 0n;
  let pendingTotal = 0n;
  let blockedTotal = 0n;
  let unresolvedTotal = 0n;

  const byPo: ProgressiveReconciliationRow[] = input.allocation.map((row) => {
    const recognized = recognitionByPo.get(row.poId);
    let rowReconciled = true;

    if (duplicated.has(row.poId)) {
      failures.push(`"${row.name}" has more than one recognition result.`);
      rowReconciled = false;
    }
    if (!recognized) {
      failures.push(`"${row.name}" has no recognition result; its allocation is unaccounted for.`);
      rowReconciled = false;
    }

    const recognizedCents = recognized?.scheduledCents ?? 0;
    const pendingCents = recognized?.pendingCents ?? 0;
    const blockedCents = recognized?.blockedCents ?? 0;
    const accounted = sumCents([recognizedCents, pendingCents, blockedCents]);
    const unresolvedCents = recognized ? row.allocatedCents - accounted : row.allocatedCents;

    if (recognized) {
      if (accounted !== row.allocatedCents) {
        failures.push(
          `"${row.name}": allocated ${row.allocatedCents} does not equal recognized ${recognizedCents} + pending ${pendingCents} + blocked ${blockedCents}.`,
        );
        rowReconciled = false;
      }
      if (recognizedCents > row.allocatedCents) {
        failures.push(`"${row.name}": recognized revenue exceeds its allocated amount.`);
        rowReconciled = false;
      }
      // Detail arrays must agree with the monetary summary.
      if ((pendingByPo.get(row.poId) ?? 0) !== pendingCents) {
        failures.push(
          `"${row.name}": pending detail ${pendingByPo.get(row.poId) ?? 0} does not equal the pending amount ${pendingCents}.`,
        );
        rowReconciled = false;
      }
      if ((blockedByPo.get(row.poId) ?? 0) !== blockedCents) {
        failures.push(
          `"${row.name}": blocked detail ${blockedByPo.get(row.poId) ?? 0} does not equal the blocked amount ${blockedCents}.`,
        );
        rowReconciled = false;
      }
      if ((scheduledByPo.get(row.poId) ?? 0) !== recognizedCents) {
        failures.push(
          `"${row.name}": revenue schedule rows ${scheduledByPo.get(row.poId) ?? 0} do not equal the scheduled amount ${recognizedCents}.`,
        );
        rowReconciled = false;
      }
    }

    allocatedTotal += BigInt(row.allocatedCents);
    scheduledTotal += BigInt(recognizedCents);
    pendingTotal += BigInt(pendingCents);
    blockedTotal += BigInt(blockedCents);
    unresolvedTotal += BigInt(unresolvedCents);

    return {
      poId: row.poId,
      poName: row.name,
      allocatedCents: row.allocatedCents,
      recognizedCents,
      pendingCents,
      blockedCents,
      unresolvedCents,
      reconciled: rowReconciled,
    };
  });

  // No PO may be recognized without being allocated.
  const allocatedIds = new Set(input.allocation.map((row) => row.poId));
  for (const row of input.recognition.byPo) {
    if (!allocatedIds.has(row.poId)) {
      failures.push(`"${row.poName}" produced recognition output without an allocation.`);
    }
  }

  if (allocatedTotal !== BigInt(input.transactionPriceCents)) {
    failures.push(
      `Allocated ${allocatedTotal} does not equal the transaction price ${input.transactionPriceCents}.`,
    );
  }

  const external = input.externalPending ?? [];
  const externalPendingCents = sumPendingCents(external);
  const scheduledPoIds = new Set(
    input.recognition.byPo.filter((row) => row.scheduledCents > 0).map((row) => row.poId),
  );
  for (const component of external) {
    // A specifically allocated pending amount may not also be scheduled under
    // the same identity: that would double count it.
    if (
      component.amountCents > 0 &&
      scheduledPoIds.has(component.poId) &&
      input.recognition.byPo.find((row) => row.poId === component.poId)?.pendingCents ===
        component.amountCents
    ) {
      failures.push(
        `Pending amount for "${component.poName}" is counted in both the recognition and the external pending layer.`,
      );
    }
  }

  const scheduledRevenueCents = sumCents([Number(scheduledTotal)]);
  if (scheduledRevenueCents !== input.recognition.schedule.totalCents) {
    failures.push(
      `Scheduled revenue ${scheduledRevenueCents} does not equal the revenue schedule total ${input.recognition.schedule.totalCents}.`,
    );
  }

  const unresolvedCents = sumCents([Number(unresolvedTotal)]);
  const pendingComponents = [...input.recognition.pending, ...external];
  const state = mergeCalculationState(
    input.recognition.state,
    failures.length > 0 || unresolvedCents !== 0 ? "blocked" : "complete",
    externalPendingCents > 0 ? "pending" : "complete",
  );

  return {
    state,
    transactionPriceCents: input.transactionPriceCents,
    allocatedCents: sumCents(input.allocation.map((row) => row.allocatedCents)),
    scheduledRevenueCents,
    pendingCents: sumCents([Number(pendingTotal), externalPendingCents]),
    blockedCents: sumCents([Number(blockedTotal)]),
    unresolvedCents,
    byPo,
    pending: pendingComponents,
    reconciled: failures.length === 0 && unresolvedCents === 0,
    failures,
  };
}
