import { it } from "vitest";
import { genomixR3Draft } from "./genomix-r3-fixture";
import { previewVcMeasurement } from "../vc-measurement";
it("debug", () => {
  const c = genomixR3Draft().variableConsiderationComponents[0]!;
  const m = previewVcMeasurement({...c, allocationTreatment:"specific_po", effect:"increase", inception:{...c.inception, includedInput:"10,000.00", outcomes:[{id:"o1",seq:1,label:"a",amountInput:"40,000.00",probabilityInput:"60"},{id:"o2",seq:2,label:"b",amountInput:"0.00",probabilityInput:"40"}]}} as any);
  console.log(JSON.stringify(m));
});
