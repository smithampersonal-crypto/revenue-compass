/**
 * Phase 5A material-right / customer-option engine — public surface.
 *
 * Pure TypeScript: no React, DOM, network, database or AI dependency and no
 * mutable global accounting state. A blocking validation failure yields no
 * authoritative allocation, revenue schedule or reconciliation.
 */

export * from "./types";
export * from "./calculation";
export * from "./validation";
export * from "./lifecycle";

import {
  allocateOriginalConsideration,
  buildLifecycleSchedule,
  buildLifecycleUnits,
} from "./lifecycle";
import {
  MaterialRightError,
  type MaterialRightContractInput,
  type MaterialRightLifecycleAnalysis,
} from "./types";
import { validateMaterialRightContract } from "./validation";

export function analyzeMaterialRightLifecycle(
  input: MaterialRightContractInput,
): MaterialRightLifecycleAnalysis {
  const validation = validateMaterialRightContract(input);

  const exerciseConsiderationBlocked = input.materialRights.reduce(
    (total, mr) =>
      mr.status === "exercised" && mr.exercise && Number.isInteger(mr.exercise.newConsiderationCents)
        ? total + mr.exercise.newConsiderationCents
        : total,
    0,
  );

  if (validation.blockingFailures.length > 0) {
    return {
      validation,
      allocation: null,
      revenueSchedule: null,
      revenueSources: [],
      materialRights: [],
      totals: {
        originalTransactionPriceCents: input.transactionPriceCents,
        originalAllocatedCents: null,
        exerciseConsiderationCents: exerciseConsiderationBlocked,
        lifecycleConsiderationCents: input.transactionPriceCents + exerciseConsiderationBlocked,
        scheduledRevenueCents: null,
        unscheduledMaterialRightCents: null,
      },
      reconciliation: {
        scheduledPlusUnscheduledCents: null,
        differenceCents: null,
        reconciled: null,
      },
    };
  }

  const allocation = allocateOriginalConsideration(input);
  const units = buildLifecycleUnits(input, allocation);
  const revenueSchedule = buildLifecycleSchedule(units.scheduleInputs);

  const originalAllocatedCents = allocation.reduce((total, row) => total + row.allocatedCents, 0);
  if (BigInt(originalAllocatedCents) !== BigInt(input.transactionPriceCents)) {
    throw new MaterialRightError(
      `allocation invariant violated: allocated ${originalAllocatedCents} != original transaction price ${input.transactionPriceCents}`,
    );
  }

  const lifecycleConsiderationCents =
    input.transactionPriceCents + units.exerciseConsiderationCents;
  const scheduledPlusUnscheduledCents = revenueSchedule.totalCents + units.unscheduledCents;

  // Defense in depth: no lifecycle result may be returned unreconciled.
  if (BigInt(scheduledPlusUnscheduledCents) !== BigInt(lifecycleConsiderationCents)) {
    throw new MaterialRightError(
      `lifecycle invariant violated: scheduled + unscheduled ${scheduledPlusUnscheduledCents} != lifecycle consideration ${lifecycleConsiderationCents}`,
    );
  }

  return {
    validation,
    allocation,
    revenueSchedule,
    revenueSources: units.revenueSources,
    materialRights: units.outcomes,
    totals: {
      originalTransactionPriceCents: input.transactionPriceCents,
      originalAllocatedCents,
      exerciseConsiderationCents: units.exerciseConsiderationCents,
      lifecycleConsiderationCents,
      scheduledRevenueCents: revenueSchedule.totalCents,
      unscheduledMaterialRightCents: units.unscheduledCents,
    },
    reconciliation: {
      scheduledPlusUnscheduledCents,
      differenceCents: lifecycleConsiderationCents - scheduledPlusUnscheduledCents,
      reconciled: lifecycleConsiderationCents === scheduledPlusUnscheduledCents,
    },
  };
}
