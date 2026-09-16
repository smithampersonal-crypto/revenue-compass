/**
 * Phase 9F — deterministic ARC-owned citation anchors.
 *
 * ARC's strict citation validator matches a text excerpt against ARC's OWN
 * local PDF.js extraction of a physical page. Asking a generative model to
 * reproduce that substring byte-for-byte is the wrong contract: the model
 * should decide WHICH evidence supports a conclusion, while ARC produces the
 * exact excerpt string from its own source text.
 *
 * This module segments each physical page into stable, lossless anchors.
 * Concatenating a page's anchor texts in order reconstructs `page.text`
 * exactly: nothing is trimmed, normalized, inserted, dropped or re-ordered.
 *
 * Anchor ids are page-scoped (`P0001-S0001`), so an id alone never identifies
 * a document — `documentId` stays a separate trusted citation field.
 */

import type { AiDocumentEvidence } from "./types";

export const CITATION_ANCHOR_MAX_CHARS = 160;
export const CITATION_ANCHOR_MIN_PREFERRED_CHARS = 80;
export const CITATION_ANCHOR_MAX_RANGE = 3;

export interface CitationAnchor {
  anchorId: string;
  documentId: string;
  pageNumber: number;
  /** 1-based position of this anchor within its page. */
  segmentIndex: number;
  startOffset: number;
  endOffsetExclusive: number;
  text: string;
}

export interface CitationAnchorPage {
  documentId: string;
  pageNumber: number;
  anchors: CitationAnchor[];
}

function pad(value: number): string {
  return String(value).padStart(4, "0");
}

export function citationAnchorId(pageNumber: number, segmentIndex: number): string {
  return `P${pad(pageNumber)}-S${pad(segmentIndex)}`;
}

function isWhitespace(character: string | undefined): boolean {
  return character !== undefined && /\s/.test(character);
}

/**
 * The deterministic boundary search. Starting at `start`, find the exclusive
 * end offset of the next segment: at most 160 characters, preferring — in
 * strict priority order and searching backward from the ceiling to the
 * 80-character floor — a newline, a sentence break, a clause break, then any
 * whitespace. With no preferred boundary the segment is hard-cut at 160.
 */
function nextBoundary(text: string, start: number): number {
  const ceiling = Math.min(start + CITATION_ANCHOR_MAX_CHARS, text.length);
  if (ceiling === text.length) return ceiling;
  const floor = start + CITATION_ANCHOR_MIN_PREFERRED_CHARS;

  const qualifies: Array<(end: number) => boolean> = [
    (end) => text[end - 1] === "\n",
    (end) => isWhitespace(text[end - 1]) && ".?!".includes(text[end - 2] ?? ""),
    (end) => isWhitespace(text[end - 1]) && ";:,".includes(text[end - 2] ?? ""),
    (end) => isWhitespace(text[end - 1]),
  ];

  for (const test of qualifies) {
    for (let end = ceiling; end >= floor; end -= 1) {
      if (test(end)) return end;
    }
  }
  return ceiling;
}

export function buildPageCitationAnchors(
  documentId: string,
  pageNumber: number,
  text: string,
): CitationAnchor[] {
  const anchors: CitationAnchor[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const end = nextBoundary(text, cursor);
    anchors.push({
      anchorId: citationAnchorId(pageNumber, anchors.length + 1),
      documentId,
      pageNumber,
      segmentIndex: anchors.length + 1,
      startOffset: cursor,
      endOffsetExclusive: end,
      text: text.slice(cursor, end),
    });
    cursor = end;
  }
  return anchors;
}

export function buildCitationAnchorPages(
  evidence: readonly AiDocumentEvidence[],
): CitationAnchorPage[] {
  const pages: CitationAnchorPage[] = [];
  for (const document of evidence) {
    for (const page of document.pages) {
      pages.push({
        documentId: document.documentId,
        pageNumber: page.pageNumber,
        anchors: buildPageCitationAnchors(document.documentId, page.pageNumber, page.text),
      });
    }
  }
  return pages;
}

/** Fast lookup for the materializer: `documentId` → `anchorId` → anchor. */
export function buildCitationAnchorIndex(
  evidence: readonly AiDocumentEvidence[],
): Map<string, Map<string, CitationAnchor>> {
  const index = new Map<string, Map<string, CitationAnchor>>();
  for (const page of buildCitationAnchorPages(evidence)) {
    let byId = index.get(page.documentId);
    if (!byId) {
      byId = new Map<string, CitationAnchor>();
      index.set(page.documentId, byId);
    }
    for (const anchor of page.anchors) byId.set(anchor.anchorId, anchor);
  }
  return index;
}
