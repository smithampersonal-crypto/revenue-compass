import { it } from "vitest";
import { createEmptyDraft } from "@/lib/asc606-workflow";
import { createEmptyAiAnalysisState, mergeAiAnalysis } from "../merge";
import { assessSafeReanalysis } from "../safe-reanalysis";
import { guidancePackFixture } from "./merge-fixtures";
import { genomixR1Analysis } from "./r1-fixtures";
it("dbg", () => {
  const a = genomixR1Analysis();
  const first = mergeAiAnalysis({ currentDraft: createEmptyDraft(), currentAiState: createEmptyAiAnalysisState(), analysis: a, runId: "run-earlier", guidancePack: guidancePackFixture(), priorContext: null });
  const d = assessSafeReanalysis({ analysis: genomixR1Analysis(), priorAnalysis: a, priorAnalysisLoad: "loaded", currentDraft: first.draft, currentAiState: { ...first.aiState, lastSuccessfulRunId: "run-earlier", sourceSetFingerprint: "f" }, currentSourceSetFingerprint: "f" });
  console.log(JSON.stringify(d).slice(0, 2000));
});
