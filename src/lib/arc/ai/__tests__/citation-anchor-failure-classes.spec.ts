/**
 * Diagnostic regression suite for the anchor-selection boundary.
 *
 * Scope: prove that EVERY distinct `CitationAnchorIssueCode` the production
 * materializer can raise still fails closed, with the expected sanitized issue
 * code, schema path and bounded anchor ids — and that the Phase 9D boundary
 * carries exactly those sanitized facts into the bounded server-side
 * diagnostic log.
 *
 * These are diagnostics. They assert current semantics; they do not relax,
 * repair or normalize anything.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CITATION_ANCHOR_MAX_CHARS,
  CITATION_ANCHOR_MAX_RANGE,
  buildCitationAnchorPages,
} from "../citation-anchors";
import {
  materializeAiCitationAnchors,
  type CitationAnchorIssue,
  type CitationAnchorIssueCode,
} from "../citation-anchor-materializer";
import { AI_SCHEMA_BOUNDS } from "../schema";
import {
  TerraAnalysisError,
  createTerraAnalyzer,
  type ResponsesGenerativeClient,
} from "../terra.server";
import { logCitationAnchorDiagnostic } from "../orchestrator.server";
import type { AiDocumentEvidence } from "../types";
import { buildGuidancePack } from "@/lib/arc/guidance/retrieval";

const PAGE_1 =
  "SECTION 1. TERM. The initial term of this Agreement begins on November 1, 2026 and ends on October 31, 2028.\n" +
  "SECTION 2. FEES. Customer shall pay the subscription fee of $245,000 annually in advance, net 30 from the invoice date.\n" +
  "SECTION 3. SUPPORT. Support is delivered against a 300 hour annual pool measured by hours incurred.";
const PAGE_2 = "SECTION 4. CREDITS. Service credits are the sole remedy for downtime.";

const DOCUMENT_ID = "doc-master";

const evidence: AiDocumentEvidence[] = [
  {
    documentId: DOCUMENT_ID,
    displayName: "Master Agreement",
    originalFilename: "master.pdf",
    sha256: "a".repeat(64),
    byteSize: 4096,
    pageCount: 2,
    pages: [
      { pageNumber: 1, text: PAGE_1, readability: "text" },
      { pageNumber: 2, text: PAGE_2, readability: "text" },
    ],
  } as AiDocumentEvidence,
];

const pages = buildCitationAnchorPages(evidence);
const page1 = pages[0]!.anchors;
const page2 = pages[1]!.anchors;

/** A page long enough to expose selections beyond the allowed maximum. */
const wideEvidence: AiDocumentEvidence[] = [
  { ...evidence[0]!, pages: [{ pageNumber: 1, text: "y ".repeat(600), readability: "text" }], pageCount: 1 } as AiDocumentEvidence,
];
const widePage = buildCitationAnchorPages(wideEvidence)[0]!.anchors;

const PATH = "contractAssessment.commercialSubstance.citations[0]";

function analysisWith(citation: Record<string, unknown>): Record<string, unknown> {
  return { contractAssessment: { commercialSubstance: { citations: [citation] } } };
}

function citation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return analysisWith({
    documentId: DOCUMENT_ID,
    pageStart: 1,
    pageEnd: 1,
    evidenceMode: "text",
    anchorIds: [page1[0]!.anchorId],
    ...overrides,
  });
}

function failureOf(
  analysis: Record<string, unknown>,
  documents: readonly AiDocumentEvidence[] = evidence,
): CitationAnchorIssue {
  const result = materializeAiCitationAnchors(analysis, documents);
  expect(result.ok).toBe(false);
  const issues = (result as { ok: false; issues: CitationAnchorIssue[] }).issues;
  expect(issues).toHaveLength(1);
  return issues[0]!;
}

function expectFailure(
  analysis: Record<string, unknown>,
  code: CitationAnchorIssueCode,
  documents: readonly AiDocumentEvidence[] = evidence,
): CitationAnchorIssue {
  const issue = failureOf(analysis, documents);
  expect(issue.code).toBe(code);
  expect(issue.path).toBe(PATH);
  return issue;
}

describe("every anchor failure class still fails closed", () => {
  it("anchor_selector_missing: a text citation with no anchor ids", () => {
    expectFailure(citation({ anchorIds: [] }), "anchor_selector_missing");
  });

  it("anchor_selector_missing: a text citation whose ids are not strings", () => {
    expectFailure(citation({ anchorIds: [7] }), "anchor_selector_missing");
  });

  it("anchor_unknown: an id that exists in no ARC anchor index", () => {
    const issue = expectFailure(citation({ anchorIds: ["P0001-S9999"] }), "anchor_unknown");
    expect(issue.anchorIds).toEqual(["P0001-S9999"]);
  });

  it("anchor_unknown: an anchor-looking string printed inside contract text has no authority", () => {
    expectFailure(citation({ anchorIds: ["P0004-S0001"] }), "anchor_unknown");
  });

  it("anchor_document_mismatch: a documentId ARC never supplied", () => {
    expectFailure(citation({ documentId: "doc-unknown" }), "anchor_document_mismatch");
  });

  it("anchor_page_mismatch: real anchors that are not on the cited physical page", () => {
    expectFailure(
      citation({ pageStart: 2, pageEnd: 2, anchorIds: [page1[0]!.anchorId] }),
      "anchor_page_mismatch",
    );
  });

  it("anchor_text_requires_single_page: a selection spanning two physical pages", () => {
    expectFailure(
      citation({ anchorIds: [page1[0]!.anchorId, page2[0]!.anchorId] }),
      "anchor_text_requires_single_page",
    );
  });

  it("anchor_range_reversed: a backwards selection", () => {
    expectFailure(
      citation({ anchorIds: [page1[1]!.anchorId, page1[0]!.anchorId] }),
      "anchor_range_reversed",
    );
  });

  it("anchor_range_reversed: a noncontiguous selection that skips an anchor", () => {
    expect(page1.length).toBeGreaterThanOrEqual(3);
    expectFailure(
      citation({ anchorIds: [page1[0]!.anchorId, page1[2]!.anchorId] }),
      "anchor_range_reversed",
    );
  });

  it("anchor_range_reversed: a duplicated id is not a contiguous sequence", () => {
    expectFailure(
      citation({ anchorIds: [page1[0]!.anchorId, page1[0]!.anchorId] }),
      "anchor_range_reversed",
    );
  });

  it("anchor_range_too_large: more ids than the provider maximum", () => {
    const ids = widePage.slice(0, CITATION_ANCHOR_MAX_RANGE + 1).map((anchor) => anchor.anchorId);
    expect(ids).toHaveLength(CITATION_ANCHOR_MAX_RANGE + 1);
    const issue = expectFailure(
      citation({ anchorIds: ids }),
      "anchor_range_too_large",
      wideEvidence,
    );
    // Reported ids stay bounded to the provider maximum.
    expect(issue.anchorIds).toHaveLength(CITATION_ANCHOR_MAX_RANGE);
  });

  it("anchor_visual_must_not_select_text: a visual citation carrying text anchor ids", () => {
    expectFailure(
      citation({ evidenceMode: "visual", anchorIds: [page1[0]!.anchorId] }),
      "anchor_visual_must_not_select_text",
    );
  });

  it("anchor_visual_must_not_select_text: a visual citation with a missing anchorIds array", () => {
    expectFailure(
      analysisWith({
        documentId: DOCUMENT_ID,
        pageStart: 1,
        pageEnd: 1,
        evidenceMode: "visual",
        anchorIds: null,
      }),
      "anchor_visual_must_not_select_text",
    );
  });

  it("anchor_excerpt_too_long: the guard exists and is unreachable by construction", () => {
    // Three maximum-length anchors cannot exceed the excerpt bound, so no
    // legal selection can trip this guard. It stays as a defensive stop.
    expect(CITATION_ANCHOR_MAX_RANGE * CITATION_ANCHOR_MAX_CHARS).toBeLessThanOrEqual(
      AI_SCHEMA_BOUNDS.excerpt,
    );
    const source = readFileSync(
      join(process.cwd(), "src/lib/arc/ai/citation-anchor-materializer.ts"),
      "utf8",
    );
    expect(source).toContain("anchor_excerpt_too_long");
  });

  it("reports every failing citation, and never page or excerpt text", () => {
    const analysis = {
      contractAssessment: { commercialSubstance: { citations: [] as unknown[] } },
    };
    analysis.contractAssessment.commercialSubstance.citations.push(
      {
        documentId: DOCUMENT_ID,
        pageStart: 1,
        pageEnd: 1,
        evidenceMode: "text",
        anchorIds: ["P0001-S9999"],
      },
      {
        documentId: "doc-unknown",
        pageStart: 1,
        pageEnd: 1,
        evidenceMode: "text",
        anchorIds: [page1[0]!.anchorId],
      },
    );
    const result = materializeAiCitationAnchors(analysis, evidence);
    expect(result.ok).toBe(false);
    const issues = (result as { ok: false; issues: CitationAnchorIssue[] }).issues;
    expect(issues.map((issue) => issue.code)).toEqual(["anchor_unknown", "anchor_document_mismatch"]);
    const serialized = JSON.stringify(issues);
    expect(serialized).not.toContain("SECTION");
    expect(serialized).not.toContain("245,000");
  });
});

describe("the Phase 9D boundary carries the sanitized diagnostic", () => {
  const guidance = buildGuidancePack({ normalizedEvidenceText: "saas subscription hosted" });

  function clientReturning(analysis: unknown): ResponsesGenerativeClient {
    return {
      responses: {
        create: async () => ({
          id: "resp_diagnostic",
          model: "gpt-5.6-terra",
          output_text: JSON.stringify(analysis),
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        }),
      },
    };
  }

  it("fails closed with structured issue code, path and bounded anchor ids", async () => {
    const analyzer = createTerraAnalyzer(clientReturning(citation({ anchorIds: ["P0001-S9999"] })));
    const error = await analyzer
      .analyze({ canonicalRequest: {}, evidence, guidance })
      .then(() => null)
      .catch((thrown: unknown) => thrown as TerraAnalysisError);

    expect(error).toBeInstanceOf(TerraAnalysisError);
    expect(error!.category).toBe("citation_anchor_failure");
    expect(error!.anchorDiagnostics).toEqual([
      { issueCode: "anchor_unknown", path: PATH, anchorIds: ["P0001-S9999"] },
    ]);
    // Never the model output, page text or a repaired analysis.
    expect(JSON.stringify(error!.anchorDiagnostics)).not.toContain("SECTION");
  });

  it("carries no anchor diagnostics for any other failure category", () => {
    expect(new TerraAnalysisError("api_failure", "x").anchorDiagnostics).toEqual([]);
  });

  it("bounds diagnostics to 20 issues, 3 ids and a 200-character path", () => {
    const error = new TerraAnalysisError(
      "citation_anchor_failure",
      "x",
      [],
      Array.from({ length: 50 }, () => ({
        issueCode: "anchor_unknown",
        path: "p".repeat(400),
        anchorIds: ["a", "b", "c", "d"],
      })),
    );
    expect(error.anchorDiagnostics).toHaveLength(20);
    expect(error.anchorDiagnostics[0]!.path).toHaveLength(200);
    expect(error.anchorDiagnostics[0]!.anchorIds).toHaveLength(3);
  });
});

describe("the bounded server-side diagnostic log", () => {
  it("emits one line with only run id, failure code, issue codes, paths and ids", () => {
    const lines: string[] = [];
    const original = console.error;
    console.error = (line: unknown) => void lines.push(String(line));
    try {
      logCitationAnchorDiagnostic({
        runId: "2cd59eb1-7747-4986-ba05-8a382ca5bf40",
        failureCode: "citation_anchor_failure",
        issues: [
          { issueCode: "anchor_unknown", path: PATH, anchorIds: ["P0001-S9999", "b", "c", "d"] },
        ],
      });
    } finally {
      console.error = original;
    }

    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(Object.keys(entry).sort()).toEqual(["event", "failureCode", "issues", "runId"]);
    expect(entry["runId"]).toBe("2cd59eb1-7747-4986-ba05-8a382ca5bf40");
    expect(entry["issues"]).toEqual([
      { issueCode: "anchor_unknown", path: PATH, anchorIds: ["P0001-S9999", "b", "c"] },
    ]);
  });
});

describe("the orchestrator emits the diagnostic only for this boundary", () => {
  const source = readFileSync(join(process.cwd(), "src/lib/arc/ai/orchestrator.ts"), "utf8");

  it("guards the emission on citation_anchor_failure and keeps failing closed", () => {
    expect(source).toContain(
      'if (terra.category === "citation_anchor_failure" && deps.onCitationAnchorDiagnostic)',
    );
    expect((source.match(/onCitationAnchorDiagnostic\(\{/g) ?? []).length).toBe(1);
    expect(source).toContain("await deps.store.markFailure({");
  });
});
