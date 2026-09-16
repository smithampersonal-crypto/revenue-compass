/**
 * Phase 9F — ARC-owned citation materialization.
 *
 * The provider returns ANCHOR IDS, never excerpt text. This module resolves
 * each id against ARC's own deterministic anchor index and writes the excerpt
 * itself, taken byte-for-byte from ARC's local page extraction — the same
 * string the strict validator matches against.
 *
 * Properties:
 *   - Fails closed. A selection that cannot be resolved exactly is an error;
 *     nothing is repaired, guessed, trimmed or normalized.
 *   - Authority comes only from ARC's generated anchor index. An anchor id
 *     that appears inside contract text resolves to nothing.
 *   - Diagnostics carry a schema path and at most three anchor ids: never page
 *     text, excerpt text, prompt, model output or credentials.
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
  /** Bounded to the submitted ids, at most the provider maximum of three. */
  anchorIds?: string[];
}

export type CitationAnchorMaterializationResult =
  { ok: true; value: unknown } | { ok: false; issues: CitationAnchorIssue[] };

/** Provider-facing citation nodes are identified structurally, not by path. */
function isProviderCitationNode(node: Record<string, unknown>): boolean {
  return (
    typeof node["documentId"] === "string" &&
    typeof node["pageStart"] === "number" &&
    typeof node["evidenceMode"] === "string" &&
    "anchorIds" in node
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

/** Only ids the provider actually submitted, capped at the provider maximum. */
function boundedIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .slice(0, CITATION_ANCHOR_MAX_RANGE);
}

function materializeCitation(
  node: Record<string, unknown>,
  path: string,
  resolver: Resolver,
  issues: CitationAnchorIssue[],
): Record<string, unknown> | null {
  const documentId = node["documentId"] as string;
  const evidenceMode = node["evidenceMode"] as string;
  const rawIds = node["anchorIds"];
  const submitted = boundedIds(rawIds);

  const base = {
    documentId,
    pageStart: node["pageStart"],
    pageEnd: node["pageEnd"],
    evidenceMode,
  };

  const fail = (code: CitationAnchorIssueCode, message: string) => {
    issues.push({ code, path, message, anchorIds: submitted });
    return null;
  };

  if (evidenceMode !== "text") {
    if (!Array.isArray(rawIds) || rawIds.length !== 0) {
      return fail(
        "anchor_visual_must_not_select_text",
        "a visual citation must supply an empty anchorIds array",
      );
    }
    return { ...base, excerpt: null };
  }

  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    return fail(
      "anchor_selector_missing",
      "a text citation requires 1 to 3 anchor ids",
    );
  }

  if (rawIds.length > CITATION_ANCHOR_MAX_RANGE) {
    return fail(
      "anchor_range_too_large",
      `a text citation selected ${rawIds.length} anchors`,
    );
  }

  if (!rawIds.every((entry) => typeof entry === "string")) {
    return fail("anchor_selector_missing", "anchor ids must be strings");
  }

  const ids = rawIds as string[];

  const documentAnchors = resolver.index.get(documentId);
  if (!documentAnchors) {
    return fail("anchor_document_mismatch", "unknown documentId for the selected anchors");
  }

  const resolved: CitationAnchor[] = [];
  for (const id of ids) {
    const anchor = documentAnchors.get(id);
    if (!anchor) return fail("anchor_unknown", "an anchor id does not exist in this document");
    resolved.push(anchor);
  }

  const first = resolved[0]!;
  if (resolved.some((anchor) => anchor.pageNumber !== first.pageNumber)) {
    return fail(
      "anchor_text_requires_single_page",
      "the selected anchors are on different physical pages",
    );
  }

  if (node["pageStart"] !== first.pageNumber || node["pageEnd"] !== first.pageNumber) {
    return fail("anchor_page_mismatch", "the selected anchors are not on the cited physical page");
  }

  // Unique, forward, and exactly contiguous. Duplicates, reversed order and
  // skipped segments all fail closed.
  for (let index = 1; index < resolved.length; index += 1) {
    if (resolved[index]!.segmentIndex !== resolved[index - 1]!.segmentIndex + 1) {
      return fail(
        "anchor_range_reversed",
        "the selected anchors are not one unique, forward, contiguous sequence",
      );
    }
  }

  const pageAnchors = resolver.byDocumentPage.get(`${documentId}#${first.pageNumber}`) ?? [];
  const last = resolved[resolved.length - 1]!;
  const span = last.segmentIndex - first.segmentIndex + 1;
  if (span > CITATION_ANCHOR_MAX_RANGE) {
    return fail("anchor_range_too_large", `the selected anchor range spans ${span} anchors`);
  }

  // Concatenate the exact anchor strings in sequence: nothing inserted,
  // removed, normalized or rewritten.
  const excerpt = pageAnchors
    .slice(first.segmentIndex - 1, last.segmentIndex)
    .map((anchor) => anchor.text)
    .join("");

  if (excerpt.length > AI_SCHEMA_BOUNDS.excerpt) {
    return fail("anchor_excerpt_too_long", "the selected anchor range exceeds the excerpt bound");
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
