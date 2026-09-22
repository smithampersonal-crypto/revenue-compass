import { describe, expect, it } from "vitest";

import { formatUsdInputForBlur, parseUsdToCents } from "../money-input";

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

describe("blur-time USD presentation formatting", () => {
  it("groups valid amounts to #,##0.00 without adding a currency symbol", () => {
    expect(formatUsdInputForBlur("505001.96")).toBe("505,001.96");
    expect(formatUsdInputForBlur("505001")).toBe("505,001.00");
    expect(formatUsdInputForBlur("35100.5")).toBe("35,100.50");
    expect(formatUsdInputForBlur("505,001.96")).toBe("505,001.96");
    expect(formatUsdInputForBlur("$505001.96")).toBe("505,001.96");
    expect(formatUsdInputForBlur("0.01")).toBe("0.01");
    expect(formatUsdInputForBlur("1234567.89")).toBe("1,234,567.89");
  });

  it("round-trips through the exact parser to the same cents and never rounds", () => {
    for (const raw of ["505001.96", "505001", "35100.5", "$505,001.96", "0.01"]) {
      const before = parseUsdToCents(raw);
      const after = parseUsdToCents(formatUsdInputForBlur(raw));
      expect(before.ok).toBe(true);
      expect(after).toEqual(before);
      expect(formatUsdInputForBlur(formatUsdInputForBlur(raw))).toBe(formatUsdInputForBlur(raw));
    }
  });

  it("returns invalid or incomplete input unchanged", () => {
    for (const raw of ["1.005", "500.", "", ".5", "abc", "-100", "12,34.00", "  "]) {
      expect(formatUsdInputForBlur(raw), raw).toBe(raw);
    }
  });
});
