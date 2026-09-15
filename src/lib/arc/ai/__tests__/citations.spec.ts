import { describe, expect, it } from "vitest";

import { buildGuidancePack } from "@/lib/arc/guidance/retrieval";

import { normalizeCitationText, validateAiCitations } from "../citations";
import { classifyReadability, type AiDocumentEvidence } from "../types";

import {
  FIXTURE_DOCUMENT_ID,
  FIXTURE_PAGE_COUNT,
  FIXTURE_PAGE_TEXT,
  validAnalysisFixture,
} from "./analysis-fixture";

function evidence(): AiDocumentEvidence[] {
  return [
    {
      documentId: FIXTURE_DOCUMENT_ID,
      displayName: "Genomix package",
      originalFilename: "genomix.pdf",
      sha256: "c".repeat(64),
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

const pack = buildGuidancePack({ normalizedEvidenceText: "saas subscription hosted platform" });

describe("validateAiCitations", () => {
  it("accepts a fully valid analysis", () => {
    const result = validateAiCitations(validAnalysisFixture(), evidence(), pack);
    expect(result.citationIssues).toEqual([]);
    expect(result.guidanceIssues).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.verifiedCitations.length).toBeGreaterThan(15);
  });

  it("verifies a valid text citation against ARC's own page text", () => {
    const result = validateAiCitations(validAnalysisFixture(), evidence(), pack);
    const textMatched = result.verifiedCitations.filter(
      (entry) => entry.verification === "text_matched",
    );
    expect(textMatched.length).toBeGreaterThan(10);
  });

  it("rejects a fabricated excerpt instead of fuzzy-matching it into validity", () => {
    const analysis = validAnalysisFixture();
    analysis.promises[0]!.citations[0]!.excerpt =
      "Provider grants Customer a perpetual irrevocable licence to the source code";
    const result = validateAiCitations(analysis, evidence(), pack);
    expect(result.ok).toBe(false);
    expect(result.citationIssues[0]).toMatchObject({ code: "excerpt_not_found" });
  });

  it("rejects a citation to a document that did not participate in the run", () => {
    const analysis = validAnalysisFixture();
    analysis.promises[0]!.citations[0]!.documentId = "doc-invented";
    const result = validateAiCitations(analysis, evidence(), pack);
    expect(result.citationIssues.map((issue) => issue.code)).toContain("unknown_document");
  });

  it("rejects a page beyond the physical page count", () => {
    const analysis = validAnalysisFixture();
    analysis.promises[0]!.citations[0]!.pageStart = 9;
    analysis.promises[0]!.citations[0]!.pageEnd = 9;
    const result = validateAiCitations(analysis, evidence(), pack);
    expect(result.citationIssues.map((issue) => issue.code)).toContain("page_out_of_range");
  });

  it("rejects an inverted page range", () => {
    const analysis = validAnalysisFixture();
    analysis.promises[0]!.citations[0]!.pageStart = 3;
    analysis.promises[0]!.citations[0]!.pageEnd = 2;
    const result = validateAiCitations(analysis, evidence(), pack);
    expect(result.citationIssues.map((issue) => issue.code)).toContain("invalid_page_range");
  });

  it("checks a multi-page excerpt against the ordered page concatenation", () => {
    const analysis = validAnalysisFixture();
    const citation = analysis.promises[0]!.citations[0]!;
    citation.pageStart = 1;
    citation.pageEnd = 2;
    citation.excerpt = "invoice date. Provider retains all right";
    expect(validateAiCitations(analysis, evidence(), pack).ok).toBe(true);

    citation.pageStart = 3;
    citation.pageEnd = 4;
    expect(validateAiCitations(analysis, evidence(), pack).ok).toBe(false);
  });

  it("requires a non-blank excerpt for text evidence", () => {
    const analysis = validAnalysisFixture();
    analysis.promises[0]!.citations[0]!.excerpt = "   ";
    const result = validateAiCitations(analysis, evidence(), pack);
    expect(result.citationIssues.map((issue) => issue.code)).toContain("missing_excerpt");
  });

  it("labels a visual citation as a page reference only, never text-verified", () => {
    const result = validateAiCitations(validAnalysisFixture(), evidence(), pack);
    const visual = result.verifiedCitations.filter(
      (entry) => entry.verification === "visual_page_reference",
    );
    expect(visual.length).toBeGreaterThan(0);
    expect(visual.every((entry) => entry.pageEnd <= FIXTURE_PAGE_COUNT)).toBe(true);
  });

  it("still validates the page of a visual citation", () => {
    const analysis = validAnalysisFixture();
    analysis.transactionPrice.fixedConsiderationCitations[0]!.pageStart = 11;
    analysis.transactionPrice.fixedConsiderationCitations[0]!.pageEnd = 11;
    const result = validateAiCitations(analysis, evidence(), pack);
    expect(result.citationIssues.map((issue) => issue.code)).toContain("page_out_of_range");
  });

  it("rejects a guidance id that exists in the registry but was not in this pack", () => {
    const analysis = validAnalysisFixture();
    const absent = [...Array(116).keys()]
      .map((index) => index + 1)
      .find((id) => !pack.cards.some((card) => card.id === id))!;
    analysis.promises[0]!.guidanceIds = [absent];
    const result = validateAiCitations(analysis, evidence(), pack);
    expect(result.guidanceIssues[0]).toMatchObject({ code: "guidance_not_in_pack" });
    expect(result.ok).toBe(false);
  });

  it("rejects a guidance id that does not exist at all", () => {
    const analysis = validAnalysisFixture();
    analysis.promises[0]!.guidanceIds = [99999];
    const result = validateAiCitations(analysis, evidence(), pack);
    expect(result.guidanceIssues[0]).toMatchObject({ code: "guidance_not_in_registry" });
  });

  it("never mutates the analysis it validates", () => {
    const analysis = validAnalysisFixture();
    const before = JSON.stringify(analysis);
    validateAiCitations(analysis, evidence(), pack);
    expect(JSON.stringify(analysis)).toBe(before);
  });

  it("normalizes deterministically without semantic matching", () => {
    expect(normalizeCitationText("Net  thirty\u00ad (30)\nDAYS")).toBe("net thirty (30) days");
    expect(normalizeCitationText("“Annual Advance”")).toBe('"annual advance"');
    // Deterministic normalization only: a paraphrase never matches.
    expect(normalizeCitationText("30-day payment terms")).not.toBe("net thirty (30) days");
  });
});
