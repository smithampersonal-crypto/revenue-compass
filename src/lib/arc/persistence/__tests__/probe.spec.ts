import { describe, expect, it } from "vitest";
import { createDemoDraftIfKnown } from "@/lib/demo-scenarios";
import { createVcComponentDraft, type WorkflowDraft } from "@/lib/asc606-workflow";
import { buildFinalizationSnapshot } from "@/lib/arc/persistence/snapshot";

function withSla(classification: string): WorkflowDraft {
  const base = createDemoDraftIfKnown("horizon")!;
  const c = createVcComponentDraft(1, "vc-sla", "estimated");
  const sla = {
    ...c,
    description: "Service-level credit",
    effect: "decrease" as const,
    estimationMethod: "most_likely_amount" as const,
    allocationTreatment: "specific_series_period" as const,
    targetPoId: "po-saas",
    relatesSpecifically: true,
    consistentWithAllocationObjective: true,
    allocationRationale: "The credit relates specifically to the quarter whose service level was missed, so allocating it to that distinct service period meets the allocation objective.",
    inception: {
      ...c.inception,
      effectiveDate: "2025-01-01",
      includedInput: "0.00",
      constraintRationale: "No service level has been missed and none is expected, so the most likely amount of credit at inception is nil.",
      outcomes: [{ id: "o1", seq: 1, description: "No failure", amountInput: "0.00", probabilityInput: "100", isMostLikely: true }],
    },
    seriesPeriods: [{ id: "q1", seq: 1, label: "Q1", startDate: "2025-01-01", endDate: "2025-03-31" }],
    realizedEvents: [],
    billOnRealization: true,
  };
  return {
    ...base,
    hasVariableConsideration: true,
    variableConsiderationComponents: [sla as any],
    performanceObligations: base.performanceObligations.map((p) =>
      p.id === "po-saas" ? { ...p, classification: classification as any } : p),
  };
}

describe("probe", () => {
  it("x", () => {
    for (const k of ["single_distinct", "series"]) {
      const o = buildFinalizationSnapshot(withSla(k));
      console.log(k, o.ok, o.ok ? "" : JSON.stringify(o.issues));
    }
    expect(true).toBe(true);
  });
});
