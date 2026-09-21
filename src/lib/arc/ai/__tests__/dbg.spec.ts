import { describe, it } from "vitest";
import { createEmptyDraft } from "@/lib/asc606-workflow";
import { createEmptyAiAnalysisState, mergeAiAnalysis } from "@/lib/arc/ai/merge";
import { assessSafeReanalysis } from "@/lib/arc/ai/safe-reanalysis";
import { fixtureMultiElementAnalysis, guidancePackFixture, RUN_ID } from "@/lib/arc/ai/__tests__/merge-fixtures";
describe("dbg", () => { it("x", () => {
  const a = fixtureMultiElementAnalysis();
  const m = mergeAiAnalysis({ currentDraft: createEmptyDraft(), currentAiState: createEmptyAiAnalysisState(), analysis: a, runId: RUN_ID, guidancePack: guidancePackFixture(), priorContext: null });
  console.log(JSON.stringify(Object.keys(m.aiState.objectProvenance), null, 1));
  console.log(JSON.stringify(assessSafeReanalysis({ analysis: fixtureMultiElementAnalysis(), priorAnalysis: fixtureMultiElementAnalysis(), priorAnalysisLoad: "loaded", currentDraft: m.draft, currentAiState: { ...m.aiState, lastSuccessfulRunId: RUN_ID, sourceSetFingerprint: "fp" }, currentSourceSetFingerprint: "fp" })));
}); });
