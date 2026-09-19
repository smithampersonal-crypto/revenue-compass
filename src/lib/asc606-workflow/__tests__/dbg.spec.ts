import { describe, it } from "vitest";
import { analyzeWorkflow } from "@/lib/asc606-workflow/analysis";
import { genomixR3Draft, } from "@/lib/asc606-workflow/__tests__/genomix-r3-fixture";
import { createVcComponentDraft, type WorkflowDraft } from "@/lib/asc606-workflow/types";
function usageOnlyDraft(quantities: Record<string,string>): WorkflowDraft {
  const base = genomixR3Draft();
  const hosted = base.performanceObligations.find((po) => po.id === "po-hosted")!;
  const component = createVcComponentDraft(1, "vc-usage", "usage_as_incurred");
  return { ...base, performanceObligations: [{ ...hosted, progressEvents: [] }],
    promises: base.promises.filter((p) => p.performanceObligationId === "po-hosted"),
    hasVariableConsideration: true,
    variableConsiderationComponents: [{ ...component, description: "Overage", effect: "increase", allocationTreatment: "general", targetPoId: "po-hosted",
      meters: [{ id:"m1", seq:1, name:"API", rateAmountInput:"1.00", rateQuantityInput:"100", unit:"calls", includedQuantityInput:"50" }],
      seriesPeriods: [], realizedEvents: [], billOnRealization: false,
      usagePeriods: [{ id:"up-1", seq:1, month:"2027-03", quantities }] }] };
}
describe("dbg", () => { it("x", () => {
  const w = analyzeWorkflow(usageOnlyDraft({ m1: "1000" }));
  console.log(JSON.stringify(w.progressiveBlocked, null, 1));
  console.log(JSON.stringify(w.progressiveGate, null, 1));
}); });
