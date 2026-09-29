/**
 * Package 3D-Q — ARC-owned source-evidence consistency check for AI-derived
 * fixed billing schedules.
 *
 * The model's structured billing fields (`amountKind`, `billingTiming`,
 * `frequency`, `amountOrRateInput`) are proposals. Before ARC turns them into
 * canonical invoices, this check proves — from the ARC-materialized citation
 * excerpts only, never from model-written prose — that the source text
 * actually states:
 *
 *   A. a currency-denominated amount equal to the proposed amount, which is
 *      not a percentage, not a generic per-X rate, and not in a sentence about
 *      interest, overdue balances, late fees, penalties or service credits;
 *   B. an invoicing cadence matching the proposed frequency, stated alongside
 *      an invoicing word ("/mo" pricing and "Net 30" never count);
 *   C. billing timing matching the proposed billingTiming.
 *
 * Deliberately small and lexical. Unfamiliar wording fails closed: a false
 * negative only means the accountant enters the invoices manually. This check
 * validates the structured proposal; it never invents timing or cadence.
 *
 * Pure: no I/O, no mutation.
 */

import type { BillingFrequency } from "./adapter";
import { exactCents } from "./adapter";

export type BillingTimingInput = "advance" | "arrears" | "milestone" | "on_usage" | "unknown";

export interface FixedBillingEvidenceInput {
  billingTiming: BillingTimingInput;
  frequency: BillingFrequency;
  amountOrRateInput: string | null;
  citations: readonly { evidenceMode?: string; excerpt?: string | null }[];
}

export type FixedBillingEvidenceRefusal =
  | "no_text_evidence"
  | "no_currency_amount"
  | "rate_like_amount"
  | "no_invoice_cadence"
  | "no_timing_evidence";

export type FixedBillingEvidenceResult =
  { ok: true } | { ok: false; reason: FixedBillingEvidenceRefusal };

/* ---------------------------------------------------------------- lexicon */

/** Recognized time-period suffixes: pricing-basis evidence only, never cadence. */
const PERIOD_UNITS = new Set([
  "mo",
  "mos",
  "month",
  "months",
  "yr",
  "yrs",
  "year",
  "years",
  "annum",
  "quarter",
  "quarters",
  "qtr",
]);

const CURRENCY_AMOUNT =
  /(?:US\$|\$|USD\s*)\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?|(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*(?:USD|US\s+dollars|dollars)\b/gi;

/** Anything that makes an amount a rate rather than an invoice amount. */
const NON_CONSIDERATION_CONTEXT =
  /\b(?:interest|overdue|late\s+(?:fee|fees|charge|charges|payment|payments)|penalt(?:y|ies)|past\s+due|service\s+credits?|liquidated\s+damages)\b/i;

const INVOICING_WORD = /\b(?:invoic(?:e|es|ed|ing)|bill(?:s|ed|ing)?)\b/i;
const INSTALLMENT_WORD = /\binstal(?:l)?ments?\b/i;

const CADENCE: Record<string, RegExp> = {
  monthly: /\bmonthly\b|\b(?:each|every)\s+(?:calendar\s+)?month\b/i,
  quarterly: /\bquarterly\b|\b(?:each|every)\s+(?:calendar\s+)?quarter\b/i,
  semiannual: /\bsemi-?annual(?:ly)?\b|\bhalf-?yearly\b|\bevery\s+six\s+months\b/i,
  annual:
    /(?<!semi-)(?<!semi)\bannual(?:ly)?\b|\byearly\b|\b(?:each|every)\s+(?:contract\s+)?year\b/i,
  one_time:
    /\bsingle\s+invoice\b|\bin\s+full\b|\bone-?time\b|\bupon\s+(?:execution|signature|signing)\b|\bat\s+(?:execution|signing)\b/i,
};

const EXECUTION_PHRASE =
  /\bupon\s+(?:execution|signature|signing)\b|\bat\s+(?:execution|signing)\b/i;
const ADVANCE_PHRASE =
  /\bin\s+advance\b|\badvance\b|\bprior\s+to\b|\bat\s+the\s+(?:start|beginning|commencement)\s+of\b/i;
const ARREARS_PHRASE =
  /\bin\s+arrears\b|\barrears\b|\bat\s+the\s+end\s+of\b|\b(?:following|after)\s+the\s+end\s+of\b/i;

/* ---------------------------------------------------------------- helpers */

function sentencesOf(citations: FixedBillingEvidenceInput["citations"]): string[] {
  const out: string[] = [];
  for (const citation of citations) {
    if (citation.evidenceMode !== undefined && citation.evidenceMode !== "text") continue;
    const text = (citation.excerpt ?? "").replace(/\s+/g, " ").trim();
    if (text.length === 0) continue;
    // Split on sentence punctuation followed by whitespace only, so decimals
    // ("$447,000.00", "1.5%") never split a sentence.
    for (const sentence of text.split(/(?<=[.;!?])\s+/)) {
      const trimmed = sentence.trim();
      if (trimmed.length > 0) out.push(trimmed);
    }
  }
  return out;
}

function matchCents(whole: string, fraction: string | undefined): bigint | null {
  return exactCents(`${whole.replace(/,/g, "")}${fraction === undefined ? "" : `.${fraction}`}`);
}

type AmountVerdict = "match" | "rate_like" | "none";

function amountVerdict(sentence: string, target: bigint): AmountVerdict {
  let sawRateLike = false;
  CURRENCY_AMOUNT.lastIndex = 0;
  for (let found = CURRENCY_AMOUNT.exec(sentence); found; found = CURRENCY_AMOUNT.exec(sentence)) {
    const whole = found[1] ?? found[3];
    const fraction = found[1] !== undefined ? found[2] : found[4];
    if (whole === undefined) continue;
    const cents = matchCents(whole, fraction);
    if (cents === null || cents !== target) continue;

    const after = sentence.slice(found.index + found[0].length);
    if (/^\s*(?:%|percent\b)/i.test(after)) {
      sawRateLike = true;
      continue;
    }
    // Generic per-X / slash-X syntax is rate-like unless X is a recognized
    // time period. A period suffix is pricing-basis evidence only; cadence is
    // still required independently (check B).
    const perUnit = /^\s*(?:USD\s*)?(?:\/\s*|per\s+|each\s+)([a-z][a-z-]*)/i.exec(after);
    if (perUnit !== null && !PERIOD_UNITS.has(perUnit[1]!.toLowerCase().replace(/\.$/, ""))) {
      sawRateLike = true;
      continue;
    }
    if (NON_CONSIDERATION_CONTEXT.test(sentence)) {
      sawRateLike = true;
      continue;
    }
    return "match";
  }
  return sawRateLike ? "rate_like" : "none";
}

function hasCadence(sentence: string, frequency: BillingFrequency): boolean {
  const pattern = CADENCE[frequency];
  if (pattern === undefined) return false;
  if (!INVOICING_WORD.test(sentence)) return false;
  // "installments" with no stated recurring frequency is not a schedule; a
  // one-time trigger phrase never proves a single invoice inside such text.
  if (INSTALLMENT_WORD.test(sentence) && frequency === "one_time") return false;
  return pattern.test(sentence);
}

function hasTiming(
  sentence: string,
  timing: BillingTimingInput,
  frequency: BillingFrequency,
): boolean {
  if (!INVOICING_WORD.test(sentence)) return false;
  if (timing === "advance") {
    if (ADVANCE_PHRASE.test(sentence)) return true;
    // An execution trigger supports an already-proposed one-time advance bill.
    return (
      frequency === "one_time" &&
      EXECUTION_PHRASE.test(sentence) &&
      !INSTALLMENT_WORD.test(sentence)
    );
  }
  if (timing === "arrears") return ARREARS_PHRASE.test(sentence);
  return false;
}

/* ------------------------------------------------------------------ check */

export function checkFixedBillingEvidence(
  input: FixedBillingEvidenceInput,
): FixedBillingEvidenceResult {
  const sentences = sentencesOf(input.citations);
  if (sentences.length === 0) return { ok: false, reason: "no_text_evidence" };

  const target = input.amountOrRateInput === null ? null : exactCents(input.amountOrRateInput);
  if (target === null) return { ok: false, reason: "no_currency_amount" };

  // Cohesion (fail closed): the matching fixed amount, the invoicing cadence
  // and the timing must all be established by ONE sentence. Evidence from
  // unrelated sentences is never composed into a schedule.
  let sawRateLike = false;
  const amountSentences: string[] = [];
  for (const sentence of sentences) {
    const verdict = amountVerdict(sentence, target);
    if (verdict === "match") amountSentences.push(sentence);
    else if (verdict === "rate_like") sawRateLike = true;
  }
  if (amountSentences.length === 0) {
    return { ok: false, reason: sawRateLike ? "rate_like_amount" : "no_currency_amount" };
  }

  const withCadence = amountSentences.filter((sentence) => hasCadence(sentence, input.frequency));
  if (withCadence.length === 0) return { ok: false, reason: "no_invoice_cadence" };
  if (!withCadence.some((sentence) => hasTiming(sentence, input.billingTiming, input.frequency))) {
    return { ok: false, reason: "no_timing_evidence" };
  }
  return { ok: true };
}

/* ------------------------------------------------------- eligibility gate */

/**
 * Positive allowlist: the ONLY review state that permits an AI-derived fixed
 * invoice schedule. `inference` is deliberately excluded — an invoice is a
 * source-evidenced fact, not a judgment. Any other current or future state
 * fails closed.
 */
export const AI_FIXED_SCHEDULE_REVIEW_STATES: readonly string[] = ["supported"];

export type AiFixedScheduleRefusal =
  "amount_not_fixed_invoice" | "billing_term_not_source_supported" | FixedBillingEvidenceRefusal;

export interface AiFixedScheduleTerm extends FixedBillingEvidenceInput {
  /** Absent on legacy v5/v6 results, which are treated as `unknown`. */
  amountKind?: string | null | undefined;
  reviewState: string;
}

/**
 * The deterministic boundary in front of every AI-derived fixed invoice
 * schedule and every billing-derived transaction-price total. Manual billing
 * events never pass through here.
 */
export function aiFixedScheduleEligibility(
  term: AiFixedScheduleTerm,
): { ok: true } | { ok: false; reason: AiFixedScheduleRefusal } {
  if ((term.amountKind ?? "unknown") !== "fixed_invoice_amount") {
    return { ok: false, reason: "amount_not_fixed_invoice" };
  }
  if (!AI_FIXED_SCHEDULE_REVIEW_STATES.includes(term.reviewState)) {
    return { ok: false, reason: "billing_term_not_source_supported" };
  }
  return checkFixedBillingEvidence(term);
}

/* ============================================ Package 3D-Q.1 explicit path */

/**
 * Package 3D-Q.1 — ARC-owned evidence check for a source-stated dated invoice.
 *
 * A separate path from the recurring-schedule check above, which stays
 * unchanged. An explicit invoice needs no cadence and no timing phrase, and
 * its date is never inferred. It is created only when ONE evidence unit of the
 * invoice's OWN text citations states, together:
 *
 *   A. an invoicing word;
 *   B. a currency amount exactly equal to the proposed amount, passing the
 *      same rate / per-unit / interest exclusions as the recurring check;
 *   C. a full calendar date, introduced by "on", "dated" or "as of", that
 *      is exactly the proposed invoice date.
 *
 * Evidence units are never combined. Unfamiliar wording fails closed.
 * Pure: no I/O, no mutation.
 */

export interface ExplicitInvoiceEvidenceInput {
  invoiceDateInput: string;
  amountInput: string | null;
  citations: readonly { evidenceMode?: string; excerpt?: string | null }[];
}

export type ExplicitInvoiceEvidenceRefusal =
  | "invalid_invoice_date"
  | "no_text_evidence"
  | "no_currency_amount"
  | "rate_like_amount"
  | "no_invoicing_language"
  | "no_matching_invoice_date";

export type ExplicitInvoiceEvidenceResult =
  { ok: true } | { ok: false; reason: ExplicitInvoiceEvidenceRefusal };

const MONTHS: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sept: 9,
  sep: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

const MONTH_ABBREVIATION_END = /\b(?:jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.$/i;

/** Valid ISO calendar date, or null. */
export function isoCalendarDate(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return value;
}

function isoOf(year: number, month: number, day: number): string | null {
  return isoCalendarDate(
    `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  );
}

/**
 * Sentences of the invoice's own text citations. Same split as the recurring
 * check, except a month abbreviation ("Jan.") never ends a sentence.
 */
function explicitEvidenceUnits(citations: ExplicitInvoiceEvidenceInput["citations"]): string[] {
  const out: string[] = [];
  for (const citation of citations) {
    if (citation.evidenceMode !== undefined && citation.evidenceMode !== "text") continue;
    const text = (citation.excerpt ?? "").replace(/\s+/g, " ").trim();
    if (text.length === 0) continue;
    const pieces = text.split(/(?<=[.;!?])\s+/);
    let current = "";
    for (const piece of pieces) {
      current = current.length === 0 ? piece : `${current} ${piece}`;
      if (MONTH_ABBREVIATION_END.test(current)) continue;
      const trimmed = current.trim();
      if (trimmed.length > 0) out.push(trimmed);
      current = "";
    }
    if (current.trim().length > 0) out.push(current.trim());
  }
  return out;
}

const DATE_INTRODUCER = /\b(?:on|dated|as\s+of)\s+$/i;
const NAMED_DATE =
  /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)\.?\s+(\d{1,2}),?\s+(\d{4})\b/gi;
const ISO_DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const US_DATE = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g;

/** ISO dates stated in the unit and introduced as an invoice date. */
function introducedDates(unit: string): string[] {
  const out: string[] = [];
  const introduced = (index: number) => DATE_INTRODUCER.test(unit.slice(0, index));
  for (const found of unit.matchAll(NAMED_DATE)) {
    if (!introduced(found.index ?? 0)) continue;
    const month = MONTHS[found[1]!.toLowerCase()];
    const iso = month === undefined ? null : isoOf(Number(found[3]), month, Number(found[2]));
    if (iso !== null) out.push(iso);
  }
  for (const found of unit.matchAll(ISO_DATE)) {
    if (!introduced(found.index ?? 0)) continue;
    const iso = isoOf(Number(found[1]), Number(found[2]), Number(found[3]));
    if (iso !== null) out.push(iso);
  }
  for (const found of unit.matchAll(US_DATE)) {
    if (!introduced(found.index ?? 0)) continue;
    const iso = isoOf(Number(found[3]), Number(found[1]), Number(found[2]));
    if (iso !== null) out.push(iso);
  }
  return out;
}

export function checkExplicitInvoiceEvidence(
  input: ExplicitInvoiceEvidenceInput,
): ExplicitInvoiceEvidenceResult {
  const invoiceDate = isoCalendarDate(input.invoiceDateInput);
  if (invoiceDate === null) return { ok: false, reason: "invalid_invoice_date" };
  const target = input.amountInput === null ? null : exactCents(input.amountInput);
  if (target === null || target <= 0n) return { ok: false, reason: "no_currency_amount" };

  const units = explicitEvidenceUnits(input.citations);
  if (units.length === 0) return { ok: false, reason: "no_text_evidence" };

  let sawRateLike = false;
  let sawAmount = false;
  let sawInvoicing = false;
  for (const unit of units) {
    const verdict = amountVerdict(unit, target);
    if (verdict === "rate_like") sawRateLike = true;
    if (verdict !== "match") continue;
    sawAmount = true;
    if (!INVOICING_WORD.test(unit)) continue;
    sawInvoicing = true;
    if (introducedDates(unit).includes(invoiceDate)) return { ok: true };
  }
  if (!sawAmount)
    return { ok: false, reason: sawRateLike ? "rate_like_amount" : "no_currency_amount" };
  if (!sawInvoicing) return { ok: false, reason: "no_invoicing_language" };
  return { ok: false, reason: "no_matching_invoice_date" };
}

export interface AiExplicitInvoiceTerm {
  amountKind?: string | null | undefined;
  reviewState: string;
  explicitInvoices?:
    | readonly {
        invoiceDateInput: string;
        amountInput: string | null;
        citations: ExplicitInvoiceEvidenceInput["citations"];
      }[]
    | undefined;
}

export interface ExplicitInvoiceEvent {
  period: number;
  invoiceDate: string;
  unconditionalRightDate: string;
  amountInput: string;
}

export type AiExplicitInvoiceRefusal =
  "amount_not_fixed_invoice" | "billing_term_not_source_supported" | ExplicitInvoiceEvidenceRefusal;

/**
 * The deterministic boundary in front of every AI-stated dated invoice. The
 * whole term passes or fails: one unsupported invoice refuses the term, so no
 * partial schedule is ever created. Exact duplicates within the term (same
 * date and same amount) collapse to one invoice. Events are ordered by date,
 * then amount; `period` is that ordinal.
 */
export function aiExplicitInvoiceEligibility(
  term: AiExplicitInvoiceTerm,
):
  | { ok: true; events: ExplicitInvoiceEvent[] }
  | { ok: false; reason: AiExplicitInvoiceRefusal; invoiceIndex?: number } {
  const invoices = term.explicitInvoices ?? [];
  // Package 3F. An explicitly `unknown` kind reaches the per-invoice evidence
  // check ONLY for a term that lists dated invoices; the whole term then
  // passes only if ARC itself proves every invoice's fixed amount, invoicing
  // language and exact date from its own sentence. Every other kind
  // (pricing basis, rates, percentages, formulas) stays refused.
  if (!isExplicitInvoiceCandidate(term)) {
    return { ok: false, reason: "amount_not_fixed_invoice" };
  }
  if (!AI_FIXED_SCHEDULE_REVIEW_STATES.includes(term.reviewState)) {
    return { ok: false, reason: "billing_term_not_source_supported" };
  }
  const seen = new Map<string, { date: string; cents: bigint; amountInput: string }>();
  for (const [index, invoice] of invoices.entries()) {
    const verdict = checkExplicitInvoiceEvidence(invoice);
    if (!verdict.ok) return { ok: false, reason: verdict.reason, invoiceIndex: index };
    const cents = exactCents(invoice.amountInput!)!;
    const key = `${invoice.invoiceDateInput}|${cents}`;
    if (!seen.has(key)) {
      seen.set(key, { date: invoice.invoiceDateInput, cents, amountInput: invoice.amountInput! });
    }
  }
  const ordered = [...seen.values()].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : a.cents < b.cents ? -1 : a.cents > b.cents ? 1 : 0,
  );
  return {
    ok: true,
    events: ordered.map((entry, index) => ({
      period: index + 1,
      invoiceDate: entry.date,
      unconditionalRightDate: entry.date,
      amountInput: entry.amountInput,
    })),
  };
}

/**
 * Package 3F — the single definition of an explicit-invoice billing candidate,
 * decided BEFORE any evidence filtering: a term that lists dated invoices and
 * whose kind is `fixed_invoice_amount` or an explicit `unknown` (never a legacy
 * missing kind). Used both by event creation (through
 * `aiExplicitInvoiceEligibility`) and by the Step 3 completeness denominator,
 * so a refused candidate can never vanish and make a schedule look complete.
 */
export function isExplicitInvoiceCandidate(term: {
  amountKind?: string | null | undefined;
  explicitInvoices?: readonly unknown[] | undefined;
}): boolean {
  if ((term.explicitInvoices ?? []).length === 0) return false;
  return term.amountKind === "fixed_invoice_amount" || term.amountKind === "unknown";
}

/* ============================================ Package 3D-Q.2 derivable rules */

/**
 * Package 3D-Q.2 — ARC-owned evidence checks for two narrow billing rules ARC
 * can derive itself: equal installments of a stated total, and a single
 * invoice triggered by a linked obligation's commencement or completion.
 *
 * Same philosophy as the checks above: ONE sentence of the term's own text
 * citations must establish every fact the derivation uses. A trigger or
 * timing the model reports is never accepted on the model's word. Sentences
 * are never combined. Unfamiliar wording fails closed.
 */

const COUNT_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};
const EQUAL_WORD = /\bequal\b/i;
const COMMENCEMENT_PHRASE =
  /\b(?:upon|at|on)\s+(?:the\s+)?(?:contract\s+|service\s+|subscription\s+)?commencement\b|\bbeginning\s+(?:on|at)\s+(?:the\s+)?(?:effective\s+date|commencement)\b|\b(?:upon|on|at)\s+the\s+effective\s+date\b|\bupon\s+(?:execution|signature|signing)\b|\bat\s+(?:execution|signing)\b/i;
const COMPLETION_PHRASE = /\bupon\s+(?:the\s+)?(?:successful\s+)?completion\b/i;

function statesCount(sentence: string, count: number): boolean {
  const pattern =
    /\b(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b(?:\s*\((\d{1,3})\))?\s+(?:equal\s+)?(?:[a-z-]+\s+){0,2}instal(?:l)?ments?\b/gi;
  for (const found of sentence.matchAll(pattern)) {
    const word = found[1]!.toLowerCase();
    const value = /^\d+$/.test(word) ? Number(word) : COUNT_WORDS[word];
    if (value === count) return true;
  }
  return false;
}

export type InstallmentEvidenceRefusal =
  | "amount_not_fixed_invoice"
  | "billing_term_not_source_supported"
  | "no_text_evidence"
  | "no_currency_amount"
  | "rate_like_amount"
  | "no_installment_evidence"
  | "no_timing_evidence";

export interface AiInstallmentTerm {
  amountKind?: string | null | undefined;
  reviewState: string;
  billingTiming: BillingTimingInput;
  frequency: BillingFrequency;
  billingBasisTotalInput?: string | null | undefined;
  installmentCount?: number | null | undefined;
  equalInstallments?: boolean | null | undefined;
  invoiceTriggerKind?: string | undefined;
  citations: FixedBillingEvidenceInput["citations"];
}

/**
 * One sentence must state: an invoicing word, the exact total, the installment
 * count, "equal", the cadence, AND at least one supported date-driving basis:
 * the term's advance / arrears timing phrase, or a commencement trigger phrase.
 */
export function aiInstallmentEligibility(
  term: AiInstallmentTerm,
): { ok: true; timing: "advance" | "arrears" } | { ok: false; reason: InstallmentEvidenceRefusal } {
  // 3D-Q.2 live patch: the installment total is a fixed BILLING BASIS that ARC
  // divides itself, so pricing_basis_only is the natural classification;
  // fixed_invoice_amount stays accepted for compatibility. Rate, percentage,
  // formula and unknown kinds still fail closed.
  const kind = term.amountKind ?? "unknown";
  if (kind !== "fixed_invoice_amount" && kind !== "pricing_basis_only") {
    return { ok: false, reason: "amount_not_fixed_invoice" };
  }
  if (!AI_FIXED_SCHEDULE_REVIEW_STATES.includes(term.reviewState)) {
    return { ok: false, reason: "billing_term_not_source_supported" };
  }
  if (term.equalInstallments !== true || term.installmentCount == null) {
    return { ok: false, reason: "no_installment_evidence" };
  }
  const basis = term.billingBasisTotalInput ?? null;
  const target = basis === null ? null : exactCents(basis);
  if (target === null || target <= 0n) return { ok: false, reason: "no_currency_amount" };
  const sentences = sentencesOf(term.citations);
  if (sentences.length === 0) return { ok: false, reason: "no_text_evidence" };
  const cadence = CADENCE[term.frequency];
  if (cadence === undefined || term.frequency === "one_time") {
    return { ok: false, reason: "no_installment_evidence" };
  }

  let sawRateLike = false;
  let sawAmount = false;
  let sawInstallment = false;
  for (const sentence of sentences) {
    const verdict = amountVerdict(sentence, target);
    if (verdict === "rate_like") sawRateLike = true;
    if (verdict !== "match") continue;
    sawAmount = true;
    if (
      !INVOICING_WORD.test(sentence) ||
      !EQUAL_WORD.test(sentence) ||
      !statesCount(sentence, term.installmentCount) ||
      !cadence.test(sentence)
    ) {
      continue;
    }
    sawInstallment = true;
    // ONE supported date-driving basis is enough: a stated advance / arrears
    // timing, OR a stated commencement trigger. A populated model field that
    // this same sentence does not support is never relied on, and a basis
    // stated only in another sentence is corroborative, never required.
    if (term.billingTiming === "advance" && ADVANCE_PHRASE.test(sentence)) {
      return { ok: true, timing: "advance" };
    }
    if (term.billingTiming === "arrears" && ARREARS_PHRASE.test(sentence)) {
      return { ok: true, timing: "arrears" };
    }
    if (
      (term.invoiceTriggerKind ?? "none") === "commencement" &&
      COMMENCEMENT_PHRASE.test(sentence)
    ) {
      return { ok: true, timing: "advance" };
    }
  }
  if (!sawAmount)
    return { ok: false, reason: sawRateLike ? "rate_like_amount" : "no_currency_amount" };
  if (!sawInstallment) return { ok: false, reason: "no_installment_evidence" };
  return { ok: false, reason: "no_timing_evidence" };
}

export type TriggerEvidenceRefusal =
  | "amount_not_fixed_invoice"
  | "billing_term_not_source_supported"
  | "unsupported_trigger"
  | "no_text_evidence"
  | "no_currency_amount"
  | "rate_like_amount"
  | "no_trigger_evidence";

export interface AiTriggerTerm {
  amountKind?: string | null | undefined;
  reviewState: string;
  amountOrRateInput: string | null;
  invoiceTriggerKind?: string | undefined;
  citations: FixedBillingEvidenceInput["citations"];
}

/**
 * One sentence must state an invoicing word, the exact amount and a trigger
 * phrase matching the trigger kind. The date is never read from that sentence;
 * it comes only from the linked obligation's own workpaper date.
 */
export function aiTriggerEligibility(
  term: AiTriggerTerm,
): { ok: true } | { ok: false; reason: TriggerEvidenceRefusal } {
  if ((term.amountKind ?? "unknown") !== "fixed_invoice_amount") {
    return { ok: false, reason: "amount_not_fixed_invoice" };
  }
  if (!AI_FIXED_SCHEDULE_REVIEW_STATES.includes(term.reviewState)) {
    return { ok: false, reason: "billing_term_not_source_supported" };
  }
  const phrase =
    term.invoiceTriggerKind === "commencement"
      ? COMMENCEMENT_PHRASE
      : term.invoiceTriggerKind === "completion_of_linked_obligation"
        ? COMPLETION_PHRASE
        : null;
  if (phrase === null) return { ok: false, reason: "unsupported_trigger" };
  const target = term.amountOrRateInput === null ? null : exactCents(term.amountOrRateInput);
  if (target === null || target <= 0n) return { ok: false, reason: "no_currency_amount" };
  const sentences = sentencesOf(term.citations);
  if (sentences.length === 0) return { ok: false, reason: "no_text_evidence" };

  let sawRateLike = false;
  let sawAmount = false;
  for (const sentence of sentences) {
    const verdict = amountVerdict(sentence, target);
    if (verdict === "rate_like") sawRateLike = true;
    if (verdict !== "match") continue;
    sawAmount = true;
    if (INSTALLMENT_WORD.test(sentence)) continue;
    if (INVOICING_WORD.test(sentence) && phrase.test(sentence)) return { ok: true };
  }
  if (!sawAmount)
    return { ok: false, reason: sawRateLike ? "rate_like_amount" : "no_currency_amount" };
  return { ok: false, reason: "no_trigger_evidence" };
}
