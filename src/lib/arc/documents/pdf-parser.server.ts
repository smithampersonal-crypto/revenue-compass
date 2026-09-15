/**
 * Server-only PDF.js parser boundary, shared by the Phase 8 validator and the
 * Phase 9 AI evidence extractor.
 *
 * The parser configuration here is the hardened Phase 8 configuration and is
 * the only place it is written. Nothing in this module is reachable from the
 * browser: the `.server` filename keeps it out of client graphs and the parser
 * itself is imported dynamically.
 */

export interface PdfTextItem {
  str?: string;
  hasEOL?: boolean;
}

export interface PdfPage {
  getTextContent(): Promise<{ items: unknown[] }>;
}

export interface PdfDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
  destroy?(): Promise<void>;
}

export interface PdfParser {
  getDocument(args: Record<string, unknown>): { promise: Promise<PdfDocument> };
}

export type LoadPdfParser = () => Promise<PdfParser>;

export async function loadPdfParser(): Promise<PdfParser> {
  // The deployed server runtime has no runtime module resolution, so pdf.js's
  // "fake worker" fallback (a dynamic import of pdf.worker.mjs) fails there and
  // every document is reported as unreadable. Registering the worker module up
  // front — it is bundled because this import is static-equivalent — makes
  // pdf.js reuse it instead of resolving a path at runtime.
  const globals = globalThis as Record<string, unknown>;
  if (!globals["pdfjsWorker"]) {
    globals["pdfjsWorker"] = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  }
  const module = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfParser;
  return module;
}

/** The exact hardened options used everywhere ARC parses a PDF. */
export function pdfDocumentOptions(bytes: Uint8Array): Record<string, unknown> {
  return {
    // A copy: pdf.js transfers/detaches the buffer it is handed.
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
    useWorkerFetch: false,
  };
}

export function classifyParserError(error: unknown): "password_protected" | "invalid_pdf" {
  const name = (error as { name?: string } | null)?.name ?? "";
  return name === "PasswordException" ? "password_protected" : "invalid_pdf";
}

/** Counts Unicode letters and numbers only; whitespace and controls do not count. */
export function countMeaningfulCharacters(value: string): number {
  let count = 0;
  for (const character of value) {
    if (/\p{L}|\p{N}/u.test(character)) count += 1;
  }
  return count;
}
