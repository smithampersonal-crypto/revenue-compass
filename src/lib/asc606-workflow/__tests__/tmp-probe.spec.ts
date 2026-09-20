import { describe, expect, it } from "vitest";
import { analyzeWorkflow } from "../analysis";
import { buildFinalizationSnapshot, buildWorkpaper } from "@/lib/arc/persistence/snapshot";
import {
  genomixR3Draft,
  withRealizedCredit,
  withSupportHours,
  withUsageActual,
  withValidationTransfer,
} from "./genomix-r3-fixture";
import type { WorkflowDraft } from "../types";

function resolved(): WorkflowDraft {
  let d = withValidationTransfer(genomixR3Draft(), "2027-03-15");
  d = withSupportHours(d, [
    { id: "po-support-pe-1", seq: 1, date: "2027-01-31", unitsInput: "150" },
    { id: "po-support-pe-2", seq: 2, date: "2028-10-31", unitsInput: "150" },
  ]);
  d = withUsageActual(d, "2027-02", "500");
  d = withRealizedCredit(d, "1,500.00", "y1", "2027-04-30");
  return d;
}

describe("probe", () => {
  it("resolved", () => {
    const d = resolved();
    const r = analyzeWorkflow(d);
    console.log("state", r.progressive?.state, "finalized", r.finalized, r.blockedReason);
    console.log("blocked", JSON.stringify(r.progressiveBlocked));
    console.log("recon", JSON.stringify(r.progressive?.reconciliation));
    console.log("billing state", r.progressive?.billing?.state);
    console.log("billing pending", JSON.stringify(r.progressive?.billing?.pendingRules));
    console.log("billing events", JSON.stringify(r.progressive?.billing?.events));
    const wp = buildWorkpaper(d);
    console.log("balances finalized", wp.balances.finalized);
    console.log(
      "balance blocking",
      JSON.stringify(wp.balances.validation?.blocking?.map((i: { message: string }) => i.message)),
    );
    const snap = buildFinalizationSnapshot(d);
    console.log("snapshot ok", snap.ok, JSON.stringify(snap.ok ? "ok" : snap.issues));
    expect(true).toBe(true);
  });
});
