import { it } from "vitest";
import { createDemoDraft } from "@/lib/demo-scenarios";
import { validateWorkflow } from "@/lib/asc606-workflow/validation";
it("dbg", () => {
  const v = validateWorkflow(createDemoDraft("meridian"));
  console.log(JSON.stringify(v.blocking, null, 1));
});
