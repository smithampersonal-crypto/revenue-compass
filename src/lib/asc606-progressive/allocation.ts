/**
 * Phase 9G-R3 — Step 4 allocation with provisional standalone selling prices.
 *
 * A provisional SSP is a REVIEW state, not a missing fact. When every SSP is
 * numerically usable the deterministic relative-SSP allocation runs exactly as
 * before and the allocation table is available immediately; the provisional
 * SSPs are reported as notes so review and finalization rules still apply.
 *
 * Allocation is hard-blocked only when an SSP required for the denominator is
 * genuinely unusable: absent, nonnumeric, zero or negative.
 *
 * This module never re-implements allocation arithmetic — the approved Phase 1
 * engine remains the only implementation.
 */

import {
  allocateTransactionPrice,
  isValidCents,
  type AllocatablePerformanceObligation,
  type AllocationRow,
  type Cents,
} from "@/lib/asc606";

import {
  mergeCalculationState,
  type BlockedComponent,
  type ProgressiveResult,
  type ProvisionalNote,
} from "./types";

/** Whether the accountant has confirmed the SSP, or it is still provisional. */
export type SspConfidence = "confirmed" | "provisional";

export interface ProvisionalAllocatablePo extends AllocatablePerformanceObligation {
  /** Defaults to "confirmed" so existing callers are unaffected. */
  sspConfidence?: SspConfidence;
}

export interface ProgressiveAllocationInput {
  transactionPriceCents: Cents;
  performanceObligations: readonly ProvisionalAllocatablePo[];
}

export type ProgressiveAllocation = ProgressiveResult<AllocationRow[]>;

function usableSsp(po: ProvisionalAllocatablePo): boolean {
  return isValidCents(po.sspCents) && po.sspCents > 0;
}

/**
 * Allocates the transaction price, tolerating provisional SSP review state.
 *
 * Result states:
 *   complete    — allocation ran and every SSP is confirmed
 *   provisional — allocation ran and at least one SSP awaits confirmation
 *   blocked     — at least one SSP is unusable, so the denominator is unknown
 */
export function allocateProgressively(
  input: ProgressiveAllocationInput,
): ProgressiveAllocation {
  const pos = [...input.performanceObligations].sort((a, b) => a.seq - b.seq);

  const blocked: BlockedComponent[] = pos
    .filter((po) => !usableSsp(po))
    .map((po) => ({
      poId: po.id,
      poName: po.name,
      amountCents: 0,
      code: "allocation.ssp.unusable",
      message: `A standalone selling price greater than zero is required for "${po.name}" before the transaction price can be allocated.`,
    }));

  if (pos.length === 0) {
    return {
      state: "blocked",
      value: null,
      provisional: [],
      pending: [],
      blocked: [
        {
          poId: "",
          poName: "",
          amountCents: 0,
          code: "allocation.performance_obligations.absent",
          message: "At least one performance obligation is required before allocation.",
        },
      ],
    };
  }

  if (blocked.length > 0) {
    return { state: "blocked", value: null, provisional: [], pending: [], blocked };
  }

  // Every SSP is usable: the deterministic allocation runs now. A provisional
  // SSP must never also raise a hard "missing SSP" calculation error — that is
  // the duplicated intervention R3 removes.
  const provisional: ProvisionalNote[] = pos
    .filter((po) => po.sspConfidence === "provisional")
    .map((po) => ({
      poId: po.id,
      poName: po.name,
      reason: "provisional_ssp_confirmation" as const,
      message: `The standalone selling price used for "${po.name}" is provisional and still requires confirmation.`,
    }));

  let rows: AllocationRow[];
  try {
    rows = allocateTransactionPrice({
      transactionPriceCents: input.transactionPriceCents,
      performanceObligations: pos.map((po) => ({
        id: po.id,
        seq: po.seq,
        name: po.name,
        sspCents: po.sspCents,
      })),
    });
  } catch (error) {
    return {
      state: "blocked",
      value: null,
      provisional,
      pending: [],
      blocked: [
        {
          poId: "",
          poName: "",
          amountCents: 0,
          code: "allocation.engine",
          message: (error as Error).message,
        },
      ],
    };
  }

  return {
    state: mergeCalculationState(provisional.length > 0 ? "provisional" : "complete"),
    value: rows,
    provisional,
    pending: [],
    blocked: [],
  };
}
