import { describe, expect, it } from "vitest";
import { analyzeWorkflow } from "@/lib/asc606-workflow";
import { buildFinalizationSnapshot } from "@/lib/arc/persistence/snapshot";
import { genomixR3Draft, withValidationTransfer, withSupportHours } from "@/lib/asc606-workflow/__tests__/genomix-r3-fixture";

function variant(cls: string) {
  const base = withSupportHours(withValidationTransfer(genomixR3Draft(), "2027-02-01"), [
    { id: "e1", seq: 1, date: "2027-06-30", unitsInput: "200" },
  ]);
  return { ...base, performanceObligations: base.performanceObligations.map((p) => p.id === "po-hosted" ? { ...p, classification: cls as any } : p) };
}
describe("probe", () => {
  it("x", () => {
    for (const k of ["single_distinct", "series"]) {
      const d = variant(k);
      const w = analyzeWorkflow(d);
      const o = buildFinalizationSnapshot(d);
      console.log(k, "finalized=", w.finalized, "blocking=", JSON.stringify(w.workflowValidation.blocking.map(i=>i.id)), "warn=", JSON.stringify(w.workflowValidation.warnings.map(i=>i.id)), "snap=", o.ok, o.ok?"":JSON.stringify(o.issues).slice(0,300));
    }
    expect(true).toBe(true);
  });
});
