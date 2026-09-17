/**
 * Phase 9G — Task 4. Re-analysis compatibility.
 *
 * A Task 4 edit must strengthen the existing merge behaviour, not bypass it:
 * the same merge engine, running later, has to honour the ownership and the
 * tombstones autosave recorded.
 */
import { describe, expect, it } from "vitest";

import { createEmptyDraft } from "@/lib/asc606-workflow";

import { reconcileAiEdits } from "../edit-reconciliation";
import { fieldKeys } from "../identity";
import { createEmptyAiAnalysisState, mergeAiAnalysis } from "../merge";
import { fixtureAAnalysis, guidancePackFixture, RUN_ID } from "./merge-fixtures";

function firstRun() {
  return mergeAiAnalysis({
    currentDraft: createEmptyDraft(),
    currentAiState: createEmptyAiAnalysisState(),
    analysis: fixtureAAnalysis(),
    runId: RUN_ID,
    guidancePack: guidancePackFixture(),
    priorContext: null,
  });
}

function reanalyze(
  draft: Parameters<typeof mergeAiAnalysis>[0]["currentDraft"],
  state: ReturnType<typeof firstRun>["aiState"],
) {
  return mergeAiAnalysis({
    currentDraft: draft,
    currentAiState: state,
    analysis: fixtureAAnalysis(),
    runId: "run-2",
    guidancePack: guidancePackFixture(),
    priorContext: null,
  });
}

describe("re-analysis after an autosave edit", () => {
  it("preserves a scalar the accountant took ownership of at autosave", () => {
    const first = firstRun();
    const edited = { ...first.draft, transactionPriceInput: "999999" };
    const reconciled = reconcileAiEdits({
      previousDraft: first.draft,
      nextDraft: edited,
      currentAiState: first.aiState,
    });
    expect(reconciled.aiState.fieldProvenance[fieldKeys.transactionPrice("input")]!.state).toBe(
      "ai_generated_user_edited",
    );

    const second = reanalyze(edited, reconciled.aiState);
    expect(second.draft.transactionPriceInput).toBe("999999");
  });

  it("never recreates an AI object the accountant deleted", () => {
    const first = firstRun();
    const withoutPromises = { ...first.draft, promises: [] };
    const reconciled = reconcileAiEdits({
      previousDraft: first.draft,
      nextDraft: withoutPromises,
      currentAiState: first.aiState,
    });
    expect(reconciled.aiState.tombstones.length).toBeGreaterThan(0);

    const second = reanalyze(withoutPromises, reconciled.aiState);
    expect(second.draft.promises).toEqual([]);
  });

  it("keeps a user-modified AI object as the accountant left it", () => {
    const first = firstRun();
    const edited = structuredClone(first.draft);
    edited.performanceObligations[0]!.recognitionMethod = "point_in_time";
    edited.performanceObligations[0]!.recognitionDate = "2027-01-01";
    edited.performanceObligations[0]!.serviceStart = "";
    edited.performanceObligations[0]!.serviceEnd = "";

    const reconciled = reconcileAiEdits({
      previousDraft: first.draft,
      nextDraft: edited,
      currentAiState: first.aiState,
    });
    const second = reanalyze(edited, reconciled.aiState);
    expect(second.draft.performanceObligations[0]!.recognitionMethod).toBe("point_in_time");
  });
});
