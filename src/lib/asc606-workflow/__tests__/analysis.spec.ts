import { describe, expect, it } from "vitest";

import { formatCents } from "@/lib/asc606";
import { analyzeWorkflow, previewAllocation } from "../analysis";
import { scenarioADraft, scenarioBDraft } from "./fixtures";

const monthly = (result: ReturnType<typeof analyzeWorkflow>) =>
  result.analysis!.revenueSchedule!.byMonth.map((row) => formatCents(row.totalCents));

describe("Acceptance Scenario A — basic annual SaaS", () => {
  const result = analyzeWorkflow(scenarioADraft());

  it("finalizes and matches the expected allocation", () => {
    expect(result.step1Conclusion).toBe("qualified");
    expect(result.finalized).toBe(true);
    expect(result.analysis!.allocation!.map((r) => formatCents(r.allocatedCents))).toEqual([
      "$120,000.00",
    ]);
  });

  it("matches every expected month and total", () => {
    expect(monthly(result)).toEqual([
      "$10,191.78",
      "$9,205.48",
      "$10,191.78",
      "$9,863.01",
      "$10,191.79",
      "$9,863.01",
      "$10,191.78",
      "$10,191.78",
      "$9,863.01",
      "$10,191.79",
      "$9,863.01",
      "$10,191.78",
    ]);
    expect(formatCents(result.analysis!.revenueSchedule!.totalCents)).toBe("$120,000.00");
  });

  it("reconciles", () => {
    const rec = result.analysis!.reconciliation;
    expect(rec.allocationDifferenceCents).toBe(0);
    expect(rec.revenueDifferenceCents).toBe(0);
    expect(rec.reconciled).toBe(true);
  });
});

describe("Acceptance Scenario B — SaaS + training", () => {
  const result = analyzeWorkflow(scenarioBDraft());

  it("allocates on a relative SSP basis", () => {
    expect(result.analysis!.allocation!.map((r) => formatCents(r.allocatedCents))).toEqual([
      "$108,000.00",
      "$18,000.00",
    ]);
  });

  it("recognizes January over time and at a point in time", () => {
    const january = result.analysis!.revenueSchedule!.byMonth[0]!;
    expect(formatCents(january.perPo["po-saas"]!)).toBe("$9,172.60");
    expect(formatCents(january.perPo["po-training"]!)).toBe("$18,000.00");
    expect(formatCents(january.totalCents)).toBe("$27,172.60");
    expect(formatCents(result.analysis!.revenueSchedule!.totalCents)).toBe("$126,000.00");
    expect(result.analysis!.reconciliation.reconciled).toBe(true);
  });
});

describe("finalization gates", () => {
  it("blocks final engine output when a Step 1 criterion is No", () => {
    const draft = scenarioADraft();
    draft.contract.criteria["collectibility_probable"] = {
      answer: false,
      rationale: "Collection is not probable.",
    };
    const result = analyzeWorkflow(draft);
    expect(result.step1Conclusion).toBe("not_qualified");
    expect(result.finalized).toBe(false);
    expect(result.analysis).toBeNull();
    expect(result.blockedReason).toMatch(/does not qualify/i);
  });

  it("blocks final engine output when the workflow has blocking issues", () => {
    const draft = scenarioADraft();
    draft.promises[0]!.capableOfBeingDistinct = null;
    const result = analyzeWorkflow(draft);
    expect(result.finalized).toBe(false);
    expect(result.analysis).toBeNull();
    expect(result.workflowValidation.blocking.length).toBeGreaterThan(0);
  });
});

describe("Step 4 allocation preview", () => {
  it("uses the engine allocation when SSP inputs are complete", () => {
    const preview = previewAllocation(scenarioBDraft());
    expect(preview.rows!.map((r) => formatCents(r.allocatedCents))).toEqual([
      "$108,000.00",
      "$18,000.00",
    ]);
    expect(formatCents(preview.totalAllocatedCents!)).toBe("$126,000.00");
  });

  it("returns no rows when SSP data is incomplete", () => {
    const draft = scenarioBDraft();
    draft.performanceObligations[0]!.sspInput = "";
    const preview = previewAllocation(draft);
    expect(preview.rows).toBeNull();
    expect(preview.issues.length).toBeGreaterThan(0);
  });
});
