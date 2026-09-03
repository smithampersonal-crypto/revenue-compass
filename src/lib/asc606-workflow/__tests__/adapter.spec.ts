import { describe, expect, it } from "vitest";

import { buildPhase1Input } from "../adapter";
import { scenarioADraft, scenarioBDraft } from "./fixtures";

describe("workflow → engine adapter", () => {
  it("converts a complete draft exactly", () => {
    const result = buildPhase1Input(scenarioADraft());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input).toEqual({
      customerName: "Redwood Retail",
      contractNumber: "CASE-1",
      transactionPriceCents: 12_000_000,
      performanceObligations: [
        {
          id: "po-saas",
          seq: 1,
          name: "SaaS subscription",
          sspCents: 12_000_000,
          sspBasis: "Observable standalone renewal pricing.",
          classification: "single_distinct",
          classificationRationale: "Single distinct hosted service.",
          recognitionMethod: "over_time_ratable",
          serviceStart: "2027-01-01",
          serviceEnd: "2027-12-31",
          overTimeConvention: "daily_ratable",
        },
      ],
      promises: [
        {
          id: "pr-saas",
          seq: 1,
          description: "Annual hosted SaaS service",
          capableOfBeingDistinct: true,
          distinctWithinContractContext: true,
          distinctRationale: "Benefit available on its own; not significantly integrated.",
          performanceObligationId: "po-saas",
        },
      ],
    });
  });

  it("maps point-in-time performance obligations without service dates", () => {
    const result = buildPhase1Input(scenarioBDraft());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const training = result.input.performanceObligations[1]!;
    expect(training.recognitionMethod).toBe("point_in_time");
    expect(training.recognitionDate).toBe("2027-01-15");
    expect(training.serviceStart).toBeUndefined();
    expect(training.serviceEnd).toBeUndefined();
    expect(training.overTimeConvention).toBeUndefined();
  });

  it("never manufactures zeros or defaults for incomplete data", () => {
    const draft = scenarioADraft();
    draft.transactionPriceInput = "";
    draft.performanceObligations[0]!.sspInput = "";
    draft.performanceObligations[0]!.recognitionMethod = null;
    const result = buildPhase1Input(draft);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain("Cents\":0");
  });
});
