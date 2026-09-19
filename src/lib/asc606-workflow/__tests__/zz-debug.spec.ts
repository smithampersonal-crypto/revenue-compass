import { it } from "vitest";
import { genomixR3Draft } from "./genomix-r3-fixture";
import { analyzeWorkflow } from "../analysis";
it("debug", () => {
  const r = analyzeWorkflow(genomixR3Draft());
  console.log("blocked", r.blockedReason, JSON.stringify(r.workflowValidation.blocking.map(b=>b.id)));
  console.log("adapter", JSON.stringify(r.adapterErrors));
  console.log("progressiveBlocked", JSON.stringify(r.progressiveBlocked));
  console.log("alloc", JSON.stringify(r.allocation?.rows?.map((x:any)=>[x.poId,x.allocatedCents])));
  console.log("sched", r.revenueSchedule?.totalCents, "unsched", r.unscheduledRevenueCents);
  console.log("state", r.progressive?.state, JSON.stringify(r.progressive?.recognition?.pending));
});
