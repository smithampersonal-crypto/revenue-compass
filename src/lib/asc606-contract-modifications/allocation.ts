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

import type {
  ContractModificationInput,
  ModificationAllocationBasis,
  ModifiedPerformanceObligationInput,
} from "./types";

/**
 * Consideration available to the post-modification allocation.
 *
 * - total basis (25-13(b) and Mixed Policy A): the updated TOTAL transaction
 *   price for the whole lifecycle.
 * - remaining basis (25-13(a) and Mixed Policy B): original transaction price
 *   less revenue already recognized, plus the signed change in consideration.
 */
export function modificationPoolCents(
  input: ContractModificationInput,
  usesTotalBasis: boolean,
  historicalRevenueCents: Cents,
): Cents {
  const change = input.modification.considerationChangeCents;
  return usesTotalBasis
    ? input.originalTransactionPriceCents + change
    : input.originalTransactionPriceCents - historicalRevenueCents + change;
}

/** Which SSP concept the derived branch requires. Never substituted. */
export function sspForBasis(
  po: ModifiedPerformanceObligationInput,
  basis: ModificationAllocationBasis,
): Cents {
  return basis === "total_modified_ssp" ? po.totalModifiedSspCents : po.remainingSspCents;
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
