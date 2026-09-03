/**
 * Workflow protection: a transient small-year recognition date blocks the
 * workflow instead of driving a 2,000-year month enumeration.
 */

import { describe, expect, it } from "vitest";
import { createDemoDraft } from "@/lib/demo-scenarios";
import { analyzeWorkflow } from "@/lib/asc606-workflow";

describe("recognition period supported range", () => {
  it("blocks a transient 0002 service start and recovers when corrected", () => {
    const draft = createDemoDraft("redwood");
    const po = draft.performanceObligations[0]!;
    po.serviceStart = "0002-01-01";
    po.serviceEnd = "2027-12-31";

    let called = false;
    const blockedResult = analyzeWorkflow(draft, {
      analyze: (input) => {
        called = true;
        throw new Error("engine must not be invoked for an unsupported horizon");
      },
    });

    expect(called).toBe(false);
    expect(blockedResult.finalized).toBe(false);
    expect(blockedResult.analysis).toBeNull();
    expect(
      blockedResult.workflowValidation.blocking.some(
        (i) => i.id === "accounting_horizon.supported_range",
      ),
    ).toBe(true);

    po.serviceStart = "2027-01-01";
    const restored = analyzeWorkflow(draft);
    expect(restored.finalized).toBe(true);
    expect(restored.analysis?.revenueSchedule?.totalCents).toBe(120_000_00);
    expect(restored.analysis?.revenueSchedule?.byMonth[0]?.totalCents).toBe(10_191_78);
  });
});
