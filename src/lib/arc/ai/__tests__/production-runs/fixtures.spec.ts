import { describe, expect, it } from "vitest";

import type { ProposalAlignment, ProposalAlignmentRelation } from "@/lib/arc/ai/alignment-types";
import type { CitationSpan } from "@/lib/arc/ai/alignment-types";

import {
  productionRunFixtures,
  run1Fixture,
  runAFixture,
  runBFixture,
  type ProductionRunFixture,
} from "./index";

const DOC_ID = "71a48e73-7496-44c8-b611-2dca9d3ed256";

const pages = (spans: readonly CitationSpan[]): number[] =>
  [...new Set(spans.flatMap((s) => [s.pageStart, s.pageEnd]))].sort((a, b) => a - b);

const excerptAt = (spans: readonly CitationSpan[], page: number): string => {
  const hit = spans.find((s) => s.pageStart === page && (s.normalizedExcerpt ?? "").length > 0);
  if (!hit?.normalizedExcerpt) throw new Error(`no bounded excerpt on page ${page}`);
  return hit.normalizedExcerpt;
};

const promise = (f: ProductionRunFixture, key: string) => {
  const hit = f.promises.find((p) => p.semanticKey === key);
  if (!hit) throw new Error(`missing promise ${key} in ${f.label}`);
  return hit;
};

const billing = (f: ProductionRunFixture, key: string) => {
  const hit = f.billingTerms.find((b) => b.semanticKey === key);
  if (!hit) throw new Error(`missing billing term ${key} in ${f.label}`);
  return hit;
};

const vc = (f: ProductionRunFixture, key: string) => {
  const hit = f.variableConsiderationComponents.find((v) => v.semanticKey === key);
  if (!hit) throw new Error(`missing VC ${key} in ${f.label}`);
  return hit;
};

const allSpans = (f: ProductionRunFixture): CitationSpan[] => [
  ...f.promises.flatMap((p) => p.citations),
  ...f.performanceObligations.flatMap((p) => p.citations),
  ...f.variableConsiderationComponents.flatMap((v) => v.citations),
  ...f.billingTerms.flatMap((b) => b.citations),
];

describe("production run fixtures — provenance", () => {
  it("carries the three immutable production run ids", () => {
    expect(run1Fixture.runId).toBe("c7ba39d7-3e16-4de0-9178-454b8aadb781");
    expect(runAFixture.runId).toBe("d3675d38-42ba-46e1-8384-4604f0b40310");
    expect(runBFixture.runId).toBe("ccd364d3-a283-41d7-ad6f-851ce4142f8d");
    expect(productionRunFixtures.map((f) => f.runId)).toEqual([
      run1Fixture.runId,
      runAFixture.runId,
      runBFixture.runId,
    ]);
  });

  it("references only the single Genomix source document", () => {
    for (const f of productionRunFixtures) {
      for (const span of allSpans(f)) expect(span.documentId).toBe(DOC_ID);
    }
  });
});

describe("Run 1 canonical structure", () => {
  it("has 4 promises, 3 POs and 2 VC components", () => {
    expect(run1Fixture.promises).toHaveLength(4);
    expect(run1Fixture.performanceObligations).toHaveLength(3);
    expect(run1Fixture.variableConsiderationComponents).toHaveLength(2);
  });

  it("records the accepted canonical Run 1 structure including 2 consideration events and 2 projected collections", () => {
    expect(run1Fixture.expectedCanonicalStructure).toEqual({
      promises: 4,
      performanceObligations: 3,
      variableConsiderationComponents: 2,
      considerationEvents: 2,
      projectedCollections: 2,
    });
  });
});

describe("cross-run semantic key drift", () => {
  it("Run A and Run B rename every promise, PO and billing key relative to Run 1", () => {
    const run1Promises = new Set(run1Fixture.promises.map((p) => p.semanticKey));
    for (const f of [runAFixture, runBFixture]) {
      for (const p of f.promises) expect(run1Promises.has(p.semanticKey)).toBe(false);
    }
    expect(runAFixture.billingTerms.map((b) => b.semanticKey)).not.toEqual(
      run1Fixture.billingTerms.map((b) => b.semanticKey),
    );
    expect(runBFixture.performanceObligations.map((p) => p.semanticKey)).not.toEqual(
      runAFixture.performanceObligations.map((p) => p.semanticKey),
    );
  });
});

describe("taxonomy drift", () => {
  it("Run 1 and Run A type engineering support as professional_service, Run B as support", () => {
    expect(promise(run1Fixture, "clinical_bioinformatics_engineering_support").promiseType).toBe(
      "professional_service",
    );
    expect(promise(runAFixture, "promise_bioinformatics_support_hours").promiseType).toBe(
      "professional_service",
    );
    expect(promise(runBFixture, "promise_bioinformatics_engineering_support").promiseType).toBe(
      "support",
    );
  });
});

describe("citation drift", () => {
  it("Run 1 vs Run A: the fixed annual billing term loses page 1", () => {
    expect(pages(billing(run1Fixture, "fixed_annual_advance_billing").citations)).toEqual([1, 3]);
    expect(pages(billing(runAFixture, "billing_fixed_annual_advance").citations)).toEqual([3]);
  });

  it("Run 1 vs Run B: the validation promise citation expands from page 3 to pages 1 and 3", () => {
    expect(pages(promise(run1Fixture, "gxp_validation_artifacts").citations)).toEqual([3]);
    expect(pages(promise(runBFixture, "promise_validation_artifact_package").citations)).toEqual([
      1, 3,
    ]);
  });
});

describe("decomposition drift", () => {
  it("Runs A and B collapse Run 1's hosted platform + included throughput promises into one", () => {
    const hosted = run1Fixture.performanceObligations.find(
      (p) => p.semanticKey === "po_hosted_platform_series",
    );
    expect(hosted?.promiseKeys).toEqual(["hosted_platform_access", "included_throughput_capacity"]);
    expect(runAFixture.promises).toHaveLength(3);
    expect(runBFixture.promises).toHaveLength(3);
    expect(
      runAFixture.performanceObligations.find((p) => p.semanticKey === "po_hosted_platform_series")
        ?.promiseKeys,
    ).toEqual(["promise_hosted_platform_and_included_throughput"]);
    expect(
      runBFixture.performanceObligations.find(
        (p) => p.semanticKey === "po_hosted_platform_service_series",
      )?.promiseKeys,
    ).toEqual(["promise_hosted_platform_and_included_throughput"]);
  });
});

describe("economic invariance", () => {
  it("usage overage remains $1.35 per sample in every run despite identity and citation drift", () => {
    expect(vc(run1Fixture, "throughput_overage").contractualRateOrAmountInput).toBe("1.35");
    expect(vc(runAFixture, "variable_throughput_overages").contractualRateOrAmountInput).toBe(
      "1.35",
    );
    expect(vc(runBFixture, "variable_throughput_overages").contractualRateOrAmountInput).toBe(
      "1.35",
    );
    for (const f of productionRunFixtures) {
      expect(f.billingTerms.map((b) => b.amountOrRateInput)).toContain("245000");
    }
  });
});

describe("bounded excerpt relationships required by the future matcher", () => {
  it("preserves exact normalized equality where the production runs quoted the same span", () => {
    const run1Hosted = excerptAt(promise(run1Fixture, "hosted_platform_access").citations, 1);
    expect(
      excerptAt(
        promise(runAFixture, "promise_hosted_platform_and_included_throughput").citations,
        1,
      ),
    ).toBe(run1Hosted);
    expect(
      excerptAt(
        promise(runBFixture, "promise_hosted_platform_and_included_throughput").citations,
        1,
      ),
    ).toBe(run1Hosted);
    expect(excerptAt(billing(run1Fixture, "fixed_annual_advance_billing").citations, 3)).toBe(
      excerptAt(billing(runAFixture, "billing_fixed_annual_advance").citations, 3),
    );
  });

  it("preserves strict containment where a later run quoted a wider span", () => {
    const run1Sla = excerptAt(billing(run1Fixture, "sla_credit_application").citations, 4);
    const runBSla = excerptAt(billing(runBFixture, "billing_sla_credit").citations, 4);
    expect(runBSla).not.toBe(run1Sla);
    expect(runBSla.includes(run1Sla)).toBe(true);

    const run1Usage = excerptAt(vc(run1Fixture, "throughput_overage").citations, 3);
    const runBUsageExcerpts = vc(runBFixture, "variable_throughput_overages")
      .citations.filter((c) => c.pageStart === 3)
      .map((c) => c.normalizedExcerpt ?? "");
    expect(runBUsageExcerpts).not.toContain(run1Usage);
    expect(runBUsageExcerpts.some((e) => e.includes(run1Usage))).toBe(true);
  });

  it("keeps excerpts bounded — no full page corpus, prompts or credentials", () => {
    for (const f of productionRunFixtures) {
      for (const span of allSpans(f)) {
        const text = span.normalizedExcerpt ?? "";
        expect(text.length).toBeLessThanOrEqual(600);
        expect(text).not.toMatch(/sk-|api[_ ]key|bearer |system prompt|you are an? /i);
      }
      expect(JSON.stringify(f)).not.toMatch(/OPENAI|prompt_tokens|"prompt"/i);
    }
  });
});

describe("alignment types", () => {
  it("freezes the alignment relation vocabulary", () => {
    const relations: ProposalAlignmentRelation[] = [
      "exact",
      "subsumes",
      "split_from",
      "ambiguous",
      "unmatched",
    ];
    expect(relations).toHaveLength(5);

    const alignment: ProposalAlignment = {
      objectKind: "promise",
      proposalKey: "promise_hosted_platform_and_included_throughput",
      canonicalIds: ["pr-1", "pr-2"],
      relation: "subsumes",
    };
    expect(alignment.relation).toBe("subsumes");
    expect(alignment.canonicalIds).toHaveLength(2);
  });
});
