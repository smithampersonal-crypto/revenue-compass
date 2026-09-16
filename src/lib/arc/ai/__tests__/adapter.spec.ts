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
      supported: true,
      method: "over_time_ratable",
    });
    expect(mapRecognitionMethod("point_in_time_transfer")).toEqual({
      supported: true,
      method: "point_in_time",
    });
    // Never silently coerced into ratable over-time.
    expect(mapRecognitionMethod("output_method")).toEqual({
      supported: false,
      reason: "engine_support_gap",
    });
    expect(mapRecognitionMethod("input_method")).toEqual({
      supported: false,
      reason: "engine_support_gap",
    });
    expect(mapRecognitionMethod("unknown")).toEqual({ supported: false, reason: "unknown" });
  });

  it("maps only unambiguous variable-consideration directions", () => {
    expect(mapVcEffect("usage")).toBe("increase");
    expect(mapVcEffect("bonus")).toBe("increase");
    expect(mapVcEffect("service_credit")).toBe("decrease");
    expect(mapVcEffect("rebate")).toBe("decrease");
    expect(mapVcEffect("refund")).toBe("decrease");
    expect(mapVcEffect("discount")).toBe("decrease");
    // Direction depends on who pays whom, which is prose, not structure.
    expect(mapVcEffect("penalty")).toBeNull();
    expect(mapVcEffect("other")).toBeNull();
    expect(mapEstimationMethod("most_likely_amount")).toBe("most_likely_amount");
    expect(mapEstimationMethod("expected_value")).toBe("expected_value");
    expect(mapEstimationMethod("not_estimable")).toBeNull();
    expect(mapEstimationMethod("unknown")).toBeNull();
  });
});

describe("deterministic billing schedules", () => {
  const base = {
    serviceStart: "2027-01-01" as const,
    serviceEnd: "2027-12-31" as const,
    amountOrRateInput: "120000" as string | null,
  };

  it("derives an annual advance invoice at the start of the term", () => {
    const result = deriveBillingSchedule({
      ...base,
      frequency: "annual",
      billingTiming: "advance",
    });
    expect(result).toEqual({
      ok: true,
      events: [
        {
          period: 1,
          invoiceDate: "2027-01-01",
          unconditionalRightDate: "2027-01-01",
          amountInput: "120000",
        },
      ],
    });
  });

  it("derives quarterly arrears invoices at the end of each period", () => {
    const result = deriveBillingSchedule({
      serviceStart: "2027-01-01",
      serviceEnd: "2027-12-31",
      amountOrRateInput: "30000",
      frequency: "quarterly",
      billingTiming: "arrears",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events.map((event) => event.invoiceDate)).toEqual([
      "2027-03-31",
      "2027-06-30",
      "2027-09-30",
      "2027-12-31",
    ]);
  });

  it("derives monthly advance invoices at each period start", () => {
    const result = deriveBillingSchedule({
      ...base,
      amountOrRateInput: "10000",
      frequency: "monthly",
      billingTiming: "advance",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toHaveLength(12);
    expect(result.events[0]!.invoiceDate).toBe("2027-01-01");
    expect(result.events[11]!.invoiceDate).toBe("2027-12-01");
  });

  it("refuses to derive a schedule from incomplete or non-whole-period facts", () => {
    expect(
      deriveBillingSchedule({ ...base, frequency: "annual", billingTiming: "milestone" }),
    ).toEqual({ ok: false, reason: "unsupported_timing" });
    expect(
      deriveBillingSchedule({ ...base, frequency: "annual", billingTiming: "on_usage" }),
    ).toEqual({ ok: false, reason: "unsupported_timing" });
    expect(
      deriveBillingSchedule({ ...base, frequency: "on_event", billingTiming: "advance" }),
    ).toEqual({ ok: false, reason: "unsupported_frequency" });
    expect(
      deriveBillingSchedule({
        ...base,
        amountOrRateInput: null,
        frequency: "annual",
        billingTiming: "advance",
      }),
    ).toEqual({ ok: false, reason: "missing_amount" });
    expect(
      deriveBillingSchedule({
        ...base,
        serviceStart: null,
        frequency: "annual",
        billingTiming: "advance",
      }),
    ).toEqual({ ok: false, reason: "missing_service_period" });
    expect(
      deriveBillingSchedule({
        ...base,
        serviceEnd: "2027-11-15",
        frequency: "quarterly",
        billingTiming: "advance",
      }),
    ).toEqual({ ok: false, reason: "term_not_divisible" });
  });
});

describe("projected contractual collection dates", () => {
  it("derives invoice date plus payment terms", () => {
    expect(
      deriveProjectedCollectionDate({
        contractualDueDateBasis: "invoice_date_plus_terms",
        paymentTermsDays: 30,
        invoiceDate: "2027-01-01",
      }),
    ).toEqual({ ok: true, collectionDate: "2027-01-31" });
  });

  it("refuses every basis that is not a structured invoice-date-plus-terms rule", () => {
    for (const contractualDueDateBasis of [
      "fixed_calendar_date",
      "milestone_event",
      "unknown",
    ] as const) {
      expect(
        deriveProjectedCollectionDate({
          contractualDueDateBasis,
          paymentTermsDays: 30,
          invoiceDate: "2027-01-01",
        }),
      ).toEqual({ ok: false, reason: "unsupported_basis" });
    }
    expect(
      deriveProjectedCollectionDate({
        contractualDueDateBasis: "invoice_date_plus_terms",
        paymentTermsDays: null,
        invoiceDate: "2027-01-01",
      }),
    ).toEqual({ ok: false, reason: "missing_payment_terms" });
  });
});
