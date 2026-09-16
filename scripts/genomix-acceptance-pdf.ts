/**
 * Deterministic four-page Genomix / Synthesis BioAnalytics acceptance PDF.
 *
 * Built byte-for-byte from the verbatim four-page contract text already used in
 * Phase 9A/9B. Nothing is checked in as a binary and nothing is downloaded.
 * A monospaced font on a Letter page preserves the order-form and SLA column
 * alignment, so the pricing and service-credit tables survive as real visual
 * table structure in the rendered pages.
 *
 * Fictional contract. Developer acceptance only.
 */

import { GENOMIX_FULL_CONTRACT_TEXT } from "@/lib/arc/guidance/__tests__/genomix-fixture";

const encoder = new TextEncoder();

/** WinAnsi-safe transliteration of the typographic characters in the fixture. */
function toAscii(value: string): string {
  return value
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u2018\u2019\u201b]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2265/g, ">=")
    .replace(/\u2264/g, "<=")
    .replace(/\u00f7/g, "/")
    .replace(/\u00d7/g, "x")
    .replace(/\u2026/g, "...")
    .replace(/\u00a0/g, " ")
    .replace(/[^\x20-\x7e\n]/g, " ");
}

function escapePdfText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** Splits the fixture on its printed "Page N of 4" markers, marker included. */
export function genomixPageTexts(): string[] {
  const text = toAscii(GENOMIX_FULL_CONTRACT_TEXT);
  const pages: string[] = [];
  let buffer: string[] = [];
  for (const line of text.split("\n")) {
    buffer.push(line);
    if (/Page \d+ of 4\s*$/.test(line)) {
      pages.push(buffer.join("\n"));
      buffer = [];
    }
  }
  if (buffer.join("").trim().length > 0) pages.push(buffer.join("\n"));
  return pages;
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const FONT_SIZE = 6.2;
const LEADING = 8.2;
const LEFT = 24;
const TOP = PAGE_HEIGHT - 32;
const MAX_LINES = Math.floor((TOP - 24) / LEADING);

function pageContent(pageText: string): string {
  const lines = pageText.split("\n").slice(0, MAX_LINES);
  const drawn = lines.map(
    (line, row) =>
      `BT /F1 ${FONT_SIZE} Tf ${LEFT} ${(TOP - row * LEADING).toFixed(2)} Td (${escapePdfText(
        line,
      )}) Tj ET`,
  );
  return drawn.join("\n");
}

/** Structurally valid PDF with a real cross-reference table. */
export function buildGenomixAcceptancePdf(): Uint8Array {
  const pages = genomixPageTexts();
  const objects: string[] = [];
  const pageObjectNumbers: number[] = [];
  const firstPageObject = 4;
  for (let index = 0; index < pages.length; index += 1) {
    pageObjectNumbers.push(firstPageObject + index * 2 + 1);
  }

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Count ${pages.length} /Kids [${pageObjectNumbers
    .map((n) => `${n} 0 R`)
    .join(" ")}] >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>";

  pages.forEach((pageText, index) => {
    const contentNumber = firstPageObject + index * 2;
    const pageNumber = contentNumber + 1;
    const stream = pageContent(pageText);
    objects[contentNumber] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    objects[pageNumber] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNumber} 0 R >>`;
  });

  let pdf = "%PDF-1.7\n";
  const offsets: number[] = [];
  for (let number = 1; number < objects.length; number += 1) {
    offsets[number] = encoder.encode(pdf).byteLength;
    pdf += `${number} 0 obj\n${objects[number]}\nendobj\n`;
  }
  const xrefOffset = encoder.encode(pdf).byteLength;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let number = 1; number < objects.length; number += 1) {
    pdf += `${String(offsets[number]).padStart(10, "0")} 00000 n \n`;
  }
  pdf +=
    `trailer\n<< /Size ${objects.length} /Root 1 0 R /ID [<${"0".repeat(32)}> <${"0".repeat(32)}>] >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;

  return encoder.encode(pdf);
}
