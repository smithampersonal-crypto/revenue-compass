/**
 * Targeted series / variable-consideration consistency cleanup.
 *
 * A series-period allocation conclusion presupposes that the targeted
 * performance obligation is itself classified as a series. ARC never corrects
 * either judgment: it surfaces the contradiction deterministically and clears
 * it as soon as the accountant resolves it in any valid way.
 */

import { describe, expect, it } from "vitest";

import { analysisStatus } from "@/components/arc/analysis-status";

import { analyzeWorkflow } from "../analysis";
import { validateWorkflow } from "../validation";
import type { PoDraft, WorkflowDraft } from "../types";
import { genomixR3Draft } from "./genomix-r3-fixture";

const NOT_SERIES = "vc.series_period.target_not_series";
const NO_TARGET = "vc.series_period.target_missing";

const issueIds = (draft: WorkflowDraft) => validateWorkflow(draft).warnings.map((i) => i.id);

/** Reclassifies one performance obligation, leaving every identity intact. */
function classify(draft: WorkflowDraft, poId: string, classification: PoDraft["classification"]) {
  return {
    ...draft,
    performanceObligations: draft.performanceObligations.map((po) =>
      po.id === poId ? { ...po, classification } : po,
    ),
  };
}

function patchVc(draft: WorkflowDraft, id: string, values: Partial<WorkflowDraft["variableConsiderationComponents"][number]>) {
  return {
    ...draft,
    variableConsiderationComponents: draft.variableConsiderationComponents.map((c) =>
      c.id === id ? { ...c, ...values } : c,
    ),
  };
}

/** The fresh guest Genomix state: hosted SaaS concluded single distinct. */
function genomixInconsistent(): WorkflowDraft {
  return classify(genomixR3Draft(), "po-hosted", "single_distinct");
}

describe("series-period variable consideration consistency", () => {
  it("is silent when the target performance obligation is a series", () => {
    expect(issueIds(genomixR3Draft())).not.toContain(NOT_SERIES);
    expect(issueIds(genomixR3Draft())).not.toContain(NO_TARGET);
  });

  it("Genomix fresh-guest state: series-period VC targeting a non-series PO raises the issue", () => {
    const issues = validateWorkflow(genomixInconsistent()).warnings;
    const issue = issues.find((i) => i.id === NOT_SERIES);
    expect(issue).toBeDefined();
    expect(issue!.step).toBe("3");
    expect(issue!.message).toContain("Series allocation conclusion requires review");
    expect(issue!.message).toContain("Hosted SaaS platform");
  });

  it("raises a targeted issue when no target performance obligation is linked", () => {
    const draft = patchVc(genomixR3Draft(), "vc-sla", { targetPoId: null });
    const issue = validateWorkflow(draft).warnings.find((i) => i.id === NO_TARGET);
    expect(issue).toBeDefined();
    expect(issue!.message).toContain("no target performance obligation is currently linked");
  });

  it("clears when the target performance obligation is reclassified as a series", () => {
    const resolved = classify(genomixInconsistent(), "po-hosted", "series");
    expect(issueIds(resolved)).not.toContain(NOT_SERIES);
  });

  it("clears when the allocation treatment moves away from series-period", () => {
    const resolved = patchVc(genomixInconsistent(), "vc-sla", {
      allocationTreatment: "general",
      targetPoId: null,
    });
    expect(issueIds(resolved)).not.toContain(NOT_SERIES);
    expect(issueIds(resolved)).not.toContain(NO_TARGET);
  });

  it("clears when another eligible series obligation is selected", () => {
    const withSeries = classify(genomixInconsistent(), "po-support", "series");
    const resolved = patchVc(withSeries, "vc-sla", { targetPoId: "po-support" });
    expect(issueIds(resolved)).not.toContain(NOT_SERIES);
  });

  it("leaves unrelated allocation treatments unaffected", () => {
    const general = patchVc(genomixInconsistent(), "vc-sla", {
      allocationTreatment: "general",
      targetPoId: null,
    });
    const specificPo = patchVc(genomixInconsistent(), "vc-sla", {
      allocationTreatment: "specific_po",
    });
    for (const draft of [general, specificPo]) {
      expect(issueIds(draft)).not.toContain(NOT_SERIES);
      expect(issueIds(draft)).not.toContain(NO_TARGET);
    }
  });

  it("never changes a canonical identity or relationship", () => {
    const before = genomixInconsistent();
    const snapshot = JSON.stringify(before);
    validateWorkflow(before);
    analyzeWorkflow(before);
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(before.variableConsiderationComponents[0]!.targetPoId).toBe("po-hosted");
    expect(
      before.performanceObligations.find((po) => po.id === "po-hosted")!.classification,
    ).toBe("single_distinct");
  });

  it("Review & Finalize cannot imply completeness while the inconsistency stands", () => {
    const result = analyzeWorkflow(genomixInconsistent());
    expect(result.workflowValidation.warnings.some((i) => i.id === NOT_SERIES)).toBe(true);
    const status = analysisStatus(result);
    expect(status.tone).not.toBe("ok");
    expect(status.headline).toBe("Series allocation conclusion requires review");
  });

  it("leaves unrelated determinable outputs available", () => {
    const result = analyzeWorkflow(genomixInconsistent());
    // The contradiction never suppresses unrelated deterministic accounting.
    expect(result.step1Conclusion).toBe("qualified");
    expect(result.adapterErrors).toEqual([]);
    expect(result.workflowValidation.blocking).toEqual([]);
  });
});
