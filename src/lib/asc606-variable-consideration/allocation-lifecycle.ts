/**
 * Accepted Phase 5B CHRONOLOGICAL ALLOCATION-STATE AUTHORITY.
 *
 * Extracted verbatim from `analyzeVariableConsideration()` so the Phase 5B
 * engine and the Phase 9G-R3 progressive engine consume one deterministic
 * implementation and cannot disagree.
 *
 * The rule, unchanged:
 *
 *   1. the general relative-SSP pool must be nonnegative at inception;
 *   2. every performance-obligation allocation must be nonnegative at
 *      inception;
 *   3. the general pool must remain nonnegative after EVERY dated
 *      remeasurement or resolution;
 *   4. every performance-obligation allocation must remain nonnegative after
 *      EVERY dated remeasurement or resolution.
 *
 * A later favorable change never repairs an earlier invalid state: the plan is
 * evaluated in effective-date order and fails at the first invalid state.
 *
 * Pure: no React, DOM, network, database or AI dependency, no mutable global
 * state, integer cents throughout.
 */

import {
  bigIntToCents,
  type AllocatablePerformanceObligation,
  type AllocationRow,
  type Cents,
} from "@/lib/asc606";

import {
  allocateSignedAmount,
  applyAllocationChanges,
  buildInceptionAllocation,
  type SpecificAllocationInput,
} from "./allocation";
import { VariableConsiderationError } from "./types";

/** One accepted, measured dated change awaiting allocation. */
export interface LifecycleDatedChange {
  /** Stable identity; also the deterministic tie-breaker for equal dates. */
  id: string;
  componentId: string;
  assessmentId: string;
  effectiveDate: string;
  /** The obligation a specific-PO change belongs to; null = general basis. */
  targetPoId: string | null;
  /** Signed transaction-price change on this date. */
  changeCents: Cents;
  isResolution: boolean;
}

export interface AllocationLifecycleInput {
  /** Fixed consideration plus generally-allocated included VC at inception. */
  generalPoolCents: Cents;
  allocatables: readonly AllocatablePerformanceObligation[];
  /** Specific-PO included amounts AT INCEPTION, signed. */
  specific: readonly SpecificAllocationInput[];
  changes: readonly LifecycleDatedChange[];
}

/** A blocking allocation-state failure, carrying the accepted Phase 5B text. */
export interface AllocationLifecycleFailure {
  /** "vc.allocation.general_pool.nonnegative" | "vc.allocation.po.nonnegative" */
  id: string;
  message: string;
}

export interface PlannedAllocationChange {
  change: LifecycleDatedChange;
  allocationByPo: { poId: string; amountCents: Cents }[];
}

export type AllocationLifecyclePlan =
  | {
      ok: true;
      base: AllocationRow[];
      inceptionFinal: { poId: string; name: string; amountCents: Cents }[];
      plannedChanges: PlannedAllocationChange[];
      /** Allocation state after every dated change, in chronological order. */
      currentFinal: { poId: string; name: string; amountCents: Cents }[];
    }
  | { ok: false; failures: AllocationLifecycleFailure[] };

const GENERAL_POOL_INCEPTION_MESSAGE =
  "The consideration allocated on a relative standalone-selling-price basis cannot be negative. Review the variable-consideration amounts and their allocation treatment.";

function sortChanges(changes: readonly LifecycleDatedChange[]): LifecycleDatedChange[] {
  return [...changes].sort(
    (a, b) =>
      (a.effectiveDate < b.effectiveDate ? -1 : a.effectiveDate > b.effectiveDate ? 1 : 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/**
 * Plans and validates the whole chronological allocation lifecycle.
 * Returns either every valid allocation state, or the accepted blocking
 * reasons. Never throws for an accounting condition.
 */
export function planAllocationLifecycle(
  input: AllocationLifecycleInput,
): AllocationLifecyclePlan {
  const failures: AllocationLifecycleFailure[] = [];

  if (input.generalPoolCents < 0) {
    return {
      ok: false,
      failures: [
        { id: "vc.allocation.general_pool.nonnegative", message: GENERAL_POOL_INCEPTION_MESSAGE },
      ],
    };
  }

  let base: AllocationRow[];
  let inceptionFinal: { poId: string; name: string; amountCents: Cents }[];
  try {
    const built = buildInceptionAllocation({
      generalPoolCents: input.generalPoolCents,
      allocatables: input.allocatables,
      specific: input.specific,
    });
    base = built.base;
    inceptionFinal = built.inceptionFinal;
  } catch (error) {
    if (error instanceof VariableConsiderationError) {
      return { ok: false, failures: [{ id: "vc.allocation.input", message: error.message }] };
    }
    throw error;
  }

  const negativeInception = inceptionFinal.filter((row) => row.amountCents < 0);
  if (negativeInception.length > 0) {
    for (const row of negativeInception) {
      failures.push({
        id: "vc.allocation.po.nonnegative",
        message: `The amount allocated to "${row.name}" at inception is negative. A performance obligation cannot carry a negative allocation; review the variable consideration allocated specifically to it.`,
      });
    }
    return { ok: false, failures };
  }

  const plannedChanges: PlannedAllocationChange[] = sortChanges(input.changes).map((change) => ({
    change,
    allocationByPo: (change.targetPoId === null
      ? allocateSignedAmount(change.changeCents, input.allocatables)
      : [{ poId: change.targetPoId, amountCents: change.changeCents }]
    ).filter((row) => row.amountCents !== 0 || change.changeCents === 0),
  }));

  let runningGeneralPool = BigInt(input.generalPoolCents);
  let intermediate = inceptionFinal;
  for (const planned of plannedChanges) {
    if (planned.change.targetPoId === null) {
      runningGeneralPool += BigInt(planned.change.changeCents);
      if (runningGeneralPool < 0n) {
        return {
          ok: false,
          failures: [
            {
              id: "vc.allocation.general_pool.nonnegative",
              message: `The consideration allocated on a relative standalone-selling-price basis becomes negative on ${planned.change.effectiveDate}. Review the variable-consideration amounts and their allocation treatment.`,
            },
          ],
        };
      }
    }
    try {
      intermediate = applyAllocationChanges(intermediate, planned.allocationByPo);
    } catch (error) {
      if (error instanceof VariableConsiderationError) {
        return { ok: false, failures: [{ id: "vc.allocation.input", message: error.message }] };
      }
      throw error;
    }
    for (const row of intermediate) {
      if (row.amountCents < 0) {
        failures.push({
          id: "vc.allocation.po.nonnegative",
          message: `The amount allocated to "${row.name}" becomes negative on ${planned.change.effectiveDate}. A performance obligation cannot carry a negative allocation; review the change in variable consideration allocated specifically to it.`,
        });
      }
    }
    if (failures.length > 0) return { ok: false, failures };
  }

  // Defense in depth: the total of the final states must equal the inception
  // total plus every change, so no plan can silently lose an amount.
  let expected = 0n;
  for (const row of inceptionFinal) expected += BigInt(row.amountCents);
  for (const planned of plannedChanges) {
    for (const row of planned.allocationByPo) expected += BigInt(row.amountCents);
  }
  let actual = 0n;
  for (const row of intermediate) actual += BigInt(row.amountCents);
  if (expected !== actual) {
    throw new VariableConsiderationError(
      `allocation lifecycle invariant violated: ${bigIntToCents(actual, "allocation total")} != ${bigIntToCents(expected, "expected allocation total")}`,
    );
  }

  return { ok: true, base, inceptionFinal, plannedChanges, currentFinal: intermediate };
}
