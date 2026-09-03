import { describe, expect, it } from "vitest";

import { parseUsdToCents } from "../money-input";

describe("exact USD string to cents", () => {
  it("accepts well-formed amounts", () => {
    expect(parseUsdToCents("120000")).toEqual({ ok: true, cents: 12_000_000 });
    expect(parseUsdToCents("120000.00")).toEqual({ ok: true, cents: 12_000_000 });
    expect(parseUsdToCents("120,000.00")).toEqual({ ok: true, cents: 12_000_000 });
    expect(parseUsdToCents("$120,000.00")).toEqual({ ok: true, cents: 12_000_000 });
    expect(parseUsdToCents("0.01")).toEqual({ ok: true, cents: 1 });
    expect(parseUsdToCents(" 35100.5 ")).toEqual({ ok: true, cents: 3_510_050 });
  });

  it("rejects malformed, over-precise, negative and out-of-range amounts", () => {
    for (const bad of ["1.005", "-5.00", "abc", "", "1.2.3", "12,34.00", ".", "1e5", "0.001"]) {
      expect(parseUsdToCents(bad).ok, bad).toBe(false);
    }
    expect(parseUsdToCents("999999999999999999").ok).toBe(false);
  });

  it("never routes through floating point rounding", () => {
    // 1.005 * 100 is 100.49999... in binary floating point; we reject instead.
    const result = parseUsdToCents("1.005");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/two decimal/i);
  });
});
