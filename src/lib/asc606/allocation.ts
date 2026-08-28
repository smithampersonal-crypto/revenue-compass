/**
 * ASC 606 Step 4 — allocation of the transaction price on a relative
 * standalone-selling-price basis, using the largest-fractional-remainder
 * method with exact integer (BigInt) arithmetic.
 *
 * Invariant: sum(allocatedCents) === transactionPriceCents.
 */

import { assertNonNegativeCents, bigIntToCents, MoneyError } from "./money";
import type { AllocationRow, Cents, PerformanceObligationInput } from "./types";

export class AllocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AllocationError";
  }
}

export interface AllocationInput {
  transactionPriceCents: Cents;
  performanceObligations: readonly PerformanceObligationInput[];
}

/**
 * Allocates the transaction price across performance obligations.
 *
 * Method:
 *  1. numerator_i = transactionPrice * ssp_i   (BigInt, exact)
 *  2. floor_i     = numerator_i / totalSsp     (integer division; never exceeds
 *                                               the exact entitlement)
 *     remainder_i = numerator_i % totalSsp
 *  3. residual    = transactionPrice - sum(floor_i)
 *  4. residual cents are handed out one at a time in descending remainder
 *     order; ties broken by the lowest PO sequence number.
 *
 * Rows are always returned in ascending `seq` order, so the input array order
 * cannot change the result.
 */
export function allocateTransactionPrice(input: AllocationInput): AllocationRow[] {
  const { transactionPriceCents, performanceObligations } = input;
  assertNonNegativeCents(transactionPriceCents, "transaction price");

  if (performanceObligations.length === 0) {
    throw new AllocationError("at least one performance obligation is required");
  }

  const pos = [...performanceObligations].sort((a, b) => a.seq - b.seq);

  const seenSeq = new Set<number>();
  for (const po of pos) {
    if (!Number.isInteger(po.seq)) {
      throw new AllocationError(`performance obligation "${po.id}" has a non-integer sequence`);
    }
    if (seenSeq.has(po.seq)) {
      throw new AllocationError(`duplicate performance obligation sequence ${po.seq}`);
    }
    seenSeq.add(po.seq);
    try {
      assertNonNegativeCents(po.sspCents, `SSP for "${po.name}"`);
    } catch (error) {
      throw new AllocationError((error as MoneyError).message);
    }
  }

  const totalSspBig = pos.reduce((total, po) => total + BigInt(po.sspCents), 0n);
  if (totalSspBig <= 0n) {
    throw new AllocationError("total standalone selling price must be greater than zero");
  }
  const totalSspCents = bigIntToCents(totalSspBig, "total SSP");

  const priceBig = BigInt(transactionPriceCents);

  const working = pos.map((po, index) => {
    const numerator = priceBig * BigInt(po.sspCents);
    return {
      po,
      index,
      floor: numerator / totalSspBig,
      remainder: numerator % totalSspBig,
      extra: 0n,
    };
  });

  const flooredTotal = working.reduce((total, row) => total + row.floor, 0n);
  let residual = priceBig - flooredTotal;
  if (residual < 0n) {
    throw new AllocationError("allocation floors exceeded the transaction price");
  }

  const priority = [...working].sort((a, b) => {
    if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
    return a.po.seq - b.po.seq; // deterministic tie-breaker: lowest sequence first
  });

  let cursor = 0;
  while (residual > 0n && priority.length > 0) {
    priority[cursor % priority.length]!.extra += 1n;
    residual -= 1n;
    cursor += 1;
  }

  const rows: AllocationRow[] = working.map((row) => {
    const allocatedCents = bigIntToCents(row.floor + row.extra, `allocation for "${row.po.name}"`);
    return {
      poId: row.po.id,
      seq: row.po.seq,
      name: row.po.name,
      sspCents: row.po.sspCents,
      totalSspCents,
      // Display only — derived after the fact, never used to compute money.
      relativeSspPercent: (row.po.sspCents / totalSspCents) * 100,
      allocatedCents,
      explanation: {
        template: "allocation_relative_ssp",
        inputs: {
          transactionPriceCents,
          sspCents: row.po.sspCents,
          totalSspCents,
          allocatedCents,
        },
      },
    };
  });

  const allocatedTotal = rows.reduce((total, row) => total + row.allocatedCents, 0);
  if (allocatedTotal !== transactionPriceCents) {
    throw new AllocationError(
      `allocation invariant violated: allocated ${allocatedTotal} != transaction price ${transactionPriceCents}`,
    );
  }

  return rows;
}
