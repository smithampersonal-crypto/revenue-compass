/**
 * Phase 9G-R3 L — Checkpoint 3. An AI-proposed input method is a SUPPORTED R3
 * treatment: the canonical over-time classification plus an input measure of
 * progress. Both facts are merged through the provenance machinery, and an
 * accountant-owned measure of progress survives a re-analysis untouched.
 */
import { describe, expect, it } from "vitest";

import { createEmptyDraft, type WorkflowDraft } from "@/lib/asc606-workflow";

import { deriveCanonicalId, fieldKeys } from "../identity";
import {
  createEmptyAiAnalysisState,
  mergeAiAnalysis,
  type AiAnalysisState,
} from "../merge";
import type { AiContractAnalysis } from "../schema";
import { fixtureAAnalysis, guidancePackFixture, RUN_ID } from "./merge-fixtures";

const PO_ID = deriveCanonicalId("performance_obligation", "po:saas");
const RUN_2 = "run-00000000-0000-4000-8000-000000000002";

function inputMethodAnalysis(): AiContractAnalysis {
  const analysis = fixtureAAnalysis();
  analysis.recognitionProposals[0]!.recognitionMethod = "input_method";
  analysis.recognitionProposals[0]!.measureDescription = "Support hours actually delivered.";
  return analysis;
}

function run(
  analysis: AiContractAnalysis,
  currentDraft: WorkflowDraft = createEmptyDraft(),
  currentAiState: AiAnalysisState = createEmptyAiAnalysisState(),
  runId: string = RUN_ID,
) {
  return mergeAiAnalysis({
    currentDraft,
    currentAiState,
    analysis,
    runId,
    guidancePack: guidancePackFixture(),
    priorContext: null,
  });
}

describe("R3 — AI input-method recognition merge", () => {
  it("populates both canonical recognition facts", () => {
    const { draft } = run(inputMethodAnalysis());
    const po = draft.performanceObligations[0]!;
    expect(po.recognitionMethod).toBe("over_time_ratable");
    expect(po.overTimeMeasure).toBe("input_measure");
  });

  it("does not raise an unsupported recognition method item", () => {
    const { issues } = run(inputMethodAnalysis());
    expect(issues.some((item) => item.reasonCode === "unsupported_recognition_method")).toBe(false);
  });

  it("records the measure of progress as an AI-owned canonical field", () => {
    const { aiState } = run(inputMethodAnalysis());
    expect(aiState.fieldProvenance[fieldKeys.po(PO_ID, "overTimeMeasure")]?.state).toBe(
      "ai_generated_untouched",
    );
  });

  it("refreshes an untouched AI measure on re-analysis", () => {
    const first = run(inputMethodAnalysis());
    const second = run(fixtureAAnalysis(), first.draft, first.aiState, RUN_2);
    expect(second.draft.performanceObligations[0]!.overTimeMeasure).toBe("time_based");
  });

  it("never silently overwrites an accountant-owned measure of progress", () => {
    const first = run(inputMethodAnalysis());
    const edited: WorkflowDraft = {
      ...first.draft,
      performanceObligations: first.draft.performanceObligations.map((po) => ({
        ...po,
        overTimeMeasure: "time_based" as const,
      })),
    };
    const state: AiAnalysisState = {
      ...first.aiState,
      fieldProvenance: {
        ...first.aiState.fieldProvenance,
        [fieldKeys.po(PO_ID, "overTimeMeasure")]: {
          ...first.aiState.fieldProvenance[fieldKeys.po(PO_ID, "overTimeMeasure")]!,
          state: "ai_generated_user_edited",
        },
      },
    };
    const second = run(inputMethodAnalysis(), edited, state, RUN_2);
    expect(second.draft.performanceObligations[0]!.overTimeMeasure).toBe("time_based");
  });

  it("keeps time-based and point-in-time behaviour unchanged", () => {
    const timeBased = run(fixtureAAnalysis());
    expect(timeBased.draft.performanceObligations[0]!.recognitionMethod).toBe("over_time_ratable");
    expect(timeBased.draft.performanceObligations[0]!.overTimeMeasure).toBe("time_based");
    expect(timeBased.draft.performanceObligations[0]!.serviceStart).not.toBe("");

    const analysis = fixtureAAnalysis();
    analysis.recognitionProposals[0]!.recognitionMethod = "point_in_time_transfer";
    const pointInTime = run(analysis);
    expect(pointInTime.draft.performanceObligations[0]!.recognitionMethod).toBe("point_in_time");
  });

  it("keeps an output method fail-closed unsupported", () => {
    const analysis = fixtureAAnalysis();
    analysis.recognitionProposals[0]!.recognitionMethod = "output_method";
    const { draft, issues } = run(analysis);
    expect(draft.performanceObligations[0]!.recognitionMethod).toBeNull();
    expect(issues.some((item) => item.reasonCode === "unsupported_recognition_method")).toBe(true);
  });
});
