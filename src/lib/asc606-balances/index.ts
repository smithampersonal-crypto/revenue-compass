/**
 * Phase 3 deterministic contract-balance engine — public surface.
 *
 * Pure TypeScript: no React, DOM, network, database or AI dependency and no
 * mutable global accounting state. A blocking validation failure yields no
 * authoritative billing schedule, rollforward or reconciliation.
 */

export * from "./types";
export * from "./validation";
export * from "./rollforward";

import { buildBillingSchedule, buildMonthlyRollforward } from "./rollforward";
import type { ContractBalanceAnalysis, ContractBalanceInput } from "./types";
import { validateContractBalanceInput } from "./validation";

export function analyzeContractBalances(input: ContractBalanceInput): ContractBalanceAnalysis {
  const validation = validateContractBalanceInput(input);

  let totalEvents = 0n;
  for (const event of input.considerationEvents) {
    if (Number.isInteger(event.amountCents)) totalEvents += BigInt(event.amountCents);
  }
  const totalConsiderationEventsCents = Number(totalEvents);

  if (validation.blockingFailures.length > 0) {
    return {
      validation,
      billingSchedule: null,
      monthly: null,
      reconciliation: {
        transactionPriceCents: input.transactionPriceCents,
        totalConsiderationEventsCents,
        differenceCents: null,
        totalRevenueCents: null,
        reconciled: null,
      },
    };
  }

  const billingSchedule = buildBillingSchedule(input);
  const monthly = buildMonthlyRollforward(input);

  // Defense in depth: the authoritative revenue figure is the ending cumulative
  // revenue actually produced by the rollforward, which must tie to both the
  // declared schedule total and the transaction price.
  const endingCumulativeRevenueCents =
    monthly.length > 0 ? monthly[monthly.length - 1]!.cumulativeRevenueCents : 0;
  if (
    BigInt(endingCumulativeRevenueCents) !== BigInt(input.revenueSchedule.totalCents) ||
    BigInt(endingCumulativeRevenueCents) !== BigInt(input.transactionPriceCents)
  ) {
    throw new ContractBalanceError(
      "revenue integrity invariant violated: ending cumulative revenue does not tie to total revenue and transaction price",
    );
  }
  const totalRevenueCents = endingCumulativeRevenueCents;


  return {
    validation,
    billingSchedule,
    monthly,
    reconciliation: {
      transactionPriceCents: input.transactionPriceCents,
      totalConsiderationEventsCents,
      differenceCents: input.transactionPriceCents - totalConsiderationEventsCents,
      totalRevenueCents,
      reconciled:
        input.transactionPriceCents === totalConsiderationEventsCents &&
        totalConsiderationEventsCents === totalRevenueCents,
    },
  };
}
