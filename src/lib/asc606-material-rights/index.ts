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
  bigIntToCents,
  MAX_CENTS,
  type CheckResult,
} from "@/lib/asc606";
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

  // Exact aggregation of the original price plus every exercised option's new
  // consideration. Individually valid amounts whose sum would exceed the
  // supported range are reported as a blocking validation failure, never a
  // silently overflowed number.
  let lifecycleBig = BigInt(
    Number.isSafeInteger(input.transactionPriceCents) ? input.transactionPriceCents : 0,
  );
  let exerciseBig = 0n;
  for (const mr of input.materialRights) {
    if (mr.status === "exercised" && mr.exercise && Number.isSafeInteger(mr.exercise.newConsiderationCents)) {
      exerciseBig += BigInt(mr.exercise.newConsiderationCents);
      lifecycleBig += BigInt(mr.exercise.newConsiderationCents);
    }
  }
  const aggregateOutOfRange = lifecycleBig > BigInt(MAX_CENTS) || exerciseBig > BigInt(MAX_CENTS);
  const rangeCheck: CheckResult = {
    id: "lifecycle.consideration.supported_range",
    category: "contract",
    severity: "blocking",
    passed: !aggregateOutOfRange,

    message: aggregateOutOfRange
      ? "The total lifecycle consideration exceeds the supported monetary range."
      : "Total lifecycle consideration is within the supported monetary range.",
  };
  const validationWithRange = {
    ...validation,
    status: aggregateOutOfRange ? ("attention" as const) : validation.status,
    results: [...validation.results, rangeCheck],
    blockingFailures: aggregateOutOfRange
      ? [...validation.blockingFailures, rangeCheck]
      : validation.blockingFailures,
  };
  const exerciseConsiderationBlocked = aggregateOutOfRange
    ? 0
    : bigIntToCents(exerciseBig, "aggregate exercise consideration");
  const lifecycleConsiderationBlocked = aggregateOutOfRange
    ? input.transactionPriceCents
    : bigIntToCents(lifecycleBig, "lifecycle consideration");

  if (validationWithRange.blockingFailures.length > 0) {
    return {
      validation: validationWithRange,
      allocation: null,
      revenueSchedule: null,
      revenueSources: [],
      materialRights: [],
      totals: {
        originalTransactionPriceCents: input.transactionPriceCents,
        originalAllocatedCents: null,
        exerciseConsiderationCents: exerciseConsiderationBlocked,
        lifecycleConsiderationCents: lifecycleConsiderationBlocked,
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

  const lifecycleConsiderationCents = bigIntToCents(
    BigInt(input.transactionPriceCents) + BigInt(units.exerciseConsiderationCents),
    "lifecycle consideration",
  );
  const scheduledPlusUnscheduledCents = bigIntToCents(
    BigInt(revenueSchedule.totalCents) + BigInt(units.unscheduledCents),
    "scheduled plus unscheduled consideration",
  );

  // Defense in depth: no lifecycle result may be returned unreconciled.
  if (BigInt(scheduledPlusUnscheduledCents) !== BigInt(lifecycleConsiderationCents)) {
    throw new MaterialRightError(
      `lifecycle invariant violated: scheduled + unscheduled ${scheduledPlusUnscheduledCents} != lifecycle consideration ${lifecycleConsiderationCents}`,
    );
  }

  return {
    validation: validationWithRange,
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
