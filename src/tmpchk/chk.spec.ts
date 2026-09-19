import { it } from "vitest";
import { createEmptyDraft } from "@/lib/asc606-workflow";
import { createEmptyAiAnalysisState, mergeAiAnalysis } from "@/lib/arc/ai/merge";
import { fixtureAAnalysis, guidancePackFixture, RUN_ID } from "@/lib/arc/ai/__tests__/merge-fixtures";
it("dbg", () => {
  const r = mergeAiAnalysis({
    currentDraft: createEmptyDraft(),
    currentAiState: createEmptyAiAnalysisState(),
    analysis: fixtureAAnalysis(),
    runId: RUN_ID,
    guidancePack: guidancePackFixture(),
    priorContext: null,
  });
  console.log(r.issues.map((i) => `${i.state} ${i.targetKey}`).join("\n"));
});
