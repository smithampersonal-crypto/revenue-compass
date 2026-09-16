import { describe, expect, it } from "vitest";

import {
  addDays,
  addMonths,
  deriveBillingSchedule,
  deriveProjectedCollectionDate,
  mapEstimationMethod,
  mapOutcome,
  mapRecognitionMethod,
  mapVcEffect,
  parseIsoDate,
  usableAmount,
  wholeMonthsBetween,
} from "../adapter";

describe("pure mapping primitives", () => {
  it("maps yes/no/unknown to ARC judgments without inventing a false", () => {
    expect(mapOutcome("yes")).toBe(true);
    expect(mapOutcome("no")).toBe(false);
    expect(mapOutcome("unknown")).toBeNull();
  });

  it("accepts only strict calendar-valid ISO dates", () => {
    expect(parseIsoDate("2027-01-31")).toBe("2027-01-31");
    expect(parseIsoDate("2027-02-30")).toBeNull();
    expect(parseIsoDate("Jan 1, 2027")).toBeNull();
    expect(parseIsoDate("2027-1-1")).toBeNull();
    expect(parseIsoDate(null)).toBeNull();
  });

  it("does UTC date arithmetic with month-end clamping", () => {
    expect(addDays("2027-01-01", 30)).toBe("2027-01-31");
    expect(addDays("2027-12-31", 1)).toBe("2028-01-01");
    expect(addMonths("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonths("2027-01-01", 12)).toBe("2028-01-01");
    expect(wholeMonthsBetween("2027-01-01", "2028-01-01")).toBe(12);
    expect(wholeMonthsBetween("2027-01-01", "2027-01-15")).toBeNull();
  });

  it("accepts only positive bare decimal amounts", () => {
    expect(usableAmount("120000")).toBe("120000");
    expect(usableAmount("120000.50")).toBe("120000.50");
    expect(usableAmount("0")).toBeNull();
    expect(usableAmount("-5")).toBeNull();
    expect(usableAmount("$120,000")).toBeNull();
    expect(usableAmount("about 120000")).toBeNull();
    expect(usableAmount(null)).toBeNull();
  });

  it("maps only recognition methods the engine actually supports", () => {
    expect(mapRecognitionMethod("ratable_over_time")).toEqual({
      ok: true,
      method: "over_time_ratable",
    });
    expect(mapRecognitionMethod("point_in_time_transfer")).toEqual({
      ok: true,
      method: "point_in_time",
    });
    for (const unsupported of ["output_method", "input_method", "milestone", "usage_based"] as const) {
      expect(mapRecognitionMethod(unsupported).ok).toBe(false);
    }
  });

  it("maps only unambiguous variable-consideration directions", () => {
    expect(mapVcEffect("usage_overage")).toBe("increase");
    expect(mapVcEffect("performance_bonus")).toBe("increase");
    expect(mapVcEffect("service_level_credit")).toBe("decrease");
    expect(mapVcEffect("rebate")).toBe("decrease");
    expect(mapVcEffect("refund_right")).toBe("decrease");
    // Direction is contract-specific; ARC refuses to guess.
    expect(mapVcEffect("penalty")).toBeNull();
    expect(mapVcEffect("other")).toBeNull();
    expect(mapEstimationMethod("most_likely_amount")).toBe("most_likely_amount");
    expect(mapEstimationMethod("not_estimable")).toBeNull();
  });
});

describe("deterministic billing schedules", () => {
  const base = {
    serviceStart: "2027-01-01" as const,
    serviceEnd: "2027-12-31" as const,
    amountInput: "120000",
  };

  it("derives an annual advance invoice at the start of the term", () => {
    const result = deriveBillingSchedule({ ...base, frequency: "annual", timing: "advance" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ invoiceDate: "2027-01-01", amountInput: "120000" });
  });

  it("derives quarterly arrears invoices at the end of each period", () => {
    const result = deriveBillingSchedule({
      serviceStart: "2027-01-01",
      serviceEnd: "2027-12-31",
      amountInput: "30000",
      frequency: "quarterly",
      timing: "arrears",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events.map((event) => event.invoiceDate)).toEqual([
      "2027-04-01",
      "2027-07-01",
      "2027-10-01",
      "2028-01-01",
    ]);
  });

  it("refuses to derive a schedule from incomplete or non-whole-period facts", () => {
    expect(deriveBillingSchedule({ ...base, frequency: "milestone", timing: "advance" }).ok).toBe(
      false,
    );
    expect(deriveBillingSchedule({ ...base, frequency: "usage_based", timing: "arrears" }).ok).toBe(
      false,
    );
    expect(
      deriveBillingSchedule({ ...base, serviceEnd: "2027-11-15", frequency: "quarterly", timing: "advance" })
        .ok,
    ).toBe(false);
    expect(deriveBillingSchedule({ ...base, amountInput: null, frequency: "annual", timing: "advance" }).ok).toBe(
      false,
    );
  });
});

describe("projected contractual collection dates", () => {
  it("derives invoice date plus payment terms", () => {
    expect(
      deriveProjectedCollectionDate({
        basis: "invoice_date_plus_terms",
        paymentTermsDays: 30,
        invoiceDate: "2027-01-01",
      }),
    ).toEqual({ ok: true, date: "2027-01-31" });
  });

  it("refuses every basis that is not a structured invoice-date-plus-terms rule", () => {
    for (const basis of ["milestone_based", "event_based", "not_determinable"] as const) {
      expect(
        deriveProjectedCollectionDate({ basis, paymentTermsDays: 30, invoiceDate: "2027-01-01" }).ok,
      ).toBe(false);
    }
    expect(
      deriveProjectedCollectionDate({
        basis: "invoice_date_plus_terms",
        paymentTermsDays: null,
        invoiceDate: "2027-01-01",
      }).ok,
    ).toBe(false);
  });
});
