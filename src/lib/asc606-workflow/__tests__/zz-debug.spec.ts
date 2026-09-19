import { it } from "vitest";
import { genomixR3Draft } from "./genomix-r3-fixture";
import { analyzeWorkflow } from "../analysis";
it("debug", () => {
  const d = genomixR3Draft();
  const c = d.variableConsiderationComponents[0]!;
  const dec = {...d, variableConsiderationComponents:[{...c, effect:"decrease" as const, inception:{...c.inception, includedInput:"5,000.00", outcomes:[{id:"o1",seq:1,label:"x",amountInput:"5,000.00",probabilityInput:"100"}]}}]};
  const p:any = analyzeWorkflow(dec).progressive;
  console.log(JSON.stringify(p.reconciliation.failures ?? p.reconciliation.issues ?? Object.keys(p.reconciliation)));
  console.log("pending", JSON.stringify(p.recognition.pending));
  console.log("byPo", JSON.stringify(p.recognition.byPo));
});
