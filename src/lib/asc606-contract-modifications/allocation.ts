/**
 * Phase 5C allocation — modification-specific transaction-price POOLS only.
 *
 * The pool arithmetic (what consideration is available to allocate after a
 * modification) is genuinely modification-specific. The ALLOCATION itself is
 * always performed by the existing authoritative relative-SSP engine
 * `allocateTransactionPrice()`; no residual or largest-remainder logic is
 * reproduced here.
 */

import { allocateTransactionPrice, type AllocationRow, type Cents } from "@/lib/asc606";

import {
  ContractModificationError,
  type ModificationAllocationBasis,
  type ModifiedPerformanceObligationInput,
} from "./types";

/**
 * Consideration available to the post-modification allocation.
 *
 * - total basis (25-13(b) and the updated-total mixed policy): the updated
 *   TOTAL transaction price for the whole lifecycle.
 * - remaining basis (25-13(a) and the updated-remaining mixed policy): original
 *   transaction price less revenue already recognized, plus the signed change.
 */
export function modificationPoolCents(
  originalTransactionPriceCents: Cents,
  considerationChangeCents: Cents,
  usesTotalBasis: boolean,
  historicalRevenueCents: Cents,
): Cents {
  return usesTotalBasis
    ? originalTransactionPriceCents + considerationChangeCents
    : originalTransactionPriceCents - historicalRevenueCents + considerationChangeCents;
}

/**
 * Which SSP concept the derived branch requires. Never substituted: when the
 * branch-specific standalone selling price is absent, allocation is impossible
 * and the engine refuses rather than falling back to the other measure.
 */
export function sspForBasis(
  po: ModifiedPerformanceObligationInput,
  basis: ModificationAllocationBasis,
): Cents {
  const value = basis === "total_modified_ssp" ? po.totalModifiedSspCents : po.remainingSspCents;
  if (value === null || value === undefined) {
    throw new ContractModificationError(
      `the standalone selling price required by the derived treatment is missing for "${po.name}"`,
    );
  }
  return value;
}

/** Accountant evidence supporting the SSPs used by the derived branch. */
export function sspBasisFor(
  po: ModifiedPerformanceObligationInput,
  basis: ModificationAllocationBasis,
): string | null {
  const value =
    basis === "total_modified_ssp" ? po.totalModifiedSspBasis : po.remainingSspBasis;
  return value && value.trim() !== "" ? value : null;
}

/** Relative-SSP allocation of a modification pool via the existing engine. */
export function allocateModificationPool(
  poolCents: Cents,
  pos: readonly ModifiedPerformanceObligationInput[],
  basis: ModificationAllocationBasis,
): AllocationRow[] {
  return allocateTransactionPrice({
    transactionPriceCents: poolCents,
    performanceObligations: pos.map((po) => ({
      id: po.id,
      seq: po.seq,
      name: po.name,
      sspCents: sspForBasis(po, basis),
    })),
  });
}
