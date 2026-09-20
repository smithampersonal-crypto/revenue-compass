import { describe, expect, it } from "vitest";

import { createEmptyDraft } from "@/lib/asc606-workflow";

import { createEmptyAiAnalysisState, mergeAiAnalysis } from "../merge";
import { guidancePackFixture } from "./merge-fixtures";
import { genomixR1Analysis, R1_RUN_ID } from "./r1-fixtures";

describe("probe", () => {
  it("run1", () => {
    const first = mergeAiAnalysis({
      currentDraft: createEmptyDraft(),
      currentAiState: createEmptyAiAnalysisState(),
      analysis: genomixR1Analysis(),
      runId: R1_RUN_ID,
      guidancePack: guidancePackFixture(),
      priorContext: null,
    });
    console.log(
      JSON.stringify(
        {
          pos: first.draft.performanceObligations,
          vcs: first.draft.variableConsiderationComponents,
          objectProvenance: first.aiState.objectProvenance,
          fieldKeys: Object.keys(first.aiState.fieldProvenance),
        },
        null,
        1,
      ),
    );
    expect(true).toBe(true);
  });
});
