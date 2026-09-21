import { describe, it } from "vitest";
import { createEmptyDraft } from "@/lib/asc606-workflow";
import { createEmptyAiAnalysisState, mergeAiAnalysis } from "../merge";
import { resolveIdentityGraph, canonicalGroupDecompositionRules } from "../identity-graph";
import { assessSafeReanalysis } from "../safe-reanalysis";
import { guidancePackFixture, RUN_ID } from "./merge-fixtures";
import { buildIdentityFacts, asIncumbent, assessIdentityEvidence } from "../identity-facts";
describe("d", () => { it("x", () => {
  const spans=(p:number,e:string)=>[{documentId:"doc-fixture-1",pageStart:p,pageEnd:p,normalizedExcerpt:e}];
  const f=(ref:string,desc:string,page:number,ex:string)=>buildIdentityFacts({objectKind:"performance_obligation",ref,judgments:{satisfactionPattern:"over_time"},citations:spans(page,ex),measureSources:[ex],description:desc});
  const a=f("po:hosted","Hosted sequencing platform",2,"Provider shall host the sequencing platform for an annual platform fee of $480,000.");
  console.log(JSON.stringify(assessIdentityEvidence(a, asIncumbent(a,"po-1")).strongClasses));
  const v=f("po:validation","Validation artifact package",3,"Provider shall deliver the validation artifact package for a fixed fee of $95,000.");
  console.log(JSON.stringify(assessIdentityEvidence(a, asIncumbent(v,"po-2")).admissible));
}); });
