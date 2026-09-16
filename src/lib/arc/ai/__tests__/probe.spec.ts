import { describe, it } from "vitest";
import { buildWorkpaper } from "@/lib/arc/persistence/snapshot";
import { createEmptyDraft } from "@/lib/asc606-workflow";
import { createEmptyAiAnalysisState, mergeAiAnalysis } from "@/lib/arc/ai/merge";
import { fixtureAAnalysis, guidancePackFixture, RUN_ID } from "@/lib/arc/ai/__tests__/merge-fixtures";
describe("probe", () => { it("shows", () => {
  const { draft } = mergeAiAnalysis({ currentDraft: createEmptyDraft(), currentAiState: createEmptyAiAnalysisState(), analysis: fixtureAAnalysis(), runId: RUN_ID, guidancePack: guidancePackFixture(), priorContext: null });
  const w = buildWorkpaper(draft);
  console.log(JSON.stringify(w.workflow.validation ?? w.workflow.issues ?? Object.keys(w.workflow), null, 1).slice(0,3000));
}); });
