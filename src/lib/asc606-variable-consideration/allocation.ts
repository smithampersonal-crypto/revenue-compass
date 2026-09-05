/**
 * Layered Phase 5B allocation.
 *
 * The approved relative-SSP engine is reused, never rewritten:
 *
 *  1. Base / general layer: the general pool
 *       fixed consideration + included estimated VC allocated on a general
 *       basis
 *     is allocated across the eligible performance obligations using the
 *     existing largest-remainder relative-SSP allocation.
 *  2. Specific layer: each component allocated to a specific performance
 *     obligation (the allocation exception) is added in full to that PO.
 *  3. Final layer: base + specific, and later + every dated change.
 *
 * A signed dated change allocated on a general basis is allocated by
 * magnitude using the same original SSP basis, and the sign is reapplied
 * afterwards, so the change reconciles exactly to the transaction-price
 * movement.
 */

import {
  allocateTransactionPrice,
  bigIntToCents,
  type AllocatablePerformanceObligation,
  type AllocationRow,
  type Cents,
} from "@/lib/asc606";
import { VariableConsiderationError, type VcAllocationLayers } from "./types";

export interface SpecificAllocationInput {
  componentId: string;
  description: string;
  poId: string;
  /** Signed. */
  amountCents: Cents;
}

export interface InceptionAllocationInput {
  /** Fixed consideration + generally-allocated included estimated VC. */
  generalPoolCents: Cents;
  allocatables: readonly AllocatablePerformanceObligation[];
  specific: readonly SpecificAllocationInput[];
}

/** Allocates one signed amount on the original relative-SSP basis. */
export function allocateSignedAmount(
  amountCents: Cents,
  allocatables: readonly AllocatablePerformanceObligation[],
): { poId: string; amountCents: Cents }[] {
  if (amountCents === 0) {
    return allocatables.map((po) => ({ poId: po.id, amountCents: 0 }));
  }
  const negative = amountCents < 0;
  const rows = allocateTransactionPrice({
    transactionPriceCents: Math.abs(amountCents),
    performanceObligations: allocatables,
  });
  return rows.map((row) => ({
    poId: row.poId,
    amountCents: negative ? -row.allocatedCents : row.allocatedCents,
  }));
}

export function buildInceptionAllocation(input: InceptionAllocationInput): {
  base: AllocationRow[];
  inceptionFinal: { poId: string; name: string; amountCents: Cents }[];
} {
  if (input.allocatables.length === 0) {
    throw new VariableConsiderationError("at least one performance obligation is required");
  }
  const base = allocateTransactionPrice({
    transactionPriceCents: input.generalPoolCents,
    performanceObligations: input.allocatables,
  });

  const byPo = new Map<string, bigint>(base.map((row) => [row.poId, BigInt(row.allocatedCents)]));
  for (const specific of input.specific) {
    if (!byPo.has(specific.poId)) {
      throw new VariableConsiderationError(
        `specific variable consideration targets unknown performance obligation "${specific.poId}"`,
      );
    }
    byPo.set(specific.poId, byPo.get(specific.poId)! + BigInt(specific.amountCents));
  }

  const inceptionFinal = base.map((row) => ({
    poId: row.poId,
    name: row.name,
    amountCents: bigIntToCents(byPo.get(row.poId)!, `allocation for "${row.name}"`),
  }));
  return { base, inceptionFinal };
}

/** Applies dated signed changes to the inception allocation. */
export function applyAllocationChanges(
  inceptionFinal: readonly { poId: string; name: string; amountCents: Cents }[],
  changes: readonly { poId: string; amountCents: Cents }[],
): { poId: string; name: string; amountCents: Cents }[] {
  const byPo = new Map<string, bigint>(
    inceptionFinal.map((row) => [row.poId, BigInt(row.amountCents)]),
  );
  for (const change of changes) {
    if (!byPo.has(change.poId)) {
      throw new VariableConsiderationError(
        `allocation change targets unknown performance obligation "${change.poId}"`,
      );
    }
    byPo.set(change.poId, byPo.get(change.poId)! + BigInt(change.amountCents));
  }
  return inceptionFinal.map((row) => ({
    poId: row.poId,
    name: row.name,
    amountCents: bigIntToCents(byPo.get(row.poId)!, `allocation for "${row.name}"`),
  }));
}

export function allocationLayers(
  base: AllocationRow[],
  specific: readonly SpecificAllocationInput[],
  poNames: ReadonlyMap<string, string>,
  inceptionFinal: { poId: string; name: string; amountCents: Cents }[],
  currentFinal: { poId: string; name: string; amountCents: Cents }[],
): VcAllocationLayers {
  return {
    base,
    specific: specific.map((row) => ({
      componentId: row.componentId,
      description: row.description,
      poId: row.poId,
      poName: poNames.get(row.poId) ?? row.poId,
      amountCents: row.amountCents,
    })),
    inceptionFinal,
    currentFinal,
  };
}
