/**
 * Phase 9D acceptance patch — material conclusions must carry provenance.
 * A structurally valid but empty citation array is not acceptable evidence.
 */

import { describe, expect, it } from "vitest";

import { buildGuidancePack } from "@/lib/arc/guidance/retrieval";

import { validateAiCitations } from "../citations";
import { validateMaterialProvenance } from "../provenance";
import { classifyReadability, type AiDocumentEvidence } from "../types";

import {
  FIXTURE_DOCUMENT_ID,
  FIXTURE_PAGE_COUNT,
  FIXTURE_PAGE_TEXT,
  validAnalysisFixture,
} from "./analysis-fixture";

const pack = buildGuidancePack({ normalizedEvidenceText: "saas subscription hosted platform" });

function evidence(): AiDocumentEvidence[] {
  return [
    {
      documentId: FIXTURE_DOCUMENT_ID,
      displayName: "Genomix package",
      originalFilename: "genomix.pdf",
      sha256: "e".repeat(64),
      byteSize: 1024,
      pageCount: FIXTURE_PAGE_COUNT,
      pages: Object.entries(FIXTURE_PAGE_TEXT).map(([pageNumber, text]) => ({
        pageNumber: Number(pageNumber),
        text,
        meaningfulCharacters: text.length,
        readability: classifyReadability(text.length),
      })),
    },
  ];
}

describe("material provenance", () => {
  it("accepts the fully cited reference analysis", () => {
    expect(validateMaterialProvenance(validAnalysisFixture())).toEqual([]);
  });

  it("never mutates the analysis it inspects", () => {
    const analysis = validAnalysisFixture();
    const before = JSON.stringify(analysis);
    validateMaterialProvenance(analysis);
    expect(JSON.stringify(analysis)).toBe(before);
  });

  const emptied: Array<[string, (analysis: ReturnType<typeof validAnalysisFixture>) => void]> = [
    ["Step 1 judgment", (a) => (a.contractAssessment.approvalAndCommitment.citations = [])],
    ["Step 1 fact", (a) => (a.contractAssessment.contractTerm.citations = [])],
    ["promise distinctness", (a) => (a.promises[0]!.citations = [])],
    ["performance-obligation grouping", (a) => (a.performanceObligations[0]!.citations = [])],
    [
      "transaction-price conclusion",
      (a) => (a.transactionPrice.transactionPriceConclusion.citations = []),
    ],
    [
      "fixed consideration amount",
      (a) => (a.transactionPrice.fixedConsiderationCitations = []),
    ],
    [
      "financing conclusion",
      (a) => (a.transactionPrice.financingAssessment.citations = []),
    ],
    [
      "noncash conclusion",
      (a) => (a.transactionPrice.noncashConsideration.citations = []),
    ],
    [
      "payable-to-customer conclusion",
      (a) => (a.transactionPrice.considerationPayableToCustomer.citations = []),
    ],
    [
      "SSP applicability",
      (a) => (a.sspAndAllocation.relativeAllocationApplicable.citations = []),
    ],
    ["recognition proposal", (a) => (a.recognitionProposals[0]!.citations = [])],
    ["billing term", (a) => (a.billingTerms[0]!.citations = [])],
    ["projected collection assumption", (a) => (a.projectedCollectionAssumptions.citations = [])],
    [
      "applicable additional topic",
      (a) => {
        a.additionalTopics[0]!.applicable = "yes";
        a.additionalTopics[0]!.citations = [];
      },
    ],
  ];

  it.each(emptied)("rejects a %s asserted with zero citations", (_label, mutate) => {
    const analysis = validAnalysisFixture();
    mutate(analysis);
    const issues = validateMaterialProvenance(analysis);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]!.code).toBe("missing_material_citation");
  });

  it("rejects an uncited variable-consideration component that is not needs_user_input", () => {
    const analysis = validAnalysisFixture();
    const component = analysis.transactionPrice.variableConsiderationComponents[0]!;
    component.reviewState = "inference";
    component.citations = [];
    expect(validateMaterialProvenance(analysis)[0]!.path).toBe(
      "transactionPrice.variableConsiderationComponents[0]",
    );
  });

  it("rejects an uncited modification conclusion once a modification is asserted", () => {
    const analysis = validAnalysisFixture();
    analysis.contractModifications.hasModification = "yes";
    analysis.contractModifications.citations = [];
    expect(validateMaterialProvenance(analysis)[0]!.path).toBe("contractModifications");
  });

  it("allows zero citations when the conclusion is that the fact is missing", () => {
    const analysis = validAnalysisFixture();
    analysis.contractAssessment.collectibility.reviewState = "needs_user_input";
    analysis.contractAssessment.collectibility.citations = [];
    analysis.sspAndAllocation.items[0]!.citations = [];
    expect(validateMaterialProvenance(analysis)).toEqual([]);
  });

  it("requires evidence for an asserted source conflict", () => {
    const analysis = validAnalysisFixture();
    analysis.promises[0]!.reviewState = "source_conflict";
    analysis.promises[0]!.citations = [];
    expect(validateMaterialProvenance(analysis)[0]!.path).toBe("promises[0]");
  });

  it("exempts an additional topic concluded not applicable", () => {
    const analysis = validAnalysisFixture();
    analysis.additionalTopics[0]!.applicable = "no";
    analysis.additionalTopics[0]!.citations = [];
    expect(validateMaterialProvenance(analysis)).toEqual([]);
  });

  it("surfaces provenance failures through the shared validator and fails it closed", () => {
    const analysis = validAnalysisFixture();
    analysis.billingTerms[0]!.citations = [];
    const result = validateAiCitations(analysis, evidence(), pack);
    expect(result.ok).toBe(false);
    expect(result.citationIssues).toEqual([]);
    expect(result.provenanceIssues[0]).toMatchObject({
      code: "missing_material_citation",
      path: "billingTerms[0]",
    });
  });
});
