import { it } from "vitest";
import { analyzeWorkflow } from "@/lib/asc606-workflow";
import { genomixAnalysis } from "./genomix-fixtures";
import { createEmptyDraft } from "@/lib/asc606-workflow";
import { createEmptyAiAnalysisState, mergeAiAnalysis } from "../merge";
import { guidancePackFixture, RUN_ID } from "./merge-fixtures";
it("p", () => {
  const a = genomixAnalysis();
  const { draft, issues } = mergeAiAnalysis({ currentDraft: createEmptyDraft(), currentAiState: createEmptyAiAnalysisState(), analysis: a, runId: RUN_ID, guidancePack: guidancePackFixture(), priorContext: null });
  const r = analyzeWorkflow(draft);
  process.stdout.write("X"+JSON.stringify({keys:Object.keys(r), blocked:r.blockedReason, a: r.analysis && Object.keys(r.analysis), pos: draft.performanceObligations.map(p=>[p.id,p.recognitionMethod,p.serviceStart,p.serviceEnd,p.recognitionDate]), rp: a.recognitionProposals[1], issues: issues.filter(i=>i.blocking).map(i=>i.reasonCode)})+"\n");
});
