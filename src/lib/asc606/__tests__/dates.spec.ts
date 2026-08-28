import { describe, expect, it } from "vitest";

import {
  accountingHorizon,
  daysInMonth,
  enumerateMonths,
  inclusiveDayCount,
  isLeapYear,
  isValidIsoDate,
  monthKeyOf,
  monthRange,
  overlapDaysInMonth,
} from "../dates";

describe("calendar utilities", () => {
  it("counts inclusive service days", () => {
    expect(inclusiveDayCount("2027-01-01", "2027-12-31")).toBe(365);
    expect(inclusiveDayCount("2027-01-15", "2027-12-31")).toBe(351);
    expect(inclusiveDayCount("2027-03-10", "2027-03-10")).toBe(1);
  });

  it("handles leap years", () => {
    expect(isLeapYear(2028)).toBe(true);
    expect(isLeapYear(2027)).toBe(false);
    expect(isLeapYear(2100)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2027, 2)).toBe(28);
    expect(inclusiveDayCount("2028-01-01", "2028-12-31")).toBe(366);
    expect(isValidIsoDate("2028-02-29")).toBe(true);
    expect(isValidIsoDate("2027-02-29")).toBe(false);
  });

  it("is unaffected by the host timezone", () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = "Pacific/Kiritimati";
      expect(monthKeyOf("2027-01-01")).toBe("2027-01");
      expect(inclusiveDayCount("2027-01-01", "2027-01-31")).toBe(31);
      process.env.TZ = "Pacific/Midway";
      expect(monthKeyOf("2027-01-01")).toBe("2027-01");
      expect(inclusiveDayCount("2027-01-01", "2027-01-31")).toBe(31);
    } finally {
      process.env.TZ = original;
    }
  });

  it("enumerates months across year boundaries", () => {
    expect(enumerateMonths("2027-11-15", "2028-02-03")).toEqual([
      "2027-11",
      "2027-12",
      "2028-01",
      "2028-02",
    ]);
    expect(monthRange("2027-12", "2028-01")).toEqual(["2027-12", "2028-01"]);
  });

  it("computes overlap days between a service period and a month", () => {
    expect(overlapDaysInMonth("2027-01", "2027-01-15", "2027-12-31")).toBe(17);
    expect(overlapDaysInMonth("2027-02", "2027-01-15", "2027-12-31")).toBe(28);
    expect(overlapDaysInMonth("2028-02", "2028-01-01", "2028-12-31")).toBe(29);
    expect(overlapDaysInMonth("2026-12", "2027-01-15", "2027-12-31")).toBe(0);
  });

  it("computes the wider accounting horizon (spec A2)", () => {
    // Revenue Jan-Dec 2027; final unconditional right in Jan 2028.
    const horizon = accountingHorizon([
      ["2027-01", "2027-12"],
      ["2027-02", "2028-01"],
    ]);
    expect(horizon).toEqual({ firstMonth: "2027-01", lastMonth: "2028-01" });
    expect(accountingHorizon([])).toBeNull();
  });

  it("rejects invalid dates", () => {
    expect(isValidIsoDate("2027-13-01")).toBe(false);
    expect(isValidIsoDate("01/01/2027")).toBe(false);
    expect(() => inclusiveDayCount("2027-12-31", "2027-01-01")).toThrow();
  });
});
