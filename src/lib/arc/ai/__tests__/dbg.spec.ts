import { describe, it } from "vitest";
import { createEmptyDraft } from "@/lib/asc606-workflow";
import { createEmptyAiAnalysisState, mergeAiAnalysis } from "../merge";
import { assessSafeReanalysis } from "../safe-reanalysis";
import { assessIdentityEvidence, performanceObligationIdentityFacts, asIncumbent } from "../identity-facts";
import { fixtureMultiElementAnalysis, guidancePackFixture, RUN_ID } from "./merge-fixtures";
function baseline() {
  const a = fixtureMultiElementAnalysis();
  const q=(p:number,e:string)=>[{documentId:"doc-fixture-1",pageStart:p,pageEnd:p,evidenceMode:"text" as const,excerpt:e}];
  const pl=q(2,"Vendor shall provide the hosted platform for an annual fee of $120,000.");
  const su=q(4,"Premium support services are provided for an annual fee of $30,000.");
  a.promises[0]!.citations=pl;a.promises[1]!.citations=su;a.performanceObligations[0]!.citations=pl;a.performanceObligations[1]!.citations=su;
  return a;
}
describe("dbg",()=>{it("x",()=>{
  const a=baseline();
  const f=(i:number)=>performanceObligationIdentityFacts({semanticKey:a.performanceObligations[i]!.semanticKey,description:a.performanceObligations[i]!.description,satisfactionPattern:a.performanceObligations[i]!.satisfactionPattern,citations:a.performanceObligations[i]!.citations.map(c=>({documentId:c.documentId,pageStart:c.pageStart,pageEnd:c.pageEnd,normalizedExcerpt:c.excerpt}))});
  console.log(JSON.stringify(assessIdentityEvidence(f(0), asIncumbent(f(0),"po-1")),null,1));
  const m=mergeAiAnalysis({currentDraft:createEmptyDraft(),currentAiState:createEmptyAiAnalysisState(),analysis:baseline(),runId:RUN_ID,guidancePack:guidancePackFixture(),priorContext:null});
  console.log(JSON.stringify(assessSafeReanalysis({analysis:baseline(),priorAnalysis:baseline(),priorAnalysisLoad:"loaded",currentDraft:m.draft,currentAiState:{...m.aiState,lastSuccessfulRunId:RUN_ID,sourceSetFingerprint:"fp"},currentSourceSetFingerprint:"fp"})));
});});
