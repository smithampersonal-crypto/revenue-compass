/**
 * Phase 9F — ARC-owned citation materialization.
 *
 * The provider returns anchor SELECTORS, never excerpt text. This module
 * resolves each selector against ARC's own deterministic anchor index and
 * writes the excerpt itself, taken byte-for-byte from ARC's local page
 * extraction — the same string the strict validator matches against.
 *
 * Properties:
 *   - Fails closed. A selector that cannot be resolved exactly is an error;
 *     nothing is repaired, guessed, trimmed or normalized.
 *   - Authority comes only from ARC's generated anchor index. An anchor id
 *     that appears inside contract text resolves to nothing.
 *   - Diagnostics carry a schema path and anchor ids only: never page text,
 *     excerpt text, prompt, model output or credentials.
 *
 * The excerpt bound and the citation validator are unchanged.
 */

import {
  CITATION_ANCHOR_MAX_RANGE,
  buildCitationAnchorIndex,
  type CitationAnchor,
} from "./citation-anchors";
import { AI_SCHEMA_BOUNDS } from "./schema";
import type { AiDocumentEvidence } from "./types";

export type CitationAnchorIssueCode =
  | "anchor_selector_missing"
  | "anchor_unknown"
  | "anchor_page_mismatch"
  | "anchor_document_mismatch"
  | "anchor_range_reversed"
  | "anchor_range_too_large"
  | "anchor_text_requires_single_page"
  | "anchor_visual_must_not_select_text"
  | "anchor_excerpt_too_long";

export interface CitationAnchorIssue {
  code: CitationAnchorIssueCode;
  path: string;
  message: string;
}

export type CitationAnchorMaterializationResult =
  { ok: true; value: unknown } | { ok: false; issues: CitationAnchorIssue[] };

/** Provider-facing citation nodes are identified structurally, not by path. */
function isProviderCitationNode(node: Record<string, unknown>): boolean {
  return (
    typeof node["documentId"] === "string" &&
    typeof node["pageStart"] === "number" &&
    typeof node["evidenceMode"] === "string" &&
    "anchorStart" in node &&
    "anchorEnd" in node
  );
}

interface Resolver {
  index: Map<string, Map<string, CitationAnchor>>;
  byDocumentPage: Map<string, CitationAnchor[]>;
}

function buildResolver(evidence: readonly AiDocumentEvidence[]): Resolver {
  const index = buildCitationAnchorIndex(evidence);
  const byDocumentPage = new Map<string, CitationAnchor[]>();
  for (const [documentId, anchors] of index) {
    for (const anchor of anchors.values()) {
      const key = `${documentId}#${anchor.pageNumber}`;
      const list = byDocumentPage.get(key) ?? [];
      list.push(anchor);
      byDocumentPage.set(key, list);
    }
  }
  for (const list of byDocumentPage.values()) {
    list.sort((left, right) => left.segmentIndex - right.segmentIndex);
  }
  return { index, byDocumentPage };
}

function materializeCitation(
  node: Record<string, unknown>,
  path: string,
  resolver: Resolver,
  issues: CitationAnchorIssue[],
): Record<string, unknown> | null {
  const documentId = node["documentId"] as string;
  const evidenceMode = node["evidenceMode"] as string;
  const anchorStart = node["anchorStart"];
  const anchorEnd = node["anchorEnd"];

  const base = {
    documentId,
    pageStart: node["pageStart"],
    pageEnd: node["pageEnd"],
    evidenceMode,
  };

  const fail = (code: CitationAnchorIssueCode, message: string) => {
    issues.push({ code, path, message });
    return null;
  };

  if (evidenceMode !== "text") {
    if (anchorStart !== null || anchorEnd !== null) {
      return fail(
        "anchor_visual_must_not_select_text",
        "a visual citation must leave anchorStart and anchorEnd null",
      );
    }
    return { ...base, excerpt: null };
  }

  if (typeof anchorStart !== "string" || typeof anchorEnd !== "string") {
    return fail(
      "anchor_selector_missing",
      "a text citation requires both anchorStart and anchorEnd",
    );
  }

  const documentAnchors = resolver.index.get(documentId);
  if (!documentAnchors) {
    return fail("anchor_document_mismatch", `unknown documentId for anchor ${anchorStart}`);
  }

  const start = documentAnchors.get(anchorStart);
  const end = documentAnchors.get(anchorEnd);
  if (!start || !end) {
    return fail(
      "anchor_unknown",
      `unresolved anchor ${!start ? anchorStart : anchorEnd} in this document`,
    );
  }

  if (start.pageNumber !== end.pageNumber) {
    return fail(
      "anchor_text_requires_single_page",
      `anchors ${anchorStart} and ${anchorEnd} are on different physical pages`,
    );
  }

  if (node["pageStart"] !== start.pageNumber || node["pageEnd"] !== start.pageNumber) {
    return fail("anchor_page_mismatch", `anchor ${anchorStart} is not on the cited physical page`);
  }

  if (end.segmentIndex < start.segmentIndex) {
    return fail("anchor_range_reversed", `anchor range ${anchorStart}..${anchorEnd} runs backward`);
  }

  const span = end.segmentIndex - start.segmentIndex + 1;
  if (span > CITATION_ANCHOR_MAX_RANGE) {
    return fail(
      "anchor_range_too_large",
      `anchor range ${anchorStart}..${anchorEnd} spans ${span} anchors`,
    );
  }

  const pageAnchors = resolver.byDocumentPage.get(`${documentId}#${start.pageNumber}`) ?? [];
  const excerpt = pageAnchors
    .slice(start.segmentIndex - 1, end.segmentIndex)
    .map((anchor) => anchor.text)
    .join("");

  if (excerpt.length > AI_SCHEMA_BOUNDS.excerpt) {
    return fail(
      "anchor_excerpt_too_long",
      `anchor range ${anchorStart}..${anchorEnd} exceeds the excerpt bound`,
    );
  }

  return { ...base, excerpt };
}

/**
 * Deep-clones the raw provider analysis, replacing every provider-facing
 * citation node with ARC's internal citation carrying an ARC-authored
 * excerpt. Returns all issues found rather than throwing.
 */
export function materializeAiCitationAnchors(
  rawModelAnalysis: unknown,
  evidence: readonly AiDocumentEvidence[],
): CitationAnchorMaterializationResult {
  const resolver = buildResolver(evidence);
  const issues: CitationAnchorIssue[] = [];

  const walk = (node: unknown, path: string): unknown => {
    if (Array.isArray(node)) return node.map((entry, index) => walk(entry, `${path}[${index}]`));
    if (node === null || typeof node !== "object") return node;
    const record = node as Record<string, unknown>;
    if (isProviderCitationNode(record)) {
      return materializeCitation(record, path, resolver, issues) ?? record;
    }
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(record)) {
      out[key] = walk(child, path ? `${path}.${key}` : key);
    }
    return out;
  };

  const value = walk(rawModelAnalysis, "");
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value };
}
