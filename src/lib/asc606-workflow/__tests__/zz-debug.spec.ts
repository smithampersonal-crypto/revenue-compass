import { it } from "vitest";
import { payAsYouGoDraft, cloudAiDraft } from "/dev-server/src/lib/asc606-workflow/__tests__/vc-fixtures";
import { draftRequiresProgressive } from "/dev-server/src/lib/asc606-workflow/r3-adapter";
import { analyzeWorkflow } from "/dev-server/src/lib/asc606-workflow/analysis";
it("debug", () => {
  for (const d of [payAsYouGoDraft(), cloudAiDraft()]) {
    console.log(draftRequiresProgressive(d), JSON.stringify(d.performanceObligations.map(p=>[p.recognitionMethod,p.overTimeMeasure,p.transferStatus,(p.progressEvents??[]).length])), JSON.stringify(d.variableConsiderationComponents.map(c=>[c.treatment,c.allocationTreatment,(c.realizedEvents??[]).length])));
    const r = analyzeWorkflow(d);
    console.log(r.finalized, r.blockedReason, r.workflowValidation.blocking.map(b=>b.id));
  }
});
