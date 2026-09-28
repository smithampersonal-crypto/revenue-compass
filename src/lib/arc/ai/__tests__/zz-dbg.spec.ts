import { it } from "vitest";
import { parseAiContractAnalysis } from "../schema";
import { genomixR1Analysis } from "./r1-fixtures";
import { redwood, run, invoice } from "./package-3d-q1-explicit-invoices.spec";
it("d", () => {
  const p = parseAiContractAnalysis(redwood()) as any;
  console.log("PARSE", JSON.stringify(p.issues ?? p.error ?? p).slice(0,800));
  const first = run(genomixR1Analysis());
  const next = genomixR1Analysis();
  next.billingTerms = next.billingTerms.map((t) => t.semanticKey === "billing:annual-advance" ? { ...t, explicitInvoices: [invoice("2027-01-01","245000","Genomix will invoice $245,000 on January 1, 2027.")] } : t);
  const s = run(next, first.draft, first.aiState);
  console.log("ISS", JSON.stringify(s.issues.filter(i=>i.targetKey.includes("billing")).map(i=>[i.targetKey,i.reasonCode,(i as any).material?.reason, i.reason.slice(0,90)])));
  console.log("PROV", JSON.stringify(Object.entries(first.aiState.objectProvenance).filter(([k])=>k.includes("billing")).map(([k,v])=>[k,v.derivation])));
});
