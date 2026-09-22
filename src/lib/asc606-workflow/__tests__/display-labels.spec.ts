import { describe, expect, it } from "vitest";

import {
  createPoDraft,
  createPromiseDraft,
  performanceObligationDisplayLabel,
  promiseDisplayLabel,
} from "@/lib/asc606-workflow";

function po() {
  return {
    ...createPoDraft(1, "po-1"),
    name: "Hosted SaaS Access",
    recognitionMethod: "over_time_ratable" as const,
    serviceStart: "2027-07-01",
    serviceEnd: "2028-06-30",
  };
}

describe("deterministic display labels", () => {
  it("renders valid over-time and point-in-time recognition dates", () => {
    expect(performanceObligationDisplayLabel(po())).toBe("Hosted SaaS Access · 7/1/2027–6/30/2028");
    expect(
      performanceObligationDisplayLabel({
        ...po(),
        name: "Training",
        recognitionMethod: "point_in_time",
        recognitionDate: "2027-07-10",
      }),
    ).toBe("Training · 7/10/2027");
  });

  it.each([
    ["missing start", { serviceStart: "" }],
    ["missing end", { serviceEnd: "" }],
    ["malformed date", { serviceStart: "July 1, 2027" }],
    ["impossible date", { serviceStart: "2027-02-30" }],
    ["no recognition method", { recognitionMethod: null }],
  ])("returns the base name for %s", (_case, patch) => {
    expect(performanceObligationDisplayLabel({ ...po(), ...patch })).toBe("Hosted SaaS Access");
  });

  it("returns the base name when a point-in-time recognition date is missing", () => {
    expect(
      performanceObligationDisplayLabel({
        ...po(),
        recognitionMethod: "point_in_time",
        recognitionDate: "",
      }),
    ).toBe("Hosted SaaS Access");
  });

  it("never infers recognition dates from prose", () => {
    expect(
      performanceObligationDisplayLabel({
        ...po(),
        name: "Access from 7/1/2027 through 6/30/2028",
        serviceStart: "",
        serviceEnd: "",
        recognitionRationale: "Recognize from 7/1/2027 through 6/30/2028.",
      }),
    ).toBe("Access from 7/1/2027 through 6/30/2028");
  });

  it("uses only the assigned PO recognition facts for a promise", () => {
    const promise = {
      ...createPromiseDraft(4, "promise-4"),
      displayName: "Hosted SaaS Access",
      description: "Detailed interpretation mentioning 1/1/2030",
      performanceObligationId: "po-1",
    };
    const assigned = po();
    const other = {
      ...po(),
      id: "po-2",
      serviceStart: "2028-01-01",
      serviceEnd: "2028-12-31",
    };
    expect(promiseDisplayLabel(promise, [assigned, other])).toBe(
      "Hosted SaaS Access · 7/1/2027–6/30/2028",
    );
    expect(promiseDisplayLabel({ ...promise, performanceObligationId: null }, [assigned])).toBe(
      "Hosted SaaS Access",
    );
    expect(
      promiseDisplayLabel({ ...promise, performanceObligationId: "po-2" }, [assigned, other]),
    ).toBe("Hosted SaaS Access · 1/1/2028–12/31/2028");
  });

  it("falls back to sequence labels rather than detailed prose", () => {
    const promise = {
      ...createPromiseDraft(7, "promise-7"),
      description: "Long detailed interpretation",
      performanceObligationId: "po-1",
    };
    expect(promiseDisplayLabel(promise, [po()])).toBe("Promise 7 · 7/1/2027–6/30/2028");
    expect(performanceObligationDisplayLabel({ ...po(), name: "  " })).toBe(
      "Performance obligation 1 · 7/1/2027–6/30/2028",
    );
  });
});
