import { describe, expect, it } from "vitest";
import { createDemoDraftIfKnown, DEMO_SCENARIOS } from "@/lib/demo-scenarios";
import { buildFinalizationSnapshot } from "@/lib/arc/persistence/snapshot";
describe("probe", () => {
  it("lists", () => {
    for (const s of DEMO_SCENARIOS as any[]) {
      const d = createDemoDraftIfKnown(s.id);
      const o = d ? buildFinalizationSnapshot(d) : null;
      const vcs = d?.variableConsiderationComponents.map((c:any)=>[c.id,c.allocationTreatment,c.targetPoId]) ?? [];
      console.log(s.id, o?.ok, JSON.stringify(vcs), JSON.stringify(d?.performanceObligations.map((p:any)=>[p.id,p.classification])));
    }
    expect(true).toBe(true);
  });
});
