import { describe, expect, it } from "vitest";

import {
  assertCents,
  assertNonNegativeCents,
  formatCents,
  isValidCents,
  proportionOfCents,
  roundRatioHalfUp,
  sumCents,
} from "../money";

describe("exact monetary utilities", () => {
  it("validates monetary inputs", () => {
    expect(isValidCents(12_000_000)).toBe(true);
    expect(isValidCents(1200.5)).toBe(false);
    expect(isValidCents(Number.NaN)).toBe(false);
    expect(isValidCents(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isValidCents("12000000")).toBe(false);
    expect(() => assertCents(0.1)).toThrow();
    expect(() => assertNonNegativeCents(-1)).toThrow();
  });

  it("rounds exact ratios half-up with integer logic", () => {
    expect(roundRatioHalfUp(1n, 2n)).toBe(1n); // 0.5 -> 1
    expect(roundRatioHalfUp(1n, 3n)).toBe(0n); // 0.333 -> 0
    expect(roundRatioHalfUp(2n, 3n)).toBe(1n); // 0.667 -> 1
    expect(roundRatioHalfUp(3n, 2n)).toBe(2n); // 1.5 -> 2
    expect(roundRatioHalfUp(5n, 2n)).toBe(3n); // 2.5 -> 3 (half-up, not banker's)
    expect(roundRatioHalfUp(0n, 7n)).toBe(0n);
    expect(() => roundRatioHalfUp(1n, 0n)).toThrow();
  });

  it("stays exact where floating point would drift", () => {
    // 0.1 + 0.2 style drift never reaches the accounting result.
    expect(proportionOfCents(12_000_000, 31, 365)).toBe(1_019_178);
    expect(proportionOfCents(10_285_714, 31, 365)).toBe(873_581);
    // Large values that exceed 2^53 as an intermediate product.
    expect(proportionOfCents(900_000_000_000, 999_999, 1_000_000)).toBe(899_999_100_000);
  });

  it("sums and formats", () => {
    expect(sumCents([1_019_178, 920_548, 1_019_178])).toBe(2_958_904);
    expect(formatCents(1_019_180)).toBe("$10,191.80");
    expect(formatCents(-41_096)).toBe("-$410.96");
  });
});
