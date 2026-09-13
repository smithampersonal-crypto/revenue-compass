/**
 * Phase 8B — server PDF validation.
 *
 * Every fixture is generated locally and deterministically. The validator is
 * authoritative over the actual bytes; no assertion here (and nothing the
 * validator returns) ever contains extracted document text.
 */

import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { MAX_DOCUMENT_BYTES } from "../types";
import { validatePdfBytes } from "../validation.server";
import {
  corruptBytes,
  imageOnlyPdf,
  oversizedBytes,
  oversizedPageCountPdf,
  passwordProtectedPdf,
  validTextPdf,
} from "./pdf-fixtures";

describe("validatePdfBytes", () => {
  it("rejects anything over 10 MB without invoking the parser", async () => {
    const parser = vi.fn();
    const result = await validatePdfBytes(oversizedBytes(MAX_DOCUMENT_BYTES + 1), {
      loadParser: parser as never,
    });

    expect(result).toMatchObject({ ok: false, code: "too_large" });
    expect(parser).not.toHaveBeenCalled();
  });

  it("accepts a text-based PDF and reports authoritative facts only", async () => {
    const bytes = validTextPdf();
    const result = await validatePdfBytes(bytes);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.byteSize).toBe(bytes.byteLength);
    expect(result.pageCount).toBe(1);
    expect(result.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    // Authoritative facts only — no text, no per-page content.
    expect(Object.keys(result).sort()).toEqual(["byteSize", "ok", "pageCount", "sha256"]);
  });

  it("rejects a document with more than 500 pages", async () => {
    const result = await validatePdfBytes(oversizedPageCountPdf(501));
    expect(result).toMatchObject({ ok: false, code: "too_many_pages" });
  });

  it("rejects bytes that are not a PDF", async () => {
    const result = await validatePdfBytes(corruptBytes());
    expect(result).toMatchObject({ ok: false, code: "invalid_pdf" });
  });

  it("rejects empty data as an invalid PDF", async () => {
    const result = await validatePdfBytes(new Uint8Array(0));
    expect(result).toMatchObject({ ok: false, code: "invalid_pdf" });
  });

  it("maps an encrypted document to password_protected", async () => {
    const result = await validatePdfBytes(passwordProtectedPdf());
    expect(result).toMatchObject({ ok: false, code: "password_protected" });
    if (result.ok) return;
    expect(result.message).toContain("password-protected");
  });

  it("rejects a PDF with no extractable text", async () => {
    const result = await validatePdfBytes(imageOnlyPdf());
    expect(result).toMatchObject({ ok: false, code: "no_extractable_text" });
  });

  it("stops reading pages once the meaningful-text threshold is reached", async () => {
    const result = await validatePdfBytes(oversizedPageCountPdf(20));
    expect(result.ok).toBe(true);
  });

  it("never returns extracted text in any shape", async () => {
    const result = await validatePdfBytes(validTextPdf());
    expect(JSON.stringify(result)).not.toMatch(/Master services agreement/i);
  });
});
