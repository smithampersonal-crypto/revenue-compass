import { it } from "vitest";
import { accountantState } from "./genomix-fixtures";
it("dbg", () => {
  const { draft, aiState } = accountantState();
  console.log("EV", draft.contractBalances.considerationEvents.length, draft.contractBalances.cashCollections.length, Object.values(aiState.objectProvenance).filter(e=>e.canonicalId.startsWith("ce-")).map(e=>e.derivation));
});
