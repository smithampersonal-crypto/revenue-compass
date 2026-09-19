/**
 * Phase 9G-R3 Part 2 — bridge from progressive facts to the ACCEPTED Phase 3
 * contract-balance input.
 *
 * R3 does not own balance or journal mechanics. Contract asset versus contract
 * liability, billed and unbilled receivables, unconditional-right timing,
 * invoice timing, collections, advance billing and revenue reversals all stay
 * with the accepted Phase 3 / Phase 4 engines. This module only translates the
 * progressive facts into their input and marks the contract as PARTIAL when a
 * future operational fact is still unresolved.
 */

import { sumCents, type Cents, type RevenueSchedule } from "@/lib/asc606";
import type { CashCollectionEvent, ContractBalanceInput } from "@/lib/asc606-balances";

import type { ProgressiveBillingEvent } from "./billing";
import { sumSignedPendingCents, type PendingComponent } from "./types";

/** One cash receipt applied to a known billing event. */
export interface ProgressiveCashCollection {
  id: string;
  seq: number;
  billingEventId: string;
  amountCents: Cents;
  collectionDate: string;
}

export interface ProgressiveBalanceFacts {
  billing: readonly ProgressiveBillingEvent[];
  cashCollections?: readonly ProgressiveCashCollection[];
  schedule: RevenueSchedule;
  pending: readonly PendingComponent[];
}

export interface ProgressiveBridge {
  input: ContractBalanceInput;
  /** Signed unresolved consideration: increases less decreases. */
  unresolvedSignedCents: Cents;
  /** True when a future fact means the contract is not yet complete. */
  partial: boolean;
}

export function buildProgressiveBalanceInput(facts: ProgressiveBalanceFacts): ProgressiveBridge {
  const unresolvedSignedCents = sumSignedPendingCents(facts.pending);
  const transactionPriceCents = sumCents([facts.schedule.totalCents, unresolvedSignedCents]);

  const considerationEvents = [...facts.billing]
    .sort((a, b) => a.seq - b.seq)
    .map((event) => ({
      id: event.id,
      seq: event.seq,
      amountCents: event.amountCents,
      unconditionalRightDate: event.date,
      // No invoice fact means the invoice accompanies the unconditional right.
      invoiceDate: event.invoiceDate ?? event.date,
    }));

  const eventIds = new Set(considerationEvents.map((event) => event.id));
  const cashCollections: CashCollectionEvent[] = [...(facts.cashCollections ?? [])]
    .sort((a, b) => a.seq - b.seq)
    .map((collection) => ({
      id: collection.id,
      seq: collection.seq,
      considerationEventId: eventIds.has(collection.billingEventId)
        ? collection.billingEventId
        : `billing:${collection.billingEventId}`,
      amountCents: collection.amountCents,
      collectionDate: collection.collectionDate,
    }));

  const billedTotal = sumCents(considerationEvents.map((event) => event.amountCents));
  const partial = unresolvedSignedCents !== 0 || billedTotal !== transactionPriceCents;

  return {
    input: {
      transactionPriceCents,
      revenueSchedule: facts.schedule,
      considerationEvents,
      cashCollections,
      unscheduledRevenueCents: unresolvedSignedCents,
      ...(partial ? { billingCompleteness: "partial" as const } : {}),
    },
    unresolvedSignedCents,
    partial,
  };
}
