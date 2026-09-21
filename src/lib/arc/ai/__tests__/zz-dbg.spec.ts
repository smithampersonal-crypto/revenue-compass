import { describe, it } from "vitest";
import { promiseIdentityFacts, asIncumbent } from "@/lib/arc/ai/identity-facts";
import { buildCandidateGraph } from "@/lib/arc/ai/identity-graph";

const DOC = "doc-fixture-1";
const s = (page: number, excerpt: string) => [{ documentId: DOC, pageStart: page, pageEnd: page, normalizedExcerpt: excerpt }];
const mk = (key: string, desc: string, cits: any) => promiseIdentityFacts({ semanticKey: key, promiseType: "service", description: desc, distinctConclusion: "distinct", citations: cits, owningObligationCanonicalId: "po-1" });

describe("dbg", () => {
  it("edges", () => {
    const hosted = mk("promise:hosted", "Hosted sequencing platform", s(2, "Provider shall host the sequencing platform for an annual platform fee of $480,000."));
    const thr = mk("promise:throughput", "Included annual throughput allowance", s(9, "Annex B: the platform fee includes an allowance of 12,000 samples per contract year."));
    const edges = buildCandidateGraph({ objectKind: "promise", proposals: [hosted, thr], incumbents: [asIncumbent(hosted, "pr-1"), asIncumbent(thr, "pr-2")] });
    console.log(JSON.stringify(edges.map(e => ({ p: e.proposalKey, c: e.canonicalId, codes: e.evidence.codes })), null, 1));
  });
});
