/**
 * Exact conversion of accountant-entered USD strings into integer cents.
 *
 * String/integer logic only — no parseFloat, no multiplication of a decimal
 * dollar value. Over-precise input such as "1.005" is rejected rather than
 * silently rounded.
 */

import { MAX_CENTS } from "@/lib/asc606";

export type MoneyInputResult =
  | { ok: true; cents: number }
  | { ok: false; error: string };

const PATTERN = /^(\d{1,3}(,\d{3})*|\d+)(\.\d{1,2})?$/;

export function parseUsdToCents(raw: string): MoneyInputResult {
  if (typeof raw !== "string") return { ok: false, error: "Enter a USD amount." };
  let value = raw.trim();
  if (value === "") return { ok: false, error: "Enter a USD amount." };
  if (value.startsWith("$")) value = value.slice(1).trim();
  if (value.startsWith("-")) return { ok: false, error: "Amount cannot be negative." };

  if (/\.\d{3,}$/.test(value)) {
    return { ok: false, error: "Enter no more than two decimal places (cents)." };
  }
  if (!PATTERN.test(value)) {
    return { ok: false, error: "Enter a valid USD amount, for example 120,000.00." };
  }

  const [wholeRaw, fractionRaw = ""] = value.split(".");
  const whole = wholeRaw!.replace(/,/g, "");
  const fraction = (fractionRaw + "00").slice(0, 2);

  const centsBig = BigInt(whole) * 100n + BigInt(fraction);
  if (centsBig > BigInt(MAX_CENTS)) {
    return { ok: false, error: "Amount exceeds the amount this engine can calculate exactly." };
  }
  return { ok: true, cents: Number(centsBig) };
}

/** Formats integer cents back into an editable input string ("12000000" -> "120000.00"). */
export function centsToInputString(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  return `${negative ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export type PercentInputResult =
  | { ok: true; bps: number }
  | { ok: false; error: string };

/**
 * Exact conversion of an accountant-entered percentage into integer basis
 * points ("80" / "80.00%" -> 8000). String/integer logic only: probabilities
 * never travel through floating point.
 */
export function parsePercentToBps(raw: string): PercentInputResult {
  if (typeof raw !== "string") return { ok: false, error: "Enter a percentage." };
  let value = raw.trim();
  if (value === "") return { ok: false, error: "Enter a percentage." };
  if (value.endsWith("%")) value = value.slice(0, -1).trim();
  if (value.startsWith("-")) return { ok: false, error: "A probability cannot be negative." };
  if (/\.\d{3,}$/.test(value)) {
    return { ok: false, error: "Enter no more than two decimal places." };
  }
  if (!/^\d+(\.\d{1,2})?$/.test(value)) {
    return { ok: false, error: "Enter a valid percentage, for example 80.00." };
  }
  const [wholeRaw, fractionRaw = ""] = value.split(".");
  const bps = Number(BigInt(wholeRaw!) * 100n + BigInt((fractionRaw + "00").slice(0, 2)));
  if (bps <= 0) return { ok: false, error: "Probability must be greater than 0%." };
  if (bps > 10_000) return { ok: false, error: "Probability cannot exceed 100%." };
  return { ok: true, bps };
}

/** Formats basis points back into an editable input string (8000 -> "80.00"). */
export function bpsToInputString(bps: number): string {
  const abs = Math.abs(bps);
  return `${bps < 0 ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
