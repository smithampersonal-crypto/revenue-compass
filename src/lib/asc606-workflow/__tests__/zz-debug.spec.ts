import { it } from "vitest";
import { genomixR3Draft, withValidationTransfer, withSupportHours, withRealizedCredit } from "./genomix-r3-fixture";
import { analyzeWorkflow } from "../analysis";
it("debug", () => {
  const r = analyzeWorkflow(genomixR3Draft());
  const p:any = r.progressive;
  console.log("allocation", JSON.stringify(p.allocation).slice(0,600));
  console.log("billing", JSON.stringify(p.billing).slice(0,500));
  console.log("balances", JSON.stringify(Object.keys(p.balances??{})), p.balances?.partial, p.balances?.pendingCents);
  console.log("journals", JSON.stringify(Object.keys(p.journals??{})));
  console.log("recon", JSON.stringify(p.reconciliation).slice(0,600));
  const t:any = analyzeWorkflow(withValidationTransfer(genomixR3Draft(), "2027-03-31")).progressive;
  console.log("T sched", t.recognition.schedule.totalCents, JSON.stringify(t.recognition.pending.map((x:any)=>x.poId)));
  const s:any = analyzeWorkflow(withSupportHours(genomixR3Draft(), [{id:"pe1",seq:1,date:"2027-02-28",unitsInput:"50"}])).progressive;
  console.log("S sched", s.recognition.schedule.totalCents, JSON.stringify(s.recognition.pending.map((x:any)=>[x.poId,x.amountCents])));
  const c:any = analyzeWorkflow(withRealizedCredit(genomixR3Draft(), "5,000.00", "q2", "2027-06-30")).progressive;
  console.log("C", c.state, JSON.stringify(c.vc?.layers ?? c.vc).slice(0,600));
  console.log("C sched", c.recognition.schedule.totalCents, JSON.stringify(c.recognition.byPo?.map?.((x:any)=>[x.poId,x.allocatedCents])));
});
