/**
 * ASC 606 deterministic engine — Phase 1 public surface.
 *
 * Phase 1 covers Step 4 (relative SSP allocation) and Step 5 (revenue
 * recognition). Contract balances, consideration events, journal entries and
 * the full validation suite belong to later phases, so no complete
 * `analyzeContract()` orchestrator exists yet.
 */

export * from "./types";
export * from "./money";
export * from "./dates";
export * from "./allocation";
export * from "./recognition";
export * from "./validation";

import { allocateTransactionPrice, AllocationError } from "./allocation";
import { generateRevenueSchedule, RecognitionError } from "./recognition";
import type { Phase1Analysis, Phase1ContractInput } from "./types";
import { validatePhase1 } from "./validation";

/**
 * Phase 1 orchestration: validate, allocate, then schedule revenue.
 * Returns null outputs when a blocking validation failure exists — invalid
 * inputs must never produce a schedule.
 */
export function analyzePhase1(input: Phase1ContractInput): Phase1Analysis {
  const validation = validatePhase1(input);

  if (validation.blockingFailures.length > 0) {
    return {
      validation,
      allocation: null,
      revenueSchedule: null,
      totals: {
        transactionPriceCents: input.transactionPriceCents,
        allocatedCents: null,
        revenueCents: null,
      },
      reconciliation: {
        allocationDifferenceCents: null,
        revenueDifferenceCents: null,
        reconciled: null,
      },
    };
  }

  const allocation = allocateTransactionPrice({
    transactionPriceCents: input.transactionPriceCents,
    performanceObligations: input.performanceObligations,
  });

  const allocationById = new Map(allocation.map((row) => [row.poId, row.allocatedCents]));
  const revenueSchedule = generateRevenueSchedule(
    input.performanceObligations.map((po) => ({
      po,
      allocatedCents: allocationById.get(po.id) ?? 0,
    })),
  );

  const allocatedCents = allocation.reduce((total, row) => total + row.allocatedCents, 0);

  // Defense in depth: a valid analysis may never be returned unreconciled.
  if (allocatedCents !== input.transactionPriceCents) {
    throw new AllocationError(
      `allocation invariant violated: allocated ${allocatedCents} != transaction price ${input.transactionPriceCents}`,
    );
  }
  if (revenueSchedule.totalCents !== allocatedCents) {
    throw new RecognitionError(
      `recognition invariant violated: revenue ${revenueSchedule.totalCents} != allocated ${allocatedCents}`,
    );
  }

  return {
    validation,
    allocation,
    revenueSchedule,
    totals: {
      transactionPriceCents: input.transactionPriceCents,
      allocatedCents,
      revenueCents: revenueSchedule.totalCents,
    },
    reconciliation: {
      allocationDifferenceCents: input.transactionPriceCents - allocatedCents,
      revenueDifferenceCents: allocatedCents - revenueSchedule.totalCents,
      reconciled:
        input.transactionPriceCents === allocatedCents &&
        allocatedCents === revenueSchedule.totalCents,
    },
  };
}
