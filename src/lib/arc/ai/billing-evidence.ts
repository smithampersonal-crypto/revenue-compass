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
  | { ok: true }
  | { ok: false; reason: FixedBillingEvidenceRefusal };

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
  annual: /(?<!semi-)(?<!semi)\bannual(?:ly)?\b|\byearly\b|\b(?:each|every)\s+(?:contract\s+)?year\b/i,
  one_time: /\bsingle\s+invoice\b|\bin\s+full\b|\bone-?time\b|\bupon\s+(?:execution|signature|signing)\b|\bat\s+(?:execution|signing)\b/i,
};

const EXECUTION_PHRASE = /\bupon\s+(?:execution|signature|signing)\b|\bat\s+(?:execution|signing)\b/i;
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
    return frequency === "one_time" && EXECUTION_PHRASE.test(sentence) && !INSTALLMENT_WORD.test(sentence);
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

  let sawRateLike = false;
  let amountFound = false;
  for (const sentence of sentences) {
    const verdict = amountVerdict(sentence, target);
    if (verdict === "match") amountFound = true;
    else if (verdict === "rate_like") sawRateLike = true;
  }
  if (!amountFound) {
    return { ok: false, reason: sawRateLike ? "rate_like_amount" : "no_currency_amount" };
  }

  if (!sentences.some((sentence) => hasCadence(sentence, input.frequency))) {
    return { ok: false, reason: "no_invoice_cadence" };
  }
  if (!sentences.some((sentence) => hasTiming(sentence, input.billingTiming, input.frequency))) {
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
  | "amount_not_fixed_invoice"
  | "billing_term_not_source_supported"
  | FixedBillingEvidenceRefusal;

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
