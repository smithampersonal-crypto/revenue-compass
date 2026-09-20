import { describe, expect, it } from "vitest";
import { analyzeWorkflow } from "../analysis";
import { genomixR3Draft, withUsageActual } from "./genomix-r3-fixture";

describe("probe", () => {
  it("inception", () => {
    const r = analyzeWorkflow(genomixR3Draft());
    console.log("adapterErrors", r.adapterErrors);
    console.log("blockedReason", r.blockedReason);
    console.log("progressiveBlocked", JSON.stringify(r.progressiveBlocked, null, 1));
    console.log("allocation", JSON.stringify(r.progressive?.allocation));
    console.log("state", r.progressive?.state);
    console.log("usageAmounts", JSON.stringify(r.progressive?.usageAmounts));
    console.log("billing", JSON.stringify(r.progressive?.billing)?.slice(0, 1200));
    console.log("journals?", r.progressive?.journals !== null);
    console.log("balances?", r.progressive?.balances !== null);
    console.log("recognition total", r.progressive?.recognition?.schedule.totalCents);
    console.log("gate", JSON.stringify(r.progressiveGate));
    expect(true).toBe(true);
  });
  it("usage", () => {
    const r = analyzeWorkflow(withUsageActual(genomixR3Draft(), "2027-02", "500"));
    console.log("U blocked", r.blockedReason, JSON.stringify(r.progressiveBlocked));
    console.log("U usageAmounts", JSON.stringify(r.progressive?.usageAmounts));
    console.log("U total", r.progressive?.recognition?.schedule.totalCents);
    expect(true).toBe(true);
  });
});
