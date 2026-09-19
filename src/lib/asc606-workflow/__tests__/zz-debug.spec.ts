import { it } from "vitest";
import { genomixR3Draft, withRealizedCredit } from "./genomix-r3-fixture";
import { analyzeWorkflow } from "../analysis";
it("debug", () => {
  const c:any = analyzeWorkflow(withRealizedCredit(genomixR3Draft(), "5,000.00", "q2", "2027-06-30")).progressive;
  console.log("state", c.state, JSON.stringify(c.blocked));
  console.log("balances", c.balances?.state, JSON.stringify(c.balances?.validation).slice(0,500));
  console.log("journals", c.journals?.state, JSON.stringify(c.journals?.analysis?.validation ?? "").slice(0,400));
  console.log("recon", JSON.stringify(c.reconciliation).slice(0,400));
});
