/**
 * Exact monetary utilities.
 *
 * Rules:
 *  - Money is integer cents at every public boundary.
 *  - Exact proportional math is done in BigInt internally, then converted back
 *    to a safe integer `number` so results stay JSON-serializable.
 *  - This module owns the ONLY rounding implementation in the engine.
 */

import type { Cents } from "./types";

/** Largest cent amount the engine accepts (~$90 trillion), inside 2^53-1. */
export const MAX_CENTS = 9_007_199_254_740_990;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

/** Throws unless `value` is a finite, integer-valued, in-range cent amount. */
export function assertCents(value: unknown, label = "amount"): asserts value is Cents {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new MoneyError(`${label} must be a finite number of cents`);
  }
  if (!Number.isInteger(value)) {
    throw new MoneyError(`${label} must be an integer number of cents (received ${value})`);
  }
  if (Math.abs(value) > MAX_CENTS) {
    throw new MoneyError(`${label} exceeds the supported range`);
  }
}

/** Throws unless `value` is a valid, non-negative cent amount. */
export function assertNonNegativeCents(value: unknown, label = "amount"): asserts value is Cents {
  assertCents(value, label);
  if ((value as number) < 0) {
    throw new MoneyError(`${label} must not be negative (received ${value})`);
  }
}

export function isValidCents(value: unknown): value is Cents {
  try {
    assertCents(value);
    return true;
  } catch {
    return false;
  }
}

/** Converts a BigInt result back to a safe integer `number`, asserting range. */
export function bigIntToCents(value: bigint, label = "amount"): Cents {
  if (value > BigInt(MAX_CENTS) || value < -BigInt(MAX_CENTS)) {
    throw new MoneyError(`${label} exceeds the supported range`);
  }
  return Number(value);
}

/**
 * Canonical exact-ratio rounding: rounds `numerator / denominator` half-up
 * using integer quotient/remainder logic only (no floating point).
 */
export function roundRatioHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new MoneyError("denominator must be positive");
  }
  if (numerator < 0n) {
    throw new MoneyError("numerator must be non-negative");
  }
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return 2n * remainder >= denominator ? quotient + 1n : quotient;
}

/**
 * Exact half-up rounding of `amountCents * factorNumerator / factorDenominator`,
 * returned as integer cents. The only ratio helper recognition code should use.
 */
export function proportionOfCents(
  amountCents: Cents,
  factorNumerator: number,
  factorDenominator: number,
  label = "proportion",
): Cents {
  assertNonNegativeCents(amountCents, label);
  if (!Number.isInteger(factorNumerator) || factorNumerator < 0) {
    throw new MoneyError(`${label} numerator must be a non-negative integer`);
  }
  if (!Number.isInteger(factorDenominator) || factorDenominator <= 0) {
    throw new MoneyError(`${label} denominator must be a positive integer`);
  }
  return bigIntToCents(
    roundRatioHalfUp(BigInt(amountCents) * BigInt(factorNumerator), BigInt(factorDenominator)),
    label,
  );
}

export function sumCents(values: readonly Cents[]): Cents {
  let total = 0n;
  for (const value of values) {
    assertCents(value, "amount");
    total += BigInt(value);
  }
  return bigIntToCents(total, "total");
}

/** Display helper (presentation only — never used in accounting logic). */
export function formatCents(value: Cents): string {
  const negative = value < 0;
  const abs = Math.abs(value);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  const cents = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}$${dollars}.${cents}`;
}
