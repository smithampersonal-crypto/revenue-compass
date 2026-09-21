/**
 * ARC v1 — Genomix citation anchor acceptance patch.
 *
 * Two halves, both deterministic and offline:
 *
 *   1. The prompt contract states that `anchorIds` is an explicit ordered list
 *      rather than a [start, end] range, carries the good/bad example pair and
 *      routes negative/absence conclusions to a single specific anchor or to
 *      the already-supported visual mode.
 *   2. The validator is NOT loosened: an endpoint pair still fails, a
 *      four-anchor contiguous text range still fails, one anchor passes, two
 *      and three adjacent anchors pass, and visual with an empty selector
 *      remains valid.
 *
 * No repair, no retry, no reinterpretation of endpoint pairs.
 */

import { describe, expect, it } from "vitest";

import { buildGuidancePack } from "@/lib/arc/guidance/retrieval";

import { materializeAiCitationAnchors } from "../citation-anchor-materializer";
import { buildCitationAnchorPages } from "../citation-anchors";
import { buildAiInstructions } from "../prompt";
import { AI_OUTPUT_SCHEMA_VERSION } from "../schema";
import type { AiDocumentEvidence } from "../types";

const pack = buildGuidancePack({ normalizedEvidenceText: "saas subscription hosted platform" });

function instructions(): string {
  return buildAiInstructions({
    guidance: pack,
    sources: [
      {
        documentId: "doc-master",
        sha256: "a".repeat(64),
        pageCount: 1,
        displayName: "Master Agreement",
        originalFilename: "master.pdf",
      },
    ],
    arcContextFacts: { functionalCurrency: "USD" },
    promptVersion: "arc.ai.prompt.v9",
    outputSchemaVersion: AI_OUTPUT_SCHEMA_VERSION,
  });
}

/* --------------------------------------------------------------- 1. prompt */

describe("prompt contract — anchorIds is a list, never a range", () => {
  it("states the explicit ordered list rule and the 1 / 2-3 adjacent shape", () => {
    const text = instructions();
    expect(text).toContain("explicit ordered list of every cited text segment");
    expect(text).toContain("NOT a [start, end] range");
    expect(text).toContain("1 anchor, or 2 to 3 adjacent consecutive anchors");
  });

  it("forbids endpoint pairs, skipped ids and more than three anchors", () => {
    const text = instructions();
    expect(text).toContain("Never provide only the first and last anchors of a longer section");
    expect(text).toContain("Never skip intervening segment ids");
    expect(text).toContain("Never cite more than 3 text anchors for one citation");
  });

  it("carries the explicit valid/invalid example pair", () => {
    const text = instructions();
    expect(text).toContain('Valid: ["P0003-S0011"]');
    expect(text).toContain('Valid: ["P0003-S0009","P0003-S0010"]');
    expect(text).toContain('Invalid: ["P0003-S0008","P0003-S0011"]');
    expect(text).toContain("skips P0003-S0009 and P0003-S0010");
    expect(text).toContain("incorrectly treats anchor ids as range endpoints");
  });

  it("routes negative and absence conclusions away from manufactured ranges", () => {
    const text = instructions();
    expect(text).toContain("no noncash consideration");
    expect(text).toContain("no significant financing component");
    expect(text).toContain("smallest specific text anchor that directly supports the conclusion");
    expect(text).toContain('use evidenceMode "visual" with anchorIds: []');
    expect(text).toContain(
      "never manufacture a start/end text range to represent broad-page evidence",
    );
  });
});

/* ------------------------------------------------------------ 2. validator */

// Each clause is long enough (>80 chars) and newline-terminated so ARC's
// deterministic segmenter emits exactly one anchor per clause.
const PAGE_TEXT = [
  "Clause one states the annual hosted platform subscription fee payable by the customer in advance.",
  "Clause two states the contracted monthly throughput tier and the included sample processing volume.",
  "Clause three states the validation package scope, deliverables, and the acceptance criteria applied.",
  "Clause four states the committed support hours, escalation path, and the applicable response targets.",
  "Clause five states the governing exceptions, limitations of liability, and the excluded circumstances.",
  "Clause six states the per-sample overage rate applied to usage above the included processing volume.",
  "Clause seven states the business associate agreement execution requirement between the two parties.",
  "Clause eight states the designated cloud hosting region and the applicable data residency commitment.",
  "Clause nine states that all remittance occurs by wire transfer in cash, and no other property changes hands.",
  "Clause ten states the acceptance block, effective date, and the authorised signatories for each party.",
  "Clause eleven states the confidentiality footer applicable to the entire contract package document set.",
].join("\n");

const evidence: AiDocumentEvidence[] = [
  {
    documentId: "doc-master",
    displayName: "Master Agreement",
    originalFilename: "master.pdf",
    sha256: "a".repeat(64),
    byteSize: 4096,
    pageCount: 1,
    pages: [{ pageNumber: 1, text: PAGE_TEXT, readability: "text" }],
  } as AiDocumentEvidence,
];

const anchors = buildCitationAnchorPages(evidence)[0]!.anchors;

function citation(anchorIds: string[], evidenceMode = "text"): unknown {
  return {
    citations: [{ documentId: "doc-master", pageStart: 1, pageEnd: 1, evidenceMode, anchorIds }],
  };
}

function ids(...positions: number[]): string[] {
  return positions.map((position) => anchors[position]!.anchorId);
}

describe("validator regression — endpoint pairs and range bounds still fail closed", () => {
  it("has enough segmentation for the endpoint-pair scenario", () => {
    expect(anchors.length).toBeGreaterThanOrEqual(8);
  });

  it("rejects an endpoint pair that skips intervening anchors", () => {
    const result = materializeAiCitationAnchors(citation(ids(0, 3)), evidence);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.code)).toEqual(["anchor_range_reversed"]);
  });

  it("rejects a four-anchor contiguous text range on the max-range rule", () => {
    const result = materializeAiCitationAnchors(citation(ids(0, 1, 2, 3)), evidence);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.code)).toEqual(["anchor_range_too_large"]);
  });

  it("accepts a single anchor", () => {
    const result = materializeAiCitationAnchors(citation(ids(8)), evidence);
    expect(result.ok).toBe(true);
  });

  it("accepts two adjacent anchors", () => {
    const result = materializeAiCitationAnchors(citation(ids(4, 5)), evidence);
    expect(result.ok).toBe(true);
  });

  it("accepts three adjacent anchors", () => {
    const result = materializeAiCitationAnchors(citation(ids(4, 5, 6)), evidence);
    expect(result.ok).toBe(true);
  });

  it("keeps visual evidence with an empty selector valid", () => {
    const result = materializeAiCitationAnchors(citation([], "visual"), evidence);
    expect(result.ok).toBe(true);
  });

  it("never repairs an endpoint pair into a contiguous range", () => {
    const result = materializeAiCitationAnchors(citation(ids(0, 3)), evidence);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The reported selection is exactly what the model submitted: two ids.
    expect(result.issues[0]!.anchorIds).toEqual(ids(0, 3));
  });
});
