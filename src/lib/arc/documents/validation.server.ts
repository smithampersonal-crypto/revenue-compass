/**
 * Phase 8B — authoritative, server-only PDF validation.
 *
 * This module parses the actual uploaded bytes. It is never reachable from the
 * browser bundle: the parser is loaded dynamically inside the function and the
 * `.server` filename keeps it out of client graphs.
 *
 * The validator returns technical facts (SHA-256, byte size, page count) or a
 * stable failure code. Extracted text is read only to decide whether the
 * document is text-based; it is never returned, logged, persisted, or thrown.
 */

import { createHash } from "node:crypto";

import {
  classifyParserError,
  countMeaningfulCharacters,
  loadPdfParser,
  pdfDocumentOptions,
  type LoadPdfParser,
  type PdfDocument,
  type PdfTextItem,
} from "./pdf-parser.server";
import {
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENT_PAGES,
  MIN_MEANINGFUL_TEXT_CHARACTERS,
  pdfValidationFailure,
  type PdfValidationResult,
} from "./types";

export { countMeaningfulCharacters };

export interface ValidatePdfOptions {
  /** Injected only by tests that must prove the parser was not reached. */
  loadParser?: LoadPdfParser;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function validatePdfBytes(
  bytes: Uint8Array,
  options: ValidatePdfOptions = {},
): Promise<PdfValidationResult> {
  // Size is checked before the parser is ever touched.
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) return pdfValidationFailure("too_large");
  if (bytes.byteLength === 0) return pdfValidationFailure("invalid_pdf");

  const sha256 = sha256Hex(bytes);
  const parser = await (options.loadParser ?? loadPdfParser)();

  let document: PdfDocument;
  try {
    document = await parser.getDocument(pdfDocumentOptions(bytes)).promise;
  } catch (error) {
    return pdfValidationFailure(classifyParserError(error));
  }

  try {
    const pageCount = document.numPages;
    if (!Number.isInteger(pageCount) || pageCount <= 0) return pdfValidationFailure("invalid_pdf");
    if (pageCount > MAX_DOCUMENT_PAGES) return pdfValidationFailure("too_many_pages");

    let meaningful = 0;
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      let content: { items: unknown[] };
      try {
        content = await (await document.getPage(pageNumber)).getTextContent();
      } catch (error) {
        return pdfValidationFailure(classifyParserError(error));
      }
      for (const item of content.items) {
        const text = (item as PdfTextItem).str;
        if (typeof text === "string") meaningful += countMeaningfulCharacters(text);
      }
      // Document-level test: stop as soon as the threshold is met. Pages may be
      // image-only scans, exhibits or signature pages.
      if (meaningful >= MIN_MEANINGFUL_TEXT_CHARACTERS) break;
    }

    if (meaningful < MIN_MEANINGFUL_TEXT_CHARACTERS) {
      return pdfValidationFailure("no_extractable_text");
    }

    return { ok: true, sha256, byteSize: bytes.byteLength, pageCount };
  } finally {
    await document.destroy?.().catch(() => undefined);
  }
}
