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

import { validateMaterialProvenance, type AiProvenanceIssue } from "./provenance";
import { collectCitations, collectGuidanceIds, type AiContractAnalysis } from "./schema";
import type { AiDocumentEvidence } from "./types";

export type AiValidationIssueCode =
  | "unknown_document"
  | "invalid_page_range"
  | "page_out_of_range"
  | "missing_excerpt"
  | "excerpt_not_found"
  | "guidance_not_in_pack"
  | "guidance_not_in_registry"
  | "missing_material_citation";

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
  /** Material conclusions asserted without any contract provenance. */
  provenanceIssues: AiValidationIssue[];
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

  const provenanceIssues: AiValidationIssue[] = validateMaterialProvenance(analysis).map(
    (issue: AiProvenanceIssue) => ({
      code: issue.code,
      path: issue.path,
      message: issue.message,
    }),
  );

  return {
    ok: citationIssues.length === 0 && guidanceIssues.length === 0 && provenanceIssues.length === 0,
    citationIssues,
    guidanceIssues,
    provenanceIssues,
    verifiedCitations,
  };
}

/* ------------------------------------------------------------ diagnostics */

/**
 * Developer-only, bounded diagnosis of `excerpt_not_found` issues, used by the
 * fictional Phase 9F acceptance fixture to tell a whitespace/punctuation
 * difference, a wrong-page citation and an actual paraphrase apart. It never
 * returns full page text and never returns the model response; the excerpt
 * preview is hard-bounded.
 *
 * Diagnosis ONLY. None of these classifications makes a citation valid: the
 * strict validator above is unchanged and still rejects every one of them.
 */
export type AiExcerptDifference =
  | "normalized_match_unexpected"
  | "punctuation_or_whitespace"
  | "wrong_page"
  | "paraphrase_or_absent";

export interface AiExcerptDiagnostic {
  path: string;
  documentId: string;
  pageStart: number;
  pageEnd: number;
  evidenceMode: "text" | "visual";
  excerptPreview: string;
  difference: AiExcerptDifference;
  /** For `wrong_page`: the first page of the same ARC document that contains it. */
  foundOnPage: number | null;
}

const EXCERPT_PREVIEW_LENGTH = 120;

function alphanumericFold(value: string): string {
  return normalizeCitationText(value).replace(/[^a-z0-9]/g, "");
}

export function diagnoseExcerptMismatches(
  analysis: AiContractAnalysis,
  evidence: readonly AiDocumentEvidence[],
  issues: readonly AiValidationIssue[],
  limit = 25,
): AiExcerptDiagnostic[] {
  const failedPaths = new Set(
    issues.filter((issue) => issue.code === "excerpt_not_found").map((issue) => issue.path),
  );
  const documents = new Map(evidence.map((document) => [document.documentId, document]));

  const out: AiExcerptDiagnostic[] = [];
  for (const { path, citation } of collectCitations(analysis)) {
    if (!failedPaths.has(path) || out.length >= limit) continue;
    const document = documents.get(citation.documentId);
    const pageText = new Map((document?.pages ?? []).map((page) => [page.pageNumber, page.text]));

    const parts: string[] = [];
    for (let page = citation.pageStart; page <= citation.pageEnd; page += 1) {
      parts.push(pageText.get(page) ?? "");
    }
    const excerpt = citation.excerpt ?? "";
    const citedNormalized = normalizeCitationText(parts.join(" "));
    const citedFolded = alphanumericFold(parts.join(" "));
    const needleNormalized = normalizeCitationText(excerpt);
    const needleFolded = alphanumericFold(excerpt);

    let difference: AiExcerptDifference = "paraphrase_or_absent";
    let foundOnPage: number | null = null;

    if (needleNormalized.length > 0 && citedNormalized.includes(needleNormalized)) {
      // Should be unreachable while validation and diagnosis agree.
      difference = "normalized_match_unexpected";
    } else if (needleFolded.length > 0 && citedFolded.includes(needleFolded)) {
      difference = "punctuation_or_whitespace";
    } else if (needleFolded.length > 0) {
      for (const page of document?.pages ?? []) {
        if (page.pageNumber >= citation.pageStart && page.pageNumber <= citation.pageEnd) continue;
        if (
          normalizeCitationText(page.text).includes(needleNormalized) ||
          alphanumericFold(page.text).includes(needleFolded)
        ) {
          difference = "wrong_page";
          foundOnPage = page.pageNumber;
          break;
        }
      }
    }

    out.push({
      path,
      documentId: citation.documentId,
      pageStart: citation.pageStart,
      pageEnd: citation.pageEnd,
      evidenceMode: citation.evidenceMode,
      excerptPreview: excerpt.slice(0, EXCERPT_PREVIEW_LENGTH),
      difference,
      foundOnPage,
    });
  }
  return out;
}

/* --------------------------------------------- bounded failure detail budget */

/** Hard privacy bound on the detail strings carried by a validation failure. */
export const MAX_VALIDATION_DETAILS = 40;
const MAX_ORDINARY_PATHS = 10;

export interface ValidationFailureDetailArgs {
  validation: AiCitationValidationResult;
  analysis: AiContractAnalysis;
  evidence: readonly AiDocumentEvidence[];
  includeExcerptDiagnostics?: boolean;
}

/**
 * Allocates the bounded 40-slot detail budget.
 *
 * Diagnostics OFF (production): the existing safe `code at path` summaries.
 * Diagnostics ON (developer-only): 1 aggregate count line, at most 10
 * representative ordinary issue paths, and ALL remaining slots reserved for
 * excerpt mismatch classification — so an `excerpt_not_found` storm can never
 * starve the classification lines.
 */
export function buildValidationFailureDetails(args: ValidationFailureDetailArgs): string[] {
  const { validation, analysis, evidence, includeExcerptDiagnostics } = args;
  const ordinary = [
    ...validation.citationIssues,
    ...validation.guidanceIssues,
    ...validation.provenanceIssues,
  ].map((issue) => `${issue.code} at ${issue.path}`);

  if (!includeExcerptDiagnostics) return ordinary.slice(0, MAX_VALIDATION_DETAILS);

  const counts = new Map<string, number>();
  for (const issue of [
    ...validation.citationIssues,
    ...validation.guidanceIssues,
    ...validation.provenanceIssues,
  ]) {
    counts.set(issue.code, (counts.get(issue.code) ?? 0) + 1);
  }
  const countLine = `validation counts: ${[...counts.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([code, total]) => `${code}=${total}`)
    .join(" ")}`;

  const details: string[] = [countLine];
  details.push(...ordinary.slice(0, MAX_ORDINARY_PATHS));

  const remaining = MAX_VALIDATION_DETAILS - details.length;
  if (remaining <= 0) return details.slice(0, MAX_VALIDATION_DETAILS);

  for (const diagnostic of diagnoseExcerptMismatches(
    analysis,
    evidence,
    validation.citationIssues,
    remaining,
  )) {
    const found = diagnostic.foundOnPage === null ? "" : ` found p${diagnostic.foundOnPage}`;
    details.push(
      `mismatch ${diagnostic.path} cited p${diagnostic.pageStart}-${diagnostic.pageEnd}` +
        `${found} [${diagnostic.evidenceMode}] ${diagnostic.difference} ` +
        `excerpt="${diagnostic.excerptPreview}"`,
    );
  }

  return details.slice(0, MAX_VALIDATION_DETAILS);
}

