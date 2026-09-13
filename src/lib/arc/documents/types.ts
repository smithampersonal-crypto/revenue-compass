/**
 * Phase 8B — shared source-document types and product constants.
 *
 * Browser-safe: no Supabase service-role material, no PDF parser, no server
 * storage helpers are reachable from this module.
 */

/** The private bucket. It is never public and never given a permanent URL. */
export const SOURCE_DOCUMENT_BUCKET = "arc-source-documents";

/** 10 MB exactly, matching the Phase 8A row constraint. */
export const MAX_DOCUMENT_BYTES = 10_485_760;

/** Maximum pages ARC accepts, matching the Phase 8A row constraint. */
export const MAX_DOCUMENT_PAGES = 500;

/** Meaningful letters/digits required before a PDF counts as text-based. */
export const MIN_MEANINGFUL_TEXT_CHARACTERS = 50;

/** Signed read links live for exactly fifteen minutes. */
export const SIGNED_READ_TTL_SECONDS = 900;

/** How long an upload intent stays usable. */
export const UPLOAD_INTENT_TTL_SECONDS = 3600;

export const SOURCE_DOCUMENT_TYPES = [
  "Master Agreement",
  "Order Form",
  "Statement of Work",
  "Amendment",
  "Renewal",
  "Pricing / Exhibit",
  "Other",
] as const;

export type SourceDocumentType = (typeof SOURCE_DOCUMENT_TYPES)[number];

/** Stable validation outcome codes; never a parsed parser message. */
export type PdfValidationCode =
  "too_large" | "too_many_pages" | "invalid_pdf" | "password_protected" | "no_extractable_text";

/** Authoritative technical facts. Extracted text is never part of this. */
export interface PdfFacts {
  sha256: string;
  byteSize: number;
  pageCount: number;
}

export type PdfValidationResult =
  ({ ok: true } & PdfFacts) | { ok: false; code: PdfValidationCode; message: string };

export const PDF_VALIDATION_MESSAGES: Record<PdfValidationCode, string> = {
  too_large: "This PDF is larger than 10 MB. ARC currently supports files up to 10 MB.",
  too_many_pages: "This PDF has more than 500 pages. ARC currently supports up to 500 pages.",
  invalid_pdf: "This file could not be read as a PDF. ARC currently supports text-based PDFs only.",
  password_protected:
    "This PDF is password-protected. ARC currently supports unprotected text-based PDFs only.",
  no_extractable_text:
    "This PDF does not contain extractable text. ARC currently supports text-based PDFs only.",
};

export function pdfValidationFailure(code: PdfValidationCode): PdfValidationResult {
  return { ok: false, code, message: PDF_VALIDATION_MESSAGES[code] };
}

/** Everything the browser needs to upload — and nothing more. */
export interface UploadIntentDto {
  intentId: string;
  bucket: string;
  /** Server-assigned pending path; the browser never chooses one. */
  path: string;
  /** One-time signed upload token for exactly that path. */
  token: string;
  expiresAt: string;
}

export interface SourceDocumentDto {
  id: string;
  displayName: string;
  originalFilename: string;
  documentType: SourceDocumentType | null;
  effectiveDate: string | null;
  byteSize: number;
  pageCount: number;
  sha256: string;
  createdAt: string;
  archived: boolean;
}

export type FinalizeUploadResult =
  | {
      ok: true;
      sourceDocumentId: string;
      duplicate: boolean;
      associated: boolean;
      associationConflict: boolean;
      /** Authoritative lock version of the revision or guest workspace. */
      lockVersion: number | null;
    }
  | { ok: false; code: PdfValidationCode | "unavailable"; message: string };

export interface DocumentReadUrlResult {
  url: string;
  expiresInSeconds: number;
}

/** Neutral language for anything the caller may not see. */
export const DOCUMENT_NOT_AVAILABLE = "That document is not available.";
export const GUEST_WORKSPACE_UNAVAILABLE = "That temporary workspace is no longer available.";

/* ------------------------------------------- Phase 8C — workspace read model */

/**
 * Safe per-document metadata for the authenticated workspace. Storage paths,
 * buckets and content hashes are deliberately absent: the browser identifies a
 * document by id alone.
 */
export interface SourceDocumentSummaryDto {
  id: string;
  displayName: string;
  originalFilename: string;
  documentType: SourceDocumentType | null;
  effectiveDate: string | null;
  byteSize: number;
  pageCount: number;
  createdAt: string;
  archived: boolean;
  /** Selected for the loaded revision. */
  selected: boolean;
  /** Referenced by a finalized or superseded revision. */
  inFinalizedHistory: boolean;
  /** Metadata editing is locked once finalized history references it. */
  metadataLocked: boolean;
  /** Permanent deletion is only offered when the server allows it. */
  canDelete: boolean;
}

export interface DocumentWorkspaceRevisionDto {
  revisionId: string;
  revisionNumber: number;
  status: "draft" | "finalized" | "superseded";
  lockVersion: number;
  /** Only an unfinished draft may change its source selection. */
  canEditSources: boolean;
}

export interface DocumentWorkspaceDto {
  revision: DocumentWorkspaceRevisionDto;
  /** The exact subset associated with the loaded revision. */
  selected: SourceDocumentSummaryDto[];
  /** Every document owned by the contract, archived ones included. */
  library: SourceDocumentSummaryDto[];
}

/** Outcome of a trusted source-selection mutation. */
export type SourceMutationResult =
  | { ok: true; lockVersion: number | null }
  | { ok: false; reason: "conflict" | "failed"; message: string };

export const SOURCE_CONFLICT_MESSAGE =
  "This revision changed since this page was loaded, so nothing was changed. ARC has reloaded the current version — please try again.";
