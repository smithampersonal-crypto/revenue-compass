/**
 * Series consistency finalization acceptance patch.
 *
 * The series-period consistency findings stay ordinary workflow warnings so
 * unrelated deterministic accounting remains available, but no immutable
 * snapshot may be recorded while one stands. The client gate and the
 * authoritative server path both use the same pure helper.
 */

import { describe, expect, it } from "vitest";

import {
  analyzeWorkflow,
  finalizationBlockingWorkflowWarnings,
  validateWorkflow,
  type PoDraft,
  type WorkflowDraft,
  type WorkflowIssue,
} from "@/lib/asc606-workflow";
import {
  genomixR3Draft,
  withSupportHours,
  withValidationTransfer,
} from "@/lib/asc606-workflow/__tests__/genomix-r3-fixture";

import { buildFinalizationSnapshot } from "../snapshot";
import { finalizeGate } from "../revision-history";
import type { SaveStatus } from "../save-status";

const SAVED = { kind: "saved" } as SaveStatus;
const COPY = "Series allocation conclusion requires review";

/** A complete Genomix analysis: every obligation has transferred or progressed. */
function completeGenomix(): WorkflowDraft {
  return withSupportHours(withValidationTransfer(genomixR3Draft(), "2027-02-01"), [
    { id: "support-1", seq: 1, date: "2027-06-30", unitsInput: "200" },
  ]);
}

function classify(draft: WorkflowDraft, poId: string, classification: PoDraft["classification"]) {
  return {
    ...draft,
    performanceObligations: draft.performanceObligations.map((po) =>
      po.id === poId ? { ...po, classification } : po,
    ),
  };
}

function patchVc(
  draft: WorkflowDraft,
  id: string,
  values: Partial<WorkflowDraft["variableConsiderationComponents"][number]>,
) {
  return {
    ...draft,
    variableConsiderationComponents: draft.variableConsiderationComponents.map((c) =>
      c.id === id ? { ...c, ...values } : c,
    ),
  };
}

/** The persisted fresh-guest state: the series-period target is single distinct. */
function inconsistent(): WorkflowDraft {
  return classify(completeGenomix(), "po-hosted", "single_distinct");
}

/** Exactly the client gate the revision lifecycle panel builds. */
function clientGate(draft: WorkflowDraft) {
  const result = analyzeWorkflow(draft);
  return finalizeGate({
    persistenceEnabled: true,
    status: SAVED,
    revisionStatus: "draft",
    engineFinalized: true,
    workpaperComplete: true,
    lockVersion: 1,
    finalizationBlockingWarnings: finalizationBlockingWorkflowWarnings(result.workflowValidation),
  });
}

describe("series-period consistency holds finalization only", () => {
  it("the client offers no enabled Finalize action while the target is not a Series", () => {
    const gate = clientGate(inconsistent());
    expect(gate.canFinalize).toBe(false);
    if (gate.canFinalize) return;
    expect(gate.reason).toContain(COPY);
  });

  it("the server finalization path independently rejects the same persisted draft", () => {
    const outcome = buildFinalizationSnapshot(inconsistent());
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.issues.some((message) => message.includes(COPY))).toBe(true);
  });

  it("a missing series-period target also blocks finalization on both paths", () => {
    const draft = patchVc(completeGenomix(), "vc-sla", { targetPoId: "" });
    const gate = clientGate(draft);
    expect(gate.canFinalize).toBe(false);
    const outcome = buildFinalizationSnapshot(draft);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.issues.some((message) => message.includes(COPY))).toBe(true);
  });

  it("unrelated workflow warnings never become finalization blockers", () => {
    const unrelated: WorkflowIssue[] = [
      { id: "some.other.warning", step: "2a", severity: "warning", message: "Unrelated." },
    ];
    expect(
      finalizationBlockingWorkflowWarnings({ issues: unrelated, warnings: unrelated } as never),
    ).toEqual([]);

    // And on a real draft that carries no consistency finding at all.
    const clean = analyzeWorkflow(completeGenomix());
    expect(finalizationBlockingWorkflowWarnings(clean.workflowValidation)).toEqual([]);
    expect(clientGate(completeGenomix()).canFinalize).toBe(true);
  });

  it("classifying the target as a Series restores finalization eligibility", () => {
    const resolved = classify(inconsistent(), "po-hosted", "series");
    expect(clientGate(resolved).canFinalize).toBe(true);
    expect(buildFinalizationSnapshot(resolved).ok).toBe(true);
  });

  it("changing the allocation treatment restores finalization eligibility", () => {
    const resolved = patchVc(inconsistent(), "vc-sla", {
      allocationTreatment: "entire_contract",
      targetPoId: "",
    });
    expect(
      finalizationBlockingWorkflowWarnings(analyzeWorkflow(resolved).workflowValidation),
    ).toEqual([]);
    expect(clientGate(resolved).canFinalize).toBe(true);
  });

  it("keeps the findings ordinary warnings, so deterministic outputs stay available", () => {
    const draft = inconsistent();
    const validation = validateWorkflow(draft);
    expect(validation.blocking).toEqual([]);
    expect(validation.warnings.some((issue) => issue.id.startsWith("vc.series_period."))).toBe(
      true,
    );

    const result = analyzeWorkflow(draft);
    expect(result.step1Conclusion).toBe("qualified");
    expect(result.adapterErrors).toEqual([]);
    expect(result.performanceObligations ?? draft.performanceObligations).toBeTruthy();
  });
});
