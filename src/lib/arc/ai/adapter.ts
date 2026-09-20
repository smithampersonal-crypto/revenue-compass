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
  | {
      supported: true;
      method: RecognitionMethod;
      overTimeMeasure?: "time_based" | "input_measure";
    }
  | { supported: false; reason: "engine_support_gap" | "unknown" };

/**
 * `recognitionMethod` is the canonical TOP-LEVEL over-time / point-in-time
 * classification; `overTimeMeasure` carries the measurement policy underneath
 * it. Under R3 the deterministic engine measures progress either by time or by
 * inputs incurred, so `input_method` is a supported treatment: it maps to the
 * over-time classification WITH an input measure, which the R3 adapter turns
 * into `over_time_input_measure`. It is never ratable recognition in disguise.
 * `output_method` has no deterministic measure yet and stays fail-closed
 * unsupported; `unknown` stays unknown.
 */
export function mapRecognitionMethod(
  method:
    "ratable_over_time" | "input_method" | "output_method" | "point_in_time_transfer" | "unknown",
): RecognitionMapping {
  if (method === "ratable_over_time") {
    return { supported: true, method: "over_time_ratable", overTimeMeasure: "time_based" };
  }
  if (method === "input_method") {
    return { supported: true, method: "over_time_ratable", overTimeMeasure: "input_measure" };
  }
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

/**
 * The full-term fixed consideration implied by the contract's own billing
 * schedule.
 *
 * A stated periodic fee is not the transaction price: a $245,000 annual fee on
 * a two-year term is $490,000 of fixed consideration. ARC derives that total
 * itself rather than accepting a periodic amount as the contract total, and
 * only from a schedule whose calendar is completely determined:
 *
 * - exactly one fixed (advance/arrears) billing term with a usable amount;
 * - a supported recurring or one-time frequency;
 * - an unambiguous canonical service period.
 *
 * Anything else — milestone or usage billing, two independently schedulable
 * fixed terms, a missing period, a term that is not a whole number of billing
 * periods — returns a refusal, never a guess.
 */
export type FixedBillingTotalResult =
  | {
      ok: true;
      totalInput: string;
      amountInput: string;
      frequency: BillingFrequency;
      eventCount: number;
    }
  | {
      ok: false;
      reason:
        | "no_service_period"
        | "no_unambiguous_fixed_schedule"
        | "multiple_fixed_schedules"
        | "schedule_not_derivable";
    };

export interface FixedBillingTermInput {
  billingTiming: "advance" | "arrears" | "milestone" | "on_usage" | "unknown";
  frequency: BillingFrequency;
  amountOrRateInput: string | null;
}

export function deriveUnambiguousFixedBillingTotal(args: {
  billingTerms: readonly FixedBillingTermInput[];
  servicePeriod: { start: IsoDate; end: IsoDate } | null;
}): FixedBillingTotalResult {
  const fixedTerms = args.billingTerms.filter(
    (term) =>
      (term.billingTiming === "advance" || term.billingTiming === "arrears") &&
      usableAmount(term.amountOrRateInput) !== null,
  );
  if (fixedTerms.length === 0) return { ok: false, reason: "no_unambiguous_fixed_schedule" };
  if (fixedTerms.length > 1) return { ok: false, reason: "multiple_fixed_schedules" };
  if (args.servicePeriod === null) return { ok: false, reason: "no_service_period" };

  const term = fixedTerms[0]!;
  const schedule = deriveBillingSchedule({
    billingTiming: term.billingTiming,
    frequency: term.frequency,
    amountOrRateInput: term.amountOrRateInput,
    serviceStart: args.servicePeriod.start,
    serviceEnd: args.servicePeriod.end,
  });
  if (!schedule.ok) return { ok: false, reason: "schedule_not_derivable" };

  // Exact integer-cent arithmetic only; never floating point money.
  let cents = 0n;
  for (const event of schedule.events) {
    const parsed = exactCents(event.amountInput);
    if (parsed === null) return { ok: false, reason: "schedule_not_derivable" };
    cents += parsed;
  }
  return {
    ok: true,
    totalInput: formatCents(cents),
    amountInput: usableAmount(term.amountOrRateInput)!,
    frequency: term.frequency,
    eventCount: schedule.events.length,
  };
}

/** Exact cents for a bare decimal string, or null when it is not exact cents. */
export function exactCents(value: string): bigint | null {
  if (!DECIMAL_INPUT_PATTERN.test(value.trim())) return null;
  const [whole, fraction = ""] = value.trim().split(".") as [string, string?];
  if (fraction.length > 2 && /[1-9]/.test(fraction.slice(2))) return null;
  const negative = whole.startsWith("-");
  const digits = negative ? whole.slice(1) : whole;
  const cents = BigInt(digits) * 100n + BigInt((fraction + "00").slice(0, 2));
  return negative ? -cents : cents;
}

function formatCents(cents: bigint): string {
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  const text = `${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
  return negative ? `-${text}` : text;
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
