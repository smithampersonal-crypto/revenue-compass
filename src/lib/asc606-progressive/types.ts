/**
 * Phase 9G-R3 — progressive / provisional accounting result model.
 *
 * Central invariant: a missing FUTURE fact, or a fact that is usable but still
 * awaiting accountant confirmation, limits only the output that depends on it.
 * It never suppresses otherwise determinable accounting.
 *
 * Three distinct input categories are modelled explicitly:
 *
 *   A. INVALID accounting input      -> blocked (the dependent calculation
 *                                      cannot be performed faithfully)
 *   B. PROVISIONAL accounting input  -> usable now, review still required
 *   C. PENDING FUTURE fact           -> treatment known, operational fact does
 *                                      not exist yet
 *
 * Only category A blocks a dependent calculation. Categories B and C never
 * blank an unrelated output.
 *
 * Pure data + pure helpers: no React, DOM, network, database or AI dependency
 * and no mutable global state. Money is integer cents everywhere.
 */

import { sumCents, type Cents } from "@/lib/asc606";

/**
 * Readiness of one deterministic calculation.
 *
 *  - complete    every dependent fact is known and confirmed
 *  - provisional every dependent fact is numerically usable, but at least one
 *                is still awaiting accountant confirmation
 *  - pending     the treatment is known and part of the output is calculated,
 *                but an operational future fact does not exist yet
 *  - blocked     an input is invalid, contradictory or required and absent
 */
export type CalculationState = "complete" | "provisional" | "pending" | "blocked";

/** Why an amount or a result is not yet final. */
export type PendingReason =
  | "provisional_ssp_confirmation"
  | "awaiting_transfer_date"
  | "awaiting_progress_actuals"
  | "awaiting_usage_actuals"
  | "awaiting_variable_consideration_event";

export const PENDING_REASON_LABELS: Record<PendingReason, string> = {
  provisional_ssp_confirmation: "Awaiting standalone selling price confirmation",
  awaiting_transfer_date: "Awaiting transfer date",
  awaiting_progress_actuals: "Awaiting hours incurred",
  awaiting_usage_actuals: "Awaiting actual usage",
  awaiting_variable_consideration_event: "Awaiting variable consideration event",
};

/**
 * Allocated consideration that is real, retained and NOT yet scheduled because
 * a future operational fact has not happened. A pending amount is never zero
 * revenue and never disappears.
 *
 * `amountCents` keeps the accepted Part 1 invariant: it is a NONNEGATIVE
 * magnitude. An unresolved amount that will REDUCE the transaction price (for
 * example an unrealized service-level credit) carries `direction: "decrease"`
 * instead of a negative magnitude, so the economic sign is explicit everywhere
 * and is never smuggled into a nonnegative field.
 */
export interface PendingComponent {
  poId: string;
  poName: string;
  amountCents: Cents;
  reason: PendingReason;
  /** Economic direction of the unresolved amount. Absent means "increase". */
  direction?: PendingDirection;
  /** Machine-readable supporting facts; never prose accounting judgment. */
  detail?: Record<string, number | string | boolean>;
}

export type PendingDirection = "increase" | "decrease";

/** The signed value of one pending component: magnitude x direction. */
export function signedPendingCents(component: PendingComponent): Cents {
  return component.direction === "decrease" ? -component.amountCents : component.amountCents;
}

/** An amount whose dependent calculation could not run: category A. */
export interface BlockedComponent {
  poId: string;
  poName: string;
  amountCents: Cents;
  /** Deterministic reason code, for example "input_measure.denominator". */
  code: string;
  message: string;
}

/**
 * A fact that IS being used for calculation but still carries an open review
 * conclusion. Carries no amount of its own: the amount is already calculated.
 */
export interface ProvisionalNote {
  poId: string;
  poName: string;
  reason: PendingReason;
  message: string;
}

export interface ProgressiveResult<T> {
  state: CalculationState;
  /** Null only when the whole calculation is blocked. */
  value: T | null;
  provisional: ProvisionalNote[];
  pending: PendingComponent[];
  blocked: BlockedComponent[];
}

const STATE_RANK: Record<CalculationState, number> = {
  complete: 0,
  provisional: 1,
  pending: 2,
  blocked: 3,
};

/** The least-ready of the supplied states. Deterministic and associative. */
export function mergeCalculationState(...states: readonly CalculationState[]): CalculationState {
  let worst: CalculationState = "complete";
  for (const state of states) {
    if (STATE_RANK[state] > STATE_RANK[worst]) worst = state;
  }
  return worst;
}

/** True when a result may be presented as authoritative-for-its-scope output. */
export function isCalculable(state: CalculationState): boolean {
  return state !== "blocked";
}

/**
 * Both sums route through the canonical `sumCents` helper so every element is
 * asserted to be valid integer cents and the aggregate is range-checked. A
 * BigInt total outside ARC's supported range throws instead of degrading into
 * an imprecise JavaScript number.
 */
export function sumPendingCents(components: readonly PendingComponent[]): Cents {
  return sumCents(components.map((component) => component.amountCents));
}

/** Signed total: unresolved increases less unresolved decreases. */
export function sumSignedPendingCents(components: readonly PendingComponent[]): Cents {
  return sumCents(components.map(signedPendingCents));
}

export function sumBlockedCents(components: readonly BlockedComponent[]): Cents {
  return sumCents(components.map((component) => component.amountCents));
}

export class ProgressiveAccountingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProgressiveAccountingError";
  }
}
