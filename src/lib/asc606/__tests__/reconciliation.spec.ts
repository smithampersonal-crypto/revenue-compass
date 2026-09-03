/**
 * Engine-produced reconciliation metadata tests.
 *
 * The engine is the sole authority on reconciliation arithmetic; the UI
 * displays these fields verbatim and never recomputes them.
 */

import { describe, expect, it } from "vitest";

import { analyzePhase1 } from "../index";
import { overTimePo, pointInTimePo } from "./fixtures";

describe("reconciliation metadata", () => {
  it("a valid analysis is reconciled with zero differences", () => {
    const analysis = analyzePhase1({
      transactionPriceCents: 12_000_000,
      performanceObligations: [
        overTimePo({ id: "saas", seq: 1, sspCents: 12_000_000, name: "SaaS" }),
      ],
    });
    expect(analysis.validation.status).toBe("passed");
    expect(analysis.reconciliation).toEqual({
      allocationDifferenceCents: 0,
      revenueDifferenceCents: 0,
      reconciled: true,
    });
  });

  it("a valid multi-PO analysis is reconciled with zero differences", () => {
    const analysis = analyzePhase1({
      transactionPriceCents: 12_000_000,
      performanceObligations: [
        overTimePo({ id: "saas", seq: 1, sspCents: 12_000_000, name: "SaaS" }),
        pointInTimePo({ id: "training", seq: 2, sspCents: 2_000_000, name: "Training" }),
      ],
    });
    expect(analysis.reconciliation.allocationDifferenceCents).toBe(0);
    expect(analysis.reconciliation.revenueDifferenceCents).toBe(0);
    expect(analysis.reconciliation.reconciled).toBe(true);
  });

  it("a blocked analysis returns null reconciliation fields", () => {
    const analysis = analyzePhase1({
      transactionPriceCents: 12_000_000,
      performanceObligations: [
        overTimePo({ id: "same", seq: 1, sspCents: 12_000_000, name: "SaaS" }),
        pointInTimePo({ id: "same", seq: 2, sspCents: 2_000_000, name: "Training" }),
      ],
    });
    expect(analysis.validation.status).toBe("attention");
    expect(analysis.allocation).toBeNull();
    expect(analysis.revenueSchedule).toBeNull();
    expect(analysis.reconciliation).toEqual({
      allocationDifferenceCents: null,
      revenueDifferenceCents: null,
      reconciled: null,
    });
  });
});
