import { it } from "vitest";
import { createDemoDraft } from "@/lib/demo-scenarios";
import { analyzeContractBalanceWorkflow } from "@/lib/asc606-workflow";
it("dbg", () => {
  const r: any = analyzeContractBalanceWorkflow(createDemoDraft("meridian"));
  console.log(JSON.stringify(r.issues ?? r.validation ?? r, null, 1).slice(0, 3000));
});
