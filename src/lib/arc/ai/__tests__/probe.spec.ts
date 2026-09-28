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
  process.stdout.write("X"+JSON.stringify({parse: pr.ok || pr, blocked:r.blockedReason, wv: r.workflowValidation.blocking, ev: draft.contractBalances.considerationEvents.map(e=>[e.invoiceDate,e.amountInput]), tp: draft.transactionPriceInput, pos: draft.performanceObligations.map(p=>[p.recognitionMethod,p.serviceStart,p.serviceEnd,p.recognitionDate]), issues: issues.map(i=>[i.reasonCode,i.severity,i.targetKey])})+"\n");
});
