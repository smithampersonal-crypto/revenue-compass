/**
 * Package 3F.3 — deterministic usage-meter facts from a v10 AI proposal.
 *
 * Two pure, browser-safe helpers:
 *
 *   normalizeUsageRate            exact sub-cent rate -> existing ratio fields
 *   checkIncludedQuantityEvidence ARC-verified contractual included quantity
 *
 * Decimal-string / BigInt arithmetic only. No floating point, no rounding,
 * no approximation. Anything not exactly representable fails closed.
 */

import { MAX_CENTS } from "@/lib/asc606";

import type { AiCitation } from "./schema";

/* ---------------------------------------------------------------- rates */

export type UsageRateNormalization =
  | { ok: true; rateAmountInput: string; rateQuantityInput: string }
  | { ok: false; reason: "rate_missing" | "rate_invalid" | "rate_not_positive" | "rate_out_of_bounds" };

const RATE_PATTERN = /^(\d{1,15})(?:\.(\d{1,6}))?$/;

/**
 * Converts a contractual per-unit USD rate into `rateAmountInput /
 * rateQuantityInput` using the SMALLEST power-of-ten denominator that makes
 * the numerator a whole-cent amount. The economic rate is unchanged exactly.
 *
 *   1.35   -> "1.35" / "1"      (unchanged text)
 *   12.00  -> "12.00" / "1"     (unchanged text)
 *   0.03   -> "0.03" / "1"
 *   0.004  -> "0.04" / "10"
 *   0.0005 -> "0.05" / "100"
 */
export function normalizeUsageRate(raw: string | null | undefined): UsageRateNormalization {
  if (raw === null || raw === undefined) return { ok: false, reason: "rate_missing" };
  const text = raw.trim();
  const match = RATE_PATTERN.exec(text);
  if (!match) return { ok: false, reason: "rate_invalid" };
  const whole = match[1]!;
  const fractionRaw = match[2] ?? "";
  const fraction = fractionRaw.replace(/0+$/, "");
  const scaledUnits = BigInt(whole + fraction); // value x 10^fraction.length
  if (scaledUnits <= 0n) return { ok: false, reason: "rate_not_positive" };

  if (fractionRaw.length <= 2) {
    // Already cents precision: keep the accepted text exactly.
    return cents(BigInt(whole + fractionRaw.padEnd(2, "0")), text, 1n);
  }
  if (fraction.length <= 2) {
    // e.g. "1.3500": exact cents once insignificant zeros are dropped.
    return cents(BigInt(whole + fraction.padEnd(2, "0")), null, 1n);
  }
  // value x 10^k expressed in cents = value x 10^(k+2) = scaledUnits, where
  // k = fraction.length - 2 is the smallest scaling giving whole cents.
  const denominator = 10n ** BigInt(fraction.length - 2);
  return cents(scaledUnits, null, denominator);
}

function cents(
  amountCents: bigint,
  preservedText: string | null,
  denominator: bigint,
): UsageRateNormalization {
  if (amountCents <= 0n) return { ok: false, reason: "rate_not_positive" };
  if (amountCents > BigInt(MAX_CENTS) || denominator > BigInt(Number.MAX_SAFE_INTEGER)) {
    return { ok: false, reason: "rate_out_of_bounds" };
  }
  const dollars = amountCents / 100n;
  const remainder = (amountCents % 100n).toString().padStart(2, "0");
  return {
    ok: true,
    rateAmountInput: preservedText ?? `${dollars.toString()}.${remainder}`,
    rateQuantityInput: denominator.toString(),
  };
}

/* ----------------------------------------------------- included quantity */

export type IncludedQuantityEvidence =
  | { ok: true; includedQuantityInput: string }
  | {
      ok: false;
      reason:
        | "included_quantity_unresolved"
        | "included_quantity_invalid"
        | "included_quantity_not_evidenced"
        | "included_quantity_ambiguous"
        | "zero_threshold_not_evidenced";
    };

export const INCLUDED_QUANTITY_PATTERN = /^(0|[1-9]\d{0,14})$/;

/** Allowance / included-threshold semantics. Deliberately narrow. */
const ALLOWANCE_TERMS = /\b(includes?|included|including|allowance|up to)\b/i;
/** Meanings that make a quantity something other than an included allowance. */
const DISQUALIFYING_TERMS =
  /\b(minimum|minimums|commit(?:s|ted|ment|ments)?|purchase commitment|forecast\w*|expect\w*|estimat\w*|anticipat\w*|target\w*|historical\w*|historically|prior|previous\w*|last year|average\w*|project(?:ed|ion|ions))\b/i;
/** Any threshold concept at all: its presence forbids a zero threshold. */
const THRESHOLD_TERMS =
  /\b(includes?|included|including|allowance|up to|above|exceed\w*|excess|over(?:age)?|threshold|tier\w*|first \d|minimum\w*|commit\w*)\b/i;

function textExcerpts(citations: readonly AiCitation[]): string[] {
  return citations
    .filter((citation) => citation.evidenceMode === "text")
    .map((citation) => (citation.excerpt ?? "").replace(/\s+/g, " ").trim())
    .filter((excerpt) => excerpt.length > 0);
}

/** One local evidence unit: a sentence within one ARC-materialized excerpt. */
function sentences(excerpt: string): string[] {
  return excerpt
    .split(/(?<=[.;!?])\s+(?=[A-Z0-9(])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

/** Whole-number quantities written in the sentence (commas grouped or bare). */
function wholeQuantities(sentence: string): string[] {
  const found: string[] = [];
  const pattern = /(?<![\d.,$])(\d{1,3}(?:,\d{3})+|\d+)(?![\d]|[.,]\d)/g;
  for (const match of sentence.matchAll(pattern)) {
    // Money is never a quantity.
    const before = sentence.slice(Math.max(0, (match.index ?? 0) - 1), match.index ?? 0);
    if (before === "$") continue;
    found.push(BigInt(match[1]!.replace(/,/g, "")).toString());
  }
  return found;
}

/** Exact decimal numbers written in text, normalized (no commas/trailing zeros). */
function decimalsIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const match of text.matchAll(/\d[\d,]*(?:\.\d+)?|\.\d+/g)) {
    out.add(canonicalDecimal(match[0].replace(/,/g, "")));
  }
  return out;
}

function canonicalDecimal(value: string): string {
  const [wholeRaw = "", fractionRaw = ""] = value.split(".");
  const whole = wholeRaw.replace(/^0+(?=\d)/, "") || "0";
  const fraction = fractionRaw.replace(/0+$/, "");
  return fraction.length > 0 ? `${whole}.${fraction}` : whole;
}

/**
 * Verifies a v10 `includedQuantityInput` against the component's OWN
 * ARC-materialized TEXT citations. The AI-written description, trigger and
 * unit prose are never authority, and nothing is borrowed from another
 * component.
 *
 *   positive N  one sentence states exactly N with allowance semantics and no
 *               disqualifying meaning; the component's contractual rate is
 *               stated in its own citations; no competing allowance quantity.
 *   "0"         the rate is stated and no citation of the component carries
 *               any allowance / threshold / minimum concept at all.
 *   null        unresolved — never zero.
 */
export function checkIncludedQuantityEvidence(component: {
  includedQuantityInput: string | null;
  contractualRateOrAmountInput: string | null;
  citations: readonly AiCitation[];
}): IncludedQuantityEvidence {
  const proposed = component.includedQuantityInput;
  if (proposed === null) return { ok: false, reason: "included_quantity_unresolved" };
  if (!INCLUDED_QUANTITY_PATTERN.test(proposed)) {
    return { ok: false, reason: "included_quantity_invalid" };
  }

  const excerpts = textExcerpts(component.citations);
  const rate = component.contractualRateOrAmountInput;
  const rateStated =
    rate !== null &&
    RATE_PATTERN.test(rate.trim()) &&
    excerpts.some((excerpt) => decimalsIn(excerpt).has(canonicalDecimal(rate.trim())));

  if (proposed === "0") {
    if (!rateStated) return { ok: false, reason: "zero_threshold_not_evidenced" };
    if (excerpts.some((excerpt) => THRESHOLD_TERMS.test(excerpt))) {
      return { ok: false, reason: "zero_threshold_not_evidenced" };
    }
    return { ok: true, includedQuantityInput: "0" };
  }

  if (!rateStated) return { ok: false, reason: "included_quantity_not_evidenced" };

  const allowanceQuantities = new Set<string>();
  let supported = false;
  for (const excerpt of excerpts) {
    for (const sentence of sentences(excerpt)) {
      if (!ALLOWANCE_TERMS.test(sentence) || DISQUALIFYING_TERMS.test(sentence)) continue;
      const quantities = wholeQuantities(sentence);
      for (const quantity of quantities) allowanceQuantities.add(quantity);
      if (quantities.includes(proposed)) supported = true;
    }
  }
  if (!supported) return { ok: false, reason: "included_quantity_not_evidenced" };
  if (allowanceQuantities.size !== 1) return { ok: false, reason: "included_quantity_ambiguous" };
  return { ok: true, includedQuantityInput: proposed };
}
