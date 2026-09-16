/**
 * Phase 9E — Task 10. Pure semantic → canonical mapping primitives.
 *
 * Every function here is total, deterministic and side-effect free: no
 * database, React, OpenAI, Supabase, network, environment variable, clock or
 * randomness. Nothing here performs ASC 606 arithmetic — allocation, revenue
 * schedules, contract balances and journal entries remain the exclusive
 * responsibility of the existing deterministic engines.
 *
 * The guiding rule throughout: when the strict semantic analysis does not
 * contain enough STRUCTURE to populate a canonical field safely, ARC leaves
 * the field unanswered and raises a review item. It never parses free-form
 * prose to manufacture an accounting input.
 */

import type { IsoDate, RecognitionMethod } from "@/lib/asc606";
import type { Judgment } from "@/lib/asc606-workflow";
import type { VcEffect } from "@/lib/asc606-variable-consideration";

import { DECIMAL_INPUT_PATTERN } from "./schema";

/* ------------------------------------------------------------- primitives */

/** yes / no / unknown → the canonical tri-state judgment. Never guesses. */
export function mapOutcome(outcome: "yes" | "no" | "unknown"): Judgment {
  if (outcome === "yes") return true;
  if (outcome === "no") return false;
  return null;
}

/** A canonical value the accountant has not supplied yet. */
export function isUnclaimedString(value: string | undefined | null): boolean {
  return value === undefined || value === null || value.trim() === "";
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Accepts a strictly formatted ISO calendar date only. A model value such as
 * "November 1, 2026" or "start of the term" is rejected rather than parsed:
 * ARC never infers a date from prose.
 */
export function parseIsoDate(value: string | null | undefined): IsoDate | null {
  if (value === null || value === undefined) return null;
  const text = value.trim();
  if (!ISO_DATE.test(text)) return null;
  const [year, month, day] = text.split("-").map(Number) as [number, number, number];
  if (month < 1 || month > 12) return null;
  const maxDay = daysInMonth(year, month);
  if (day < 1 || day > maxDay) return null;
  return text as IsoDate;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function toUtc(date: IsoDate): number {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day);
}

function fromUtc(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10) as IsoDate;
}

/** Calendar-day arithmetic. Deterministic and timezone-free (UTC only). */
export function addDays(date: IsoDate, days: number): IsoDate {
  return fromUtc(toUtc(date) + days * 86_400_000);
}

/** Calendar-month arithmetic, clamping to the last day of the target month. */
export function addMonths(date: IsoDate, months: number): IsoDate {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const target = month - 1 + months;
  const targetYear = year + Math.floor(target / 12);
  const targetMonth = ((target % 12) + 12) % 12;
  const clamped = Math.min(day, daysInMonth(targetYear, targetMonth + 1));
  return fromUtc(Date.UTC(targetYear, targetMonth, clamped));
}

/** Whole calendar months from `from` to `to`, or null when not exact. */
export function wholeMonthsBetween(from: IsoDate, to: IsoDate): number | null {
  const [fy, fm, fd] = from.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = to.split("-").map(Number) as [number, number, number];
  if (fd !== td) return null;
  const months = (ty - fy) * 12 + (tm - fm);
  return months > 0 && addMonths(from, months) === to ? months : null;
}

/**
 * A decimal amount usable as a canonical money input. The strict schema
 * already constrains the shape; this re-checks it locally because API
 * acceptance is never trust.
 */
export function usableAmount(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = value.trim();
  if (!DECIMAL_INPUT_PATTERN.test(text)) return null;
  if (Number(text) <= 0) return null;
  return text;
}

/* ------------------------------------------------------------- recognition */

export type RecognitionMapping =
  | { supported: true; method: RecognitionMethod }
  | { supported: false; reason: "engine_support_gap" | "unknown" };

/**
 * Only the two recognition methods ARC v1's engine actually executes are
 * mapped. `input_method` and `output_method` are NEVER silently coerced to
 * ratable over-time — that would be ARC inventing an accounting policy.
 */
export function mapRecognitionMethod(
  method:
    "ratable_over_time" | "input_method" | "output_method" | "point_in_time_transfer" | "unknown",
): RecognitionMapping {
  if (method === "ratable_over_time") return { supported: true, method: "over_time_ratable" };
  if (method === "point_in_time_transfer") return { supported: true, method: "point_in_time" };
  if (method === "unknown") return { supported: false, reason: "unknown" };
  return { supported: false, reason: "engine_support_gap" };
}

/* --------------------------------------------------- variable consideration */

/**
 * Only unambiguous economics get a sign. `penalty` and `other` are deliberately
 * absent: their direction depends on who pays whom, which is prose, not
 * structure.
 */
const VC_EFFECT: Partial<
  Record<
    "usage" | "service_credit" | "rebate" | "refund" | "bonus" | "penalty" | "discount" | "other",
    VcEffect
  >
> = {
  usage: "increase",
  bonus: "increase",
  service_credit: "decrease",
  rebate: "decrease",
  refund: "decrease",
  discount: "decrease",
};

export function mapVcEffect(
  type:
    "usage" | "service_credit" | "rebate" | "refund" | "bonus" | "penalty" | "discount" | "other",
): VcEffect | null {
  return VC_EFFECT[type] ?? null;
}

export function mapEstimationMethod(
  proposal: "expected_value" | "most_likely_amount" | "not_estimable" | "unknown",
): "expected_value" | "most_likely_amount" | null {
  return proposal === "expected_value" || proposal === "most_likely_amount" ? proposal : null;
}

/* ----------------------------------------------------------------- billing */

export type BillingFrequency =
  "one_time" | "monthly" | "quarterly" | "semiannual" | "annual" | "on_event" | "unknown";

const MONTHS_PER_PERIOD: Partial<Record<BillingFrequency, number>> = {
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  annual: 12,
};

export interface DerivedBillingEvent {
  /** 1-based position within the derived schedule. Never used as identity. */
  period: number;
  invoiceDate: IsoDate;
  /**
   * The scheduled billing date also establishes the unconditional right for a
   * simple fixed scheduled invoice. ARC never invents a separate legal date.
   */
  unconditionalRightDate: IsoDate;
  amountInput: string;
}

export type BillingScheduleResult =
  | { ok: true; events: DerivedBillingEvent[] }
  | {
      ok: false;
      reason:
        | "unsupported_timing"
        | "unsupported_frequency"
        | "missing_amount"
        | "missing_service_period"
        | "term_not_divisible";
    };

export interface BillingScheduleInput {
  billingTiming: "advance" | "arrears" | "milestone" | "on_usage" | "unknown";
  frequency: BillingFrequency;
  amountOrRateInput: string | null;
  serviceStart: IsoDate | null;
  /** Inclusive last day of service. */
  serviceEnd: IsoDate | null;
}

/**
 * Deterministic recurring billing schedule.
 *
 * Only shapes whose calendar is fully determined by structured fields are
 * derived. Milestone, usage, unknown timing and unknown frequency produce no
 * events at all — the caller raises a review item instead of guessing a date.
 */
export function deriveBillingSchedule(input: BillingScheduleInput): BillingScheduleResult {
  if (input.billingTiming !== "advance" && input.billingTiming !== "arrears") {
    return { ok: false, reason: "unsupported_timing" };
  }
  const amount = usableAmount(input.amountOrRateInput);
  if (amount === null) return { ok: false, reason: "missing_amount" };
  if (input.serviceStart === null || input.serviceEnd === null) {
    return { ok: false, reason: "missing_service_period" };
  }

  // The service period is inclusive of its last day; the exclusive boundary is
  // the day after, which is what calendar-period arithmetic works against.
  const exclusiveEnd = addDays(input.serviceEnd, 1);

  if (input.frequency === "one_time") {
    const invoiceDate = input.billingTiming === "advance" ? input.serviceStart : input.serviceEnd;
    return {
      ok: true,
      events: [
        { period: 1, invoiceDate, unconditionalRightDate: invoiceDate, amountInput: amount },
      ],
    };
  }

  const monthsPerPeriod = MONTHS_PER_PERIOD[input.frequency];
  if (monthsPerPeriod === undefined) return { ok: false, reason: "unsupported_frequency" };

  const totalMonths = wholeMonthsBetween(input.serviceStart, exclusiveEnd);
  if (totalMonths === null || totalMonths % monthsPerPeriod !== 0) {
    return { ok: false, reason: "term_not_divisible" };
  }

  const periods = totalMonths / monthsPerPeriod;
  const events: DerivedBillingEvent[] = [];
  for (let period = 0; period < periods; period += 1) {
    // Advance bills at each period start; arrears at each period end. Neither
    // creates an extra invoice at the service-end boundary.
    const invoiceDate =
      input.billingTiming === "advance"
        ? addMonths(input.serviceStart, period * monthsPerPeriod)
        : addDays(addMonths(input.serviceStart, (period + 1) * monthsPerPeriod), -1);
    events.push({
      period: period + 1,
      invoiceDate,
      unconditionalRightDate: invoiceDate,
      amountInput: amount,
    });
  }
  return { ok: true, events };
}

/* --------------------------------------------------- projected collections */

export type ProjectedCollectionResult =
  | { ok: true; collectionDate: IsoDate }
  | { ok: false; reason: "unsupported_basis" | "missing_payment_terms" };

/**
 * A contract never proves that cash was received. The only collection date ARC
 * will derive is the contractual due date of a scheduled invoice, and the row
 * it produces is always recorded as `projected_contract_due_date`.
 */
export function deriveProjectedCollectionDate(args: {
  invoiceDate: IsoDate;
  contractualDueDateBasis:
    "invoice_date_plus_terms" | "fixed_calendar_date" | "milestone_event" | "unknown";
  paymentTermsDays: number | null;
}): ProjectedCollectionResult {
  if (args.contractualDueDateBasis !== "invoice_date_plus_terms") {
    return { ok: false, reason: "unsupported_basis" };
  }
  if (args.paymentTermsDays === null || args.paymentTermsDays < 0) {
    return { ok: false, reason: "missing_payment_terms" };
  }
  return { ok: true, collectionDate: addDays(args.invoiceDate, args.paymentTermsDays) };
}
