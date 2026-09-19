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
 */

import type { AllocationRow, Cents } from "@/lib/asc606";

import type { ProgressiveRevenueResult } from "./recognition";
import {
  mergeCalculationState,
  sumBlockedCents,
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
  reconciled: boolean;
}

export interface ProgressiveReconciliation {
  state: CalculationState;
  transactionPriceCents: Cents;
  allocatedCents: Cents;
  scheduledRevenueCents: Cents;
  pendingCents: Cents;
  blockedCents: Cents;
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
   */
  externalPending?: readonly PendingComponent[];
}

export function reconcileProgressive(
  input: ProgressiveReconciliationInput,
): ProgressiveReconciliation {
  const failures: string[] = [];
  const recognitionByPo = new Map(input.recognition.byPo.map((row) => [row.poId, row]));

  let allocatedTotal = 0n;
  let scheduledTotal = 0n;
  let pendingTotal = 0n;
  let blockedTotal = 0n;

  const byPo: ProgressiveReconciliationRow[] = input.allocation.map((row) => {
    const recognized = recognitionByPo.get(row.poId);
    const recognizedCents = recognized?.scheduledCents ?? 0;
    const pendingCents = recognized?.pendingCents ?? 0;
    const blockedCents = recognized?.blockedCents ?? (recognized ? 0 : row.allocatedCents);
    const reconciled =
      recognizedCents + pendingCents + blockedCents === row.allocatedCents &&
      recognizedCents <= row.allocatedCents;
    if (!reconciled) {
      failures.push(
        `"${row.name}": allocated ${row.allocatedCents} does not equal recognized ${recognizedCents} + pending ${pendingCents} + blocked ${blockedCents}.`,
      );
    }
    allocatedTotal += BigInt(row.allocatedCents);
    scheduledTotal += BigInt(recognizedCents);
    pendingTotal += BigInt(pendingCents);
    blockedTotal += BigInt(blockedCents);
    return {
      poId: row.poId,
      poName: row.name,
      allocatedCents: row.allocatedCents,
      recognizedCents,
      pendingCents,
      blockedCents,
      reconciled,
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

  const scheduledRevenueCents = Number(scheduledTotal);
  if (scheduledRevenueCents !== input.recognition.schedule.totalCents) {
    failures.push(
      `Scheduled revenue ${scheduledRevenueCents} does not equal the revenue schedule total ${input.recognition.schedule.totalCents}.`,
    );
  }

  const pendingComponents = [...input.recognition.pending, ...external];
  const state = mergeCalculationState(
    input.recognition.state,
    failures.length > 0 ? "blocked" : "complete",
    externalPendingCents > 0 ? "pending" : "complete",
  );

  return {
    state,
    transactionPriceCents: input.transactionPriceCents,
    allocatedCents: Number(allocatedTotal),
    scheduledRevenueCents,
    pendingCents: Number(pendingTotal) + externalPendingCents,
    blockedCents: Number(blockedTotal),
    byPo,
    pending: pendingComponents,
    reconciled: failures.length === 0,
    failures,
  };
}
