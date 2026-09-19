import { it } from "vitest";
import { genomixR3Draft, withRealizedCredit } from "./genomix-r3-fixture";
import { analyzeWorkflow } from "../analysis";
it("debug", () => {
  const w:any = analyzeWorkflow(withRealizedCredit(genomixR3Draft(), "5,000.00", "q2", "2027-06-30"));
  console.log("blockedReason", w.blockedReason, JSON.stringify(w.progressiveBlocked), JSON.stringify(w.adapterErrors), JSON.stringify(w.workflowValidation.blocking.map((b:any)=>b.id)));
});
