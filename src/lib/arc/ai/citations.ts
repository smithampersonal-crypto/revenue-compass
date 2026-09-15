/**
 * Phase 9D — deterministic citation and Guidance-reference validation.
 *
 * ARC never trusts a model response because the API accepted the schema. Every
 * citation must point at a document that actually participated in the run, at a
 * real physical page, and — for text evidence — at an excerpt that genuinely
 * occurs in ARC's own local extraction of that page. Every Guidance reference
 * must exist in the compiled registry AND have been supplied in this exact
 * Guidance Pack.
 *
 * This module is pure: it reads, it never mutates the analysis and it never
 * repairs a citation.
 */

import { getGuidanceCard } from "@/lib/arc/guidance/registry";
import type { GuidancePack } from "@/lib/arc/guidance/types";

import { collectCitations, collectGuidanceIds, type AiContractAnalysis } from "./schema";
import type { AiDocumentEvidence } from "./types";

export type AiValidationIssueCode =
  | "unknown_document"
  | "invalid_page_range"
  | "page_out_of_range"
  | "missing_excerpt"
  | "excerpt_not_found"
  | "guidance_not_in_pack"
  | "guidance_not_in_registry";

export interface AiValidationIssue {
  code: AiValidationIssueCode;
  path: string;
  message: string;
}

export type AiCitationVerification = "text_matched" | "visual_page_reference";

export interface AiVerifiedCitation {
  path: string;
  documentId: string;
  pageStart: number;
  pageEnd: number;
  /**
   * A visual citation is validated ONLY as a valid page reference. It is never
   * recorded as text-match verified.
   */
  verification: AiCitationVerification;
}

export interface AiCitationValidationResult {
  ok: boolean;
  citationIssues: AiValidationIssue[];
  guidanceIssues: AiValidationIssue[];
  verifiedCitations: AiVerifiedCitation[];
}

/**
 * Deterministic normalization shared by the excerpt and the local page text.
 * NFKC, soft-hyphen/hyphenation artifact removal, unicode dash and quote
 * folding, lowercase, whitespace collapse. No fuzzy matching, no stemming, no
 * semantic similarity: a fabricated excerpt can never be normalized into a
 * match.
 */
export function normalizeCitationText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\u00ad/g, "")
    .replace(/-\n/g, "")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u2018\u2019\u201b]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function validateAiCitations(
  analysis: AiContractAnalysis,
  evidence: readonly AiDocumentEvidence[],
  guidancePack: GuidancePack,
): AiCitationValidationResult {
  const documents = new Map(evidence.map((document) => [document.documentId, document]));
  const normalizedPages = new Map<string, Map<number, string>>();
  for (const document of evidence) {
    normalizedPages.set(
      document.documentId,
      new Map(document.pages.map((page) => [page.pageNumber, normalizeCitationText(page.text)])),
    );
  }

  const citationIssues: AiValidationIssue[] = [];
  const verifiedCitations: AiVerifiedCitation[] = [];

  for (const { path, citation } of collectCitations(analysis)) {
    const document = documents.get(citation.documentId);
    if (!document) {
      citationIssues.push({
        code: "unknown_document",
        path,
        message: `citation references documentId "${citation.documentId}", which did not participate in this run`,
      });
      continue;
    }

    if (citation.pageStart < 1 || citation.pageEnd < citation.pageStart) {
      citationIssues.push({
        code: "invalid_page_range",
        path,
        message: `citation page range ${citation.pageStart}-${citation.pageEnd} is not a valid ordered range`,
      });
      continue;
    }

    // Physical PDF pages only. Printed footer labels are never used.
    if (citation.pageEnd > document.pageCount) {
      citationIssues.push({
        code: "page_out_of_range",
        path,
        message: `citation page ${citation.pageEnd} exceeds the ${document.pageCount} physical pages of the document`,
      });
      continue;
    }

    if (citation.evidenceMode === "visual") {
      verifiedCitations.push({
        path,
        documentId: citation.documentId,
        pageStart: citation.pageStart,
        pageEnd: citation.pageEnd,
        verification: "visual_page_reference",
      });
      continue;
    }

    const excerpt = citation.excerpt;
    if (excerpt === null || excerpt.trim().length === 0) {
      citationIssues.push({
        code: "missing_excerpt",
        path,
        message: "a text citation requires a non-blank excerpt",
      });
      continue;
    }

    const pages = normalizedPages.get(citation.documentId)!;
    const haystack: string[] = [];
    for (let page = citation.pageStart; page <= citation.pageEnd; page += 1) {
      haystack.push(pages.get(page) ?? "");
    }
    // Multi-page citations are checked against the ordered concatenation.
    const corpus = normalizeCitationText(haystack.join(" "));
    const needle = normalizeCitationText(excerpt);

    if (needle.length === 0 || !corpus.includes(needle)) {
      citationIssues.push({
        code: "excerpt_not_found",
        path,
        message: `the cited excerpt does not occur in ARC's local text for ${citation.documentId} pages ${citation.pageStart}-${citation.pageEnd}`,
      });
      continue;
    }

    verifiedCitations.push({
      path,
      documentId: citation.documentId,
      pageStart: citation.pageStart,
      pageEnd: citation.pageEnd,
      verification: "text_matched",
    });
  }

  const suppliedCardIds = new Set(guidancePack.cards.map((card) => card.id));
  const guidanceIssues: AiValidationIssue[] = [];
  for (const { path, guidanceId } of collectGuidanceIds(analysis)) {
    let existsInRegistry = true;
    try {
      getGuidanceCard(guidanceId);
    } catch {
      existsInRegistry = false;
    }
    if (!existsInRegistry) {
      guidanceIssues.push({
        code: "guidance_not_in_registry",
        path,
        message: `Guidance Card ${guidanceId} does not exist in the compiled Guidance Registry`,
      });
      continue;
    }
    if (!suppliedCardIds.has(guidanceId)) {
      // An existing card that was NOT supplied to the model is still invalid
      // for this run. It is reported, never silently dropped.
      guidanceIssues.push({
        code: "guidance_not_in_pack",
        path,
        message: `Guidance Card ${guidanceId} was not supplied in this run's Guidance Pack`,
      });
    }
  }

  return {
    ok: citationIssues.length === 0 && guidanceIssues.length === 0,
    citationIssues,
    guidanceIssues,
    verifiedCitations,
  };
}
