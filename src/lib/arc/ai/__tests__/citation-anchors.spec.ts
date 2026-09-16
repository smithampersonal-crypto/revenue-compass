/**
 * Phase 9F — deterministic ARC-owned citation anchors.
 *
 * Anchors are a lossless segmentation of ARC's OWN local page extraction: the
 * exact text the strict citation validator matches against. Concatenating a
 * page's anchors must reproduce that page byte for byte.
 */

import { describe, expect, it } from "vitest";

import {
  CITATION_ANCHOR_MAX_CHARS,
  CITATION_ANCHOR_MIN_PREFERRED_CHARS,
  buildCitationAnchorPages,
  type CitationAnchorPage,
} from "../citation-anchors";
import type { AiDocumentEvidence } from "../types";

function document(pages: string[], documentId = "doc-master"): AiDocumentEvidence {
  return {
    documentId,
    displayName: "Master Agreement",
    originalFilename: "master.pdf",
    sha256: "a".repeat(64),
    byteSize: 1024,
    pageCount: pages.length,
    pages: pages.map((text, index) => ({
      pageNumber: index + 1,
      text,
      meaningfulCharacters: text.length,
      readability: "text" as const,
    })),
  };
}

function reconstruct(page: CitationAnchorPage): string {
  return page.anchors.map((anchor) => anchor.text).join("");
}

const LONG_PAGE = [
  "SECTION 1. TERM. The initial term of this Agreement begins on November 1, 2026 and ends on October 31, 2028.",
  "SECTION 2. FEES. Customer shall pay the subscription fee of $245,000 annually in advance, net 30 from the invoice date.",
  "SECTION 3. CREDITS. If uptime falls below 99.9% in any month, Customer receives a service credit equal to 5% of the monthly fee.",
].join("\n");

describe("citation anchors", () => {
  it("reconstructs each page exactly from its anchors", () => {
    const pages = buildCitationAnchorPages([document([LONG_PAGE, "Net 30 — payment is due."])]);
    expect(pages).toHaveLength(2);
    expect(reconstruct(pages[0]!)).toBe(LONG_PAGE);
    expect(reconstruct(pages[1]!)).toBe("Net 30 — payment is due.");
  });

  it("preserves unicode, tabs, carriage returns and trailing whitespace verbatim", () => {
    const text = "  Fee:\t$1.35/sample\u00ad\nSLA — 99.9%\r\n\u201cCredits\u201d   ";
    const pages = buildCitationAnchorPages([document([text])]);
    expect(reconstruct(pages[0]!)).toBe(text);
  });

  it("emits deterministic, page-scoped, zero-padded anchor ids in order", () => {
    const pages = buildCitationAnchorPages([document([LONG_PAGE, LONG_PAGE])]);
    expect(pages[0]!.anchors[0]!.anchorId).toBe("P0001-S0001");
    expect(pages[0]!.anchors[1]!.anchorId).toBe("P0001-S0002");
    expect(pages[1]!.anchors[0]!.anchorId).toBe("P0002-S0001");
    expect(pages[0]!.anchors.map((a) => a.segmentIndex)).toEqual(
      pages[0]!.anchors.map((_, index) => index + 1),
    );
  });

  it("is stable: identical page text always yields identical anchors", () => {
    const first = buildCitationAnchorPages([document([LONG_PAGE])]);
    const second = buildCitationAnchorPages([document([LONG_PAGE])]);
    expect(JSON.stringify(second)).toEqual(JSON.stringify(first));
  });

  it("caps every anchor at the maximum length and records exact offsets", () => {
    const pages = buildCitationAnchorPages([document([LONG_PAGE])]);
    let cursor = 0;
    for (const anchor of pages[0]!.anchors) {
      expect(anchor.text.length).toBeLessThanOrEqual(CITATION_ANCHOR_MAX_CHARS);
      expect(anchor.text.length).toBeGreaterThan(0);
      expect(anchor.startOffset).toBe(cursor);
      expect(anchor.endOffsetExclusive).toBe(cursor + anchor.text.length);
      expect(LONG_PAGE.slice(anchor.startOffset, anchor.endOffsetExclusive)).toBe(anchor.text);
      cursor = anchor.endOffsetExclusive;
    }
    expect(cursor).toBe(LONG_PAGE.length);
  });

  it("prefers a boundary at or after the minimum preferred length", () => {
    const pages = buildCitationAnchorPages([document([LONG_PAGE])]);
    const anchors = pages[0]!.anchors;
    for (const anchor of anchors.slice(0, -1)) {
      expect(anchor.text.length).toBeGreaterThanOrEqual(CITATION_ANCHOR_MIN_PREFERRED_CHARS);
    }
    // The first line ends in a newline well inside the window, so the first
    // anchor stops exactly there rather than mid-sentence.
    expect(anchors[0]!.text).toBe(`${LONG_PAGE.split("\n")[0]!}\n`);
  });

  it("hard-cuts text that offers no boundary in the window", () => {
    const solid = "x".repeat(400);
    const pages = buildCitationAnchorPages([document([solid])]);
    expect(pages[0]!.anchors.map((a) => a.text.length)).toEqual([160, 160, 80]);
    expect(reconstruct(pages[0]!)).toBe(solid);
  });

  it("produces no anchors for an empty page", () => {
    const pages = buildCitationAnchorPages([document(["", "Net 30."])]);
    expect(pages[0]!.anchors).toEqual([]);
    expect(pages[1]!.anchors).toHaveLength(1);
  });

  it("scopes anchors to their own document and page", () => {
    const pages = buildCitationAnchorPages([
      document(["Net 30."], "doc-master"),
      document(["Billed annually."], "doc-order"),
    ]);
    expect(pages.map((page) => page.documentId)).toEqual(["doc-master", "doc-order"]);
    expect(pages[1]!.anchors[0]!.documentId).toBe("doc-order");
    expect(pages[1]!.anchors[0]!.pageNumber).toBe(1);
    // The id alone never identifies a document.
    expect(pages[0]!.anchors[0]!.anchorId).toBe(pages[1]!.anchors[0]!.anchorId);
  });
});
