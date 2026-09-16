import { describe, expect, it } from "vitest";

import { buildGuidancePack } from "@/lib/arc/guidance/retrieval";

import {
  buildValidationFailureDetails,
  diagnoseExcerptMismatches,
  normalizeCitationText,
  validateAiCitations,
  MAX_VALIDATION_DETAILS,
} from "../citations";
import { CITATION_MIRROR_LOCATOR_HEADER, buildCitationMirrorParts } from "../citation-mirror";
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

describe("bounded developer diagnostics", () => {
  function fabricatedStorm() {
    const analysis = validAnalysisFixture();
    const template = analysis.promises[0]!;
    analysis.promises = [...Array(52).keys()].map((index) => ({
      ...structuredClone(template),
      semanticKey: `promise:fabricated-${index}`,
      citations: [
        {
          documentId: FIXTURE_DOCUMENT_ID,
          pageStart: 1,
          pageEnd: 1,
          evidenceMode: "text" as const,
          excerpt: `Provider shall deliver fabricated clause number ${index} on demand`,
        },
      ],
    }));
    return analysis;
  }

  it("keeps mismatch classification alive during an excerpt_not_found storm", () => {
    const analysis = fabricatedStorm();
    const validation = validateAiCitations(analysis, evidence(), pack);
    expect(validation.citationIssues.length).toBeGreaterThanOrEqual(50);

    const details = buildValidationFailureDetails({
      validation,
      analysis,
      evidence: evidence(),
      includeExcerptDiagnostics: true,
    });

    expect(details.length).toBeLessThanOrEqual(MAX_VALIDATION_DETAILS);
    expect(details[0]).toMatch(/^validation counts: .*excerpt_not_found=\d+/);
    expect(details.some((line) => line.startsWith("excerpt_not_found at "))).toBe(true);
    expect(details.some((line) => line.startsWith("mismatch "))).toBe(true);
  });

  it("leaves production detail allocation unchanged when diagnostics are off", () => {
    const analysis = fabricatedStorm();
    const validation = validateAiCitations(analysis, evidence(), pack);
    const details = buildValidationFailureDetails({ validation, analysis, evidence: evidence() });
    expect(details.length).toBe(MAX_VALIDATION_DETAILS);
    expect(details.every((line) => /^[a-z_]+ at /.test(line))).toBe(true);
    expect(details.some((line) => line.startsWith("mismatch "))).toBe(false);
  });

  function diagnose(excerpt: string, pageStart: number) {
    const analysis = validAnalysisFixture();
    analysis.promises = [
      {
        ...structuredClone(analysis.promises[0]!),
        citations: [
          {
            documentId: FIXTURE_DOCUMENT_ID,
            pageStart,
            pageEnd: pageStart,
            evidenceMode: "text" as const,
            excerpt,
          },
        ],
      },
    ];
    const validation = validateAiCitations(analysis, evidence(), pack);
    const [first] = diagnoseExcerptMismatches(analysis, evidence(), validation.citationIssues);
    return { validation, diagnostic: first };
  }

  it("classifies a punctuation-only difference while still rejecting the citation", () => {
    const { validation, diagnostic } = diagnose(
      "Fees are invoiced net thirty (30) days; from-invoice date!",
      1,
    );
    expect(validation.ok).toBe(false);
    expect(validation.citationIssues[0]).toMatchObject({ code: "excerpt_not_found" });
    expect(diagnostic?.difference).toBe("punctuation_or_whitespace");
  });

  it("classifies a wrong-page citation while still rejecting it", () => {
    const { validation, diagnostic } = diagnose(
      "Nothing herein transfers source code to Customer",
      1,
    );
    expect(validation.ok).toBe(false);
    expect(validation.citationIssues[0]).toMatchObject({ code: "excerpt_not_found" });
    expect(diagnostic?.difference).toBe("wrong_page");
    expect(diagnostic?.foundOnPage).toBe(2);
  });

  it("classifies a true paraphrase while still rejecting it", () => {
    const { validation, diagnostic } = diagnose(
      "Provider grants a perpetual irrevocable licence to all source code",
      1,
    );
    expect(validation.ok).toBe(false);
    expect(diagnostic?.difference).toBe("paraphrase_or_absent");
    expect(diagnostic?.foundOnPage).toBeNull();
  });
});

/* ----------- Phase 9F — the mirror helps the model, never the validator */

describe("ARC local citation text mirror round-trip", () => {
  const mirrorTextFor = (page: number) => {
    const { parts, payloadParts } = buildCitationMirrorParts(evidence());
    // The payload for a page is the part following its ARC-authored locator.
    const locatorIndex = parts.findIndex(
      (part) =>
        part.text.startsWith(CITATION_MIRROR_LOCATOR_HEADER) &&
        part.text.includes(`physicalPage: ${page}`),
    );
    expect(locatorIndex).toBeGreaterThan(-1);
    expect(payloadParts).toContain(parts[locatorIndex + 1]);
    const payload = JSON.parse(parts[locatorIndex + 1]!.text) as {
      anchors: Array<{ text: string }>;
    };
    return payload.anchors.map((anchor) => anchor.text).join("");
  };

  it("verifies a short contiguous span copied out of the mirror", () => {
    const span = mirrorTextFor(1).slice(60, 140);
    const analysis = validAnalysisFixture();
    const citation = analysis.promises[0]!.citations[0]!;
    citation.pageStart = 1;
    citation.pageEnd = 1;
    citation.evidenceMode = "text";
    citation.excerpt = span;

    const result = validateAiCitations(analysis, evidence(), pack);
    expect(result.citationIssues).toEqual([]);
    expect(
      result.verifiedCitations.find((entry) => entry.path.startsWith("promises[0]"))?.verification,
    ).toBe("text_matched");
  });

  it("keeps a table relationship valid as a visual page reference", () => {
    const analysis = validAnalysisFixture();
    const citation = analysis.transactionPrice.fixedConsiderationCitations[0]!;
    citation.evidenceMode = "visual";
    citation.excerpt = null;
    citation.pageStart = 3;
    citation.pageEnd = 3;

    const result = validateAiCitations(analysis, evidence(), pack);
    expect(result.citationIssues).toEqual([]);
    expect(
      result.verifiedCitations.find((entry) =>
        entry.path.startsWith("transactionPrice.fixedConsiderationCitations[0]"),
      )?.verification,
    ).toBe("visual_page_reference");
  });

  it.each([
    ["a trailing period that is not in the local text", "Effective Date: November 1, 2026 ."],
    ["stitched table-cell text", "Annual Advance ($245,000/yr Net 30); Tier 2 overage"],
    ["an ellipsis with omitted words", "Effective Term Nov 1, 2026 ... Oct 31, 2028"],
    ["a fabricated excerpt", "Provider grants Customer a perpetual irrevocable licence"],
  ])("still rejects %s even though the mirror was supplied", (_label, excerpt) => {
    const analysis = validAnalysisFixture();
    const citation = analysis.promises[0]!.citations[0]!;
    citation.pageStart = 3;
    citation.pageEnd = 3;
    citation.evidenceMode = "text";
    citation.excerpt = excerpt;

    const result = validateAiCitations(analysis, evidence(), pack);
    expect(result.ok).toBe(false);
    expect(result.citationIssues.map((issue) => issue.code)).toContain("excerpt_not_found");
  });

  it("still rejects an exact mirror span cited on the wrong physical page", () => {
    const span = mirrorTextFor(3).slice(20, 70);
    const analysis = validAnalysisFixture();
    const citation = analysis.promises[0]!.citations[0]!;
    citation.pageStart = 1;
    citation.pageEnd = 1;
    citation.evidenceMode = "text";
    citation.excerpt = span;

    const result = validateAiCitations(analysis, evidence(), pack);
    expect(result.ok).toBe(false);
    expect(result.citationIssues.map((issue) => issue.code)).toContain("excerpt_not_found");
    // Diagnosis (developer-only) can say where it really is; validation cannot.
    expect(diagnoseExcerptMismatches(analysis, evidence(), result.citationIssues)[0]).toMatchObject(
      { difference: "wrong_page", foundOnPage: 3 },
    );
  });
});
