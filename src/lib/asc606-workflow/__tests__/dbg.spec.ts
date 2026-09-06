import { it } from "vitest";
import { analyzeWorkflow } from "../analysis";
import { debugRepriced } from "./modification-journals.spec";
it("dbg", () => {
  const r = analyzeWorkflow(debugRepriced());
  console.log(r.modification?.totals);
  console.log(r.modification?.catchUpEvents.map((e) => [e.month, e.amountCents]));
  console.log(r.revenueSchedule?.byMonth.map((m: any) => [m.month, m.amountCents]));
});
