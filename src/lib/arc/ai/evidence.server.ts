/**
 * Phase 9B — Task 3. Complete local PDF page evidence.
 *
 * Server-only. This is a parallel deterministic control path, not the AI's
 * representation of the contract: Terra later receives the original selected
 * PDFs themselves. The text produced here supports Guidance Pack retrieval,
 * readability diagnostics, page bookkeeping and later citation cross-checking.
 *
 * Unlike `validatePdfBytes()`, this path reads EVERY physical page and never
 * stops once the document-level meaningful-text threshold is met. Phase 8
 * validation behaviour is untouched.
 *
 * Extracted text is ephemeral: it is never persisted, logged or thrown.
 */

import {
  classifyParserError,
  countMeaningfulCharacters,
  loadPdfParser,
  pdfDocumentOptions,
  type LoadPdfParser,
  type PdfTextItem,
} from "@/lib/arc/documents/pdf-parser.server";

import { classifyReadability, type AiDocumentEvidence, type AiPageEvidence } from "./types";

export class AiEvidenceError extends Error {
  readonly code: "invalid_pdf" | "password_protected";
  constructor(code: "invalid_pdf" | "password_protected") {
    super(`Local PDF evidence extraction failed (${code}).`);
    this.name = "AiEvidenceError";
    this.code = code;
  }
}

export interface ExtractPdfEvidenceOptions {
  /** Injected by tests only; production always uses the hardened loader. */
  loadParser?: LoadPdfParser;
}

/**
 * Conservative whitespace normalization only. No table reconstruction, no
 * reading-order heuristics, no OCR, no summarization.
 */
function normalizePageText(parts: string[]): string {
  return parts
    .join("")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractPdfEvidence(
  args: {
    documentId: string;
    displayName: string;
    originalFilename: string;
    sha256: string;
    bytes: Uint8Array;
  },
  options: ExtractPdfEvidenceOptions = {},
): Promise<AiDocumentEvidence> {
  const parser = await (options.loadParser ?? loadPdfParser)();

  let document;
  try {
    document = await parser.getDocument(pdfDocumentOptions(args.bytes)).promise;
  } catch (error) {
    throw new AiEvidenceError(classifyParserError(error));
  }

  try {
    const pageCount = document.numPages;
    if (!Number.isInteger(pageCount) || pageCount <= 0) throw new AiEvidenceError("invalid_pdf");

    const pages: AiPageEvidence[] = [];
    // Every physical page, in physical page order, numbered exactly as the PDF
    // numbers it.
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      let content: { items: unknown[] };
      try {
        content = await (await document.getPage(pageNumber)).getTextContent();
      } catch (error) {
        throw new AiEvidenceError(classifyParserError(error));
      }

      const parts: string[] = [];
      for (const item of content.items) {
        const entry = item as PdfTextItem;
        if (typeof entry.str !== "string") continue;
        parts.push(entry.str);
        parts.push(entry.hasEOL ? "\n" : " ");
      }

      const text = normalizePageText(parts);
      const meaningfulCharacters = countMeaningfulCharacters(text);
      pages.push({
        pageNumber,
        text,
        meaningfulCharacters,
        readability: classifyReadability(meaningfulCharacters),
      });
    }

    return {
      documentId: args.documentId,
      displayName: args.displayName,
      originalFilename: args.originalFilename,
      sha256: args.sha256,
      byteSize: args.bytes.byteLength,
      pageCount,
      pages,
    };
  } finally {
    await document.destroy?.().catch(() => undefined);
  }
}
