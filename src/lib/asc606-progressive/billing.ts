/**
 * Phase 9G-R3 Part 2, Stage C — progressive billing schedule.
 *
 * Billing readiness is INDEPENDENT of revenue-recognition readiness. Known
 * fixed billing facts produce their schedule even when Step 5 still contains
 * pending future facts.
 *
 * A variable billing event is created only when a real amount actually exists.
 * ARC never fabricates a zero-dollar invoice to satisfy a schedule engine, and
 * a $0 inception estimate never requires a billing event.
 */

import { isValidCents, isValidIsoDate, monthKeyOf, sumCents, type Cents, type IsoDate, type MonthKey } from "@/lib/asc606";

import { mergeCalculationState, type BlockedComponent, type CalculationState } from "./types";
import type { VcSeriesPeriodAllocation } from "./variable-consideration";

export type BillingEventKind = "fixed" | "variable_realized";

export interface FixedBillingFact {
  id: string;
  seq: number;
  amountCents: Cents;
  /** Date the entity obtains an unconditional right to consideration. */
  unconditionalRightDate: IsoDate;
  invoiceDate?: IsoDate;
  /** Payment terms in days, for display and the financing assessment. */
  paymentTermsDays?: number;
  description?: string;
}

export interface ProgressiveBillingEvent {
  /** Stable identity. */
  id: string;
  kind: BillingEventKind;
  seq: number;
  month: MonthKey;
  date: IsoDate;
  amountCents: Cents;
  description: string;
  /** Present for a variable event: the component that produced it. */
  componentId?: string;
}

/** A known contractual billing rule with no billable amount yet. */
export interface PendingBillingRule {
  componentId: string;
  description: string;
  reason: "awaiting_usage_actuals" | "awaiting_variable_consideration_event";
}

export interface ProgressiveBillingSchedule {
  state: CalculationState;
  events: ProgressiveBillingEvent[];
  totalCents: Cents;
  pendingRules: PendingBillingRule[];
  blocked: BlockedComponent[];
}

export interface ProgressiveBillingInput {
  fixed: readonly FixedBillingFact[];
  /** Realized, billable variable amounts. */
  realized: readonly VcSeriesPeriodAllocation[];
  /** Contractual rules that exist but have produced no billable amount yet. */
  pendingRules?: readonly PendingBillingRule[];
}

export function buildProgressiveBillingSchedule(
  input: ProgressiveBillingInput,
): ProgressiveBillingSchedule {
  const blocked: BlockedComponent[] = [];
  const events: ProgressiveBillingEvent[] = [];

  const seen = new Set<string>();
  for (const fact of [...input.fixed].sort((a, b) => a.seq - b.seq)) {
    if (seen.has(fact.id)) {
      blocked.push({
        poId: "",
        poName: fact.description ?? "Billing event",
        amountCents: 0,
        code: "billing.identity.duplicate",
        message: "A billing event is defined more than once.",
      });
      continue;
    }
    seen.add(fact.id);
    if (!isValidCents(fact.amountCents) || !isValidIsoDate(fact.unconditionalRightDate)) {
      blocked.push({
        poId: "",
        poName: fact.description ?? "Billing event",
        amountCents: 0,
        code: "billing.invalid",
        message: "A billing event has an invalid amount or date.",
      });
      continue;
    }
    events.push({
      id: `billing:${fact.id}`,
      kind: "fixed",
      seq: fact.seq,
      month: monthKeyOf(fact.unconditionalRightDate),
      date: fact.unconditionalRightDate,
      amountCents: fact.amountCents,
      description: fact.description ?? "Contractual billing",
    });
  }

  let variableSeq = 1000;
  for (const realized of input.realized) {
    if (!realized.billable || realized.amountCents === 0) continue;
    events.push({
      id: `billing:${realized.id}`,
      kind: "variable_realized",
      seq: variableSeq++,
      month: realized.month,
      date: realized.date,
      amountCents: realized.amountCents,
      description: realized.description,
      componentId: realized.componentId,
    });
  }

  events.sort((a, b) => (a.date === b.date ? a.seq - b.seq : a.date < b.date ? -1 : 1));

  return {
    state: mergeCalculationState(
      blocked.length > 0 ? "blocked" : "complete",
      (input.pendingRules?.length ?? 0) > 0 ? "pending" : "complete",
    ),
    events,
    totalCents: sumCents(events.map((event) => event.amountCents)),
    pendingRules: [...(input.pendingRules ?? [])],
    blocked,
  };
}
