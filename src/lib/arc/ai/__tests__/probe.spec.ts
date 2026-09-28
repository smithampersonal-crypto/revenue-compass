import { it } from "vitest";
import { analyzeWorkflow, createEmptyDraft } from "@/lib/asc606-workflow";
import { parseAiContractAnalysis } from "../schema";
import { cedarTest03Analysis } from "./cedar-test03-fixture";
import { createEmptyAiAnalysisState, mergeAiAnalysis } from "../merge";
import { guidancePackFixture, RUN_ID } from "./merge-fixtures";
it("p", () => {
  const a = cedarTest03Analysis();
  const pr = parseAiContractAnalysis(a);
  const { draft, issues } = mergeAiAnalysis({ currentDraft: createEmptyDraft(), currentAiState: createEmptyAiAnalysisState(), analysis: a, runId: RUN_ID, guidancePack: guidancePackFixture(), priorContext: null });
  const r = analyzeWorkflow(draft);
  process.stdout.write("X"+JSON.stringify({al: r.allocation, rs: r.revenueSchedule && Object.keys(r.revenueSchedule), un: r.unscheduledRevenueCents, cb: Object.keys(r.lifecycle ?? {}), bi: issues.filter(i=>/billing/.test(i.reasonCode)).length}).slice(0,1500)+"\n");
});
