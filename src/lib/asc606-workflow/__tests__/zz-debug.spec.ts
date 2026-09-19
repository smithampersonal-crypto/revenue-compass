import { it } from "vitest";
import { genomixR3Draft } from "./genomix-r3-fixture";
import { analyzeWorkflow } from "../analysis";
it("debug", () => {
  const d = genomixR3Draft();
  const c = d.variableConsiderationComponents[0]!;
  const dec = {...d, variableConsiderationComponents:[{...c, effect:"decrease" as const, inception:{...c.inception, includedInput:"5,000.00", outcomes:[{id:"o1",seq:1,label:"x",amountInput:"5,000.00",probabilityInput:"100"}]}}]};
  const p:any = analyzeWorkflow(dec).progressive;
  console.log("state", p.state, "alloc?", !!p.allocation, "rec", p.recognition?.state, "vc", p.vc?.state, "bill", p.billing?.state, "bal", p.balances?.state, "jrn", p.journals?.state, "recon", p.reconciliation?.state);
  console.log("blocked", JSON.stringify(p.blocked));
  console.log("balval", JSON.stringify(p.balances?.validation?.blockingFailures ?? p.balances?.validation).slice(0,600));
  console.log("recon", JSON.stringify(p.reconciliation).slice(0,700));
});
