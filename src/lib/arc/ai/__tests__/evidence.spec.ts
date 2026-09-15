/**
 * Phase 9B — Task 3. Complete local PDF page evidence.
 *
 * Every fixture is generated locally and deterministically. These tests prove
 * the AI extraction path reads every physical page, while the Phase 8
 * validator keeps its early-stop behaviour unchanged.
 */

import { describe, expect, it, vi } from "vitest";

import { buildPdf, corruptBytes, passwordProtectedPdf } from "@/lib/arc/documents/__tests__/pdf-fixtures";
import { validatePdfBytes } from "@/lib/arc/documents/validation.server";

import { AiEvidenceError, extractPdfEvidence } from "../evidence.server";
import { READABILITY_THRESHOLDS, classifyReadability } from "../types";

// Fixture glyph runs are short by construction; each drawn line stays well
// inside the fixture page width.
const marker = "ARC page marker";
const textPage = "hosted access terms\nservice credit terms\nuptime commitment";

function args(bytes: Uint8Array, overrides: Record<string, unknown> = {}) {
  return {
    documentId: "11111111-1111-4111-8111-111111111111",
    displayName: "Master Agreement",
    originalFilename: "master-agreement.pdf",
    sha256: "a".repeat(64),
    bytes,
    ...overrides,
  } as Parameters<typeof extractPdfEvidence>[0];
}

describe("readability thresholds", () => {
  it("classifies deterministically from one configuration location", () => {
    expect(READABILITY_THRESHOLDS.text).toBe(50);
    expect(classifyReadability(0)).toBe("no_text");
    expect(classifyReadability(1)).toBe("low_text");
    expect(classifyReadability(49)).toBe("low_text");
    expect(classifyReadability(50)).toBe("text");
  });
});

describe("extractPdfEvidence", () => {
  it("extracts every physical page and keeps page numbering", async () => {
    const evidence = await extractPdfEvidence(args(buildPdf({ pages: 6, text: marker })));

    expect(evidence.pageCount).toBe(6);
    expect(evidence.pages).toHaveLength(6);
    expect(evidence.pages.map((page) => page.pageNumber)).toEqual([1, 2, 3, 4, 5, 6]);
    // Page boundaries are retained: each page carries only its own marker.
    expect(evidence.pages[0]!.text).toContain(`${marker} 1`);
    expect(evidence.pages[0]!.text).not.toContain(`${marker} 2`);
    expect(evidence.pages[5]!.text).toContain(`${marker} 6`);
  });

  it("carries the caller's authoritative document identity through unchanged", async () => {
    const bytes = buildPdf({ pages: 1, text: marker });
    const evidence = await extractPdfEvidence(
      args(bytes, { documentId: "doc-1", sha256: "b".repeat(64) }),
    );

    expect(evidence.documentId).toBe("doc-1");
    expect(evidence.displayName).toBe("Master Agreement");
    expect(evidence.originalFilename).toBe("master-agreement.pdf");
    expect(evidence.sha256).toBe("b".repeat(64));
    expect(evidence.byteSize).toBe(bytes.byteLength);
  });

  it("reports zero-text, low-text and ordinary pages as diagnostics", async () => {
    const evidence = await extractPdfEvidence(
      args(buildPdf({ pageTexts: ["", "Ab cd", textPage] })),
    );

    expect(evidence.pages.map((page) => page.readability)).toEqual([
      "no_text",
      "low_text",
      "text",
    ]);
    expect(evidence.pages[0]!.meaningfulCharacters).toBe(0);
    expect(evidence.pages[0]!.text).toBe("");
    expect(evidence.pages[1]!.meaningfulCharacters).toBe(4);
    expect(evidence.pages[2]!.meaningfulCharacters).toBeGreaterThanOrEqual(50);
  });

  it("preserves non-ASCII characters produced by the parser", async () => {
    const evidence = await extractPdfEvidence(args(buildPdf({ pageTexts: ["Caf\\351 Ma\\361ana"] })));
    expect(evidence.pages[0]!.text).toMatch(/[^\x00-\x7F]/);
  });

  it("carries Unicode text through normalization unchanged", async () => {
    const loadParser = async () => ({
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: 1,
          getPage: async () => ({
            getTextContent: async () => ({
              items: [{ str: "Ünïcodé  契約" }, { str: "条項", hasEOL: true }],
            }),
          }),
          destroy: async () => undefined,
        }),
      }),
    });

    const evidence = await extractPdfEvidence(args(buildPdf()), {
      loadParser: loadParser as never,
    });
    expect(evidence.pages[0]!.text).toBe("Ünïcodé 契約 条項");
    expect(evidence.pages[0]!.meaningfulCharacters).toBe(11);
  });

  it("rejects bytes that are not a PDF", async () => {
    await expect(extractPdfEvidence(args(corruptBytes()))).rejects.toMatchObject({
      code: "invalid_pdf",
    });
  });

  it("rejects an encrypted document", async () => {
    await expect(extractPdfEvidence(args(passwordProtectedPdf()))).rejects.toBeInstanceOf(
      AiEvidenceError,
    );
  });

  it("destroys the parser document on success", async () => {
    const destroy = vi.fn(async () => undefined);
    const loadParser = async () => ({
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: 1,
          getPage: async () => ({
            getTextContent: async () => ({ items: [{ str: marker }] }),
          }),
          destroy,
        }),
      }),
    });

    await extractPdfEvidence(args(buildPdf()), { loadParser: loadParser as never });
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("destroys the parser document when a page read fails", async () => {
    const destroy = vi.fn(async () => undefined);
    const loadParser = async () => ({
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: 2,
          getPage: async () => {
            throw new Error("page boom");
          },
          destroy,
        }),
      }),
    });

    await expect(
      extractPdfEvidence(args(buildPdf()), { loadParser: loadParser as never }),
    ).rejects.toBeInstanceOf(AiEvidenceError);
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});

describe("Phase 8 validator early stop vs AI full read", () => {
  it("validator may stop early while the extractor reads every page", async () => {
    const pages = 12;
    const bytes = buildPdf({ pages, text: marker });

    let validatorPageReads = 0;
    let extractorPageReads = 0;

    const pageItem = "Master services agreement between ARC and Acme Corporation";
    const parserFor = (counter: () => void) => async () => ({
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: pages,
          getPage: async () => {
            counter();
            return { getTextContent: async () => ({ items: [{ str: pageItem }] }) };
          },
          destroy: async () => undefined,
        }),
      }),
    });

    const validated = await validatePdfBytes(bytes, {
      loadParser: parserFor(() => {
        validatorPageReads += 1;
      }) as never,
    });
    const evidence = await extractPdfEvidence(args(bytes), {
      loadParser: parserFor(() => {
        extractorPageReads += 1;
      }) as never,
    });

    expect(validated.ok).toBe(true);
    expect(validatorPageReads).toBe(1);
    expect(extractorPageReads).toBe(pages);
    expect(evidence.pages).toHaveLength(pages);
  });
});
