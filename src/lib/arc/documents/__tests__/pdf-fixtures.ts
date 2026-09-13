/**
 * Phase 8B — deterministic, locally generated PDF fixtures.
 *
 * No network, no checked-in binaries: every fixture is produced byte-for-byte
 * by this module so the validation suite is reproducible. These are test
 * inputs only; nothing here is imported by production code.
 */

const encoder = new TextEncoder();

function escapePdfText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

export interface PdfFixtureOptions {
  /** Number of page objects. */
  pages?: number;
  /** Text drawn on every page; empty string produces a page with no text. */
  text?: string;
  /** Adds a Standard security handler dictionary (encrypted document). */
  encrypted?: boolean;
}

/** Builds a small, structurally valid PDF with a real cross-reference table. */
export function buildPdf(options: PdfFixtureOptions = {}): Uint8Array {
  const pageCount = options.pages ?? 1;
  const text = options.text ?? "ARC source document fixture text";

  const objects: string[] = [];
  const pageObjectNumbers: number[] = [];

  // 1 catalog, 2 pages, 3 font, then (content, page) pairs.
  const firstPageObject = 4;
  for (let index = 0; index < pageCount; index += 1) {
    pageObjectNumbers.push(firstPageObject + index * 2 + 1);
  }

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Count ${pageCount} /Kids [${pageObjectNumbers
    .map((n) => `${n} 0 R`)
    .join(" ")}] >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  for (let index = 0; index < pageCount; index += 1) {
    const contentNumber = firstPageObject + index * 2;
    const pageNumber = contentNumber + 1;
    const stream = text
      ? `BT /F1 12 Tf 20 120 Td (${escapePdfText(`${text} ${index + 1}`)}) Tj ET`
      : "0 0 1 rg 10 10 100 100 re f";
    objects[contentNumber] =
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    objects[pageNumber] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNumber} 0 R >>`;
  }

  const encryptNumber = objects.length;
  if (options.encrypted) {
    const filler = "A".repeat(32);
    objects[encryptNumber] =
      `<< /Filter /Standard /V 1 /R 2 /P -1 ` +
      `/O (${filler}) /U (${filler}) >>`;
  }

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let number = 1; number < objects.length; number += 1) {
    offsets[number] = body.length;
    body += `${number} 0 obj\n${objects[number]}\nendobj\n`;
  }

  const xrefOffset = body.length;
  const total = objects.length;
  let xref = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let number = 1; number < total; number += 1) {
    xref += `${String(offsets[number]).padStart(10, "0")} 00000 n \n`;
  }

  const trailer =
    `trailer\n<< /Size ${total} /Root 1 0 R /ID [<${"0".repeat(32)}> <${"0".repeat(32)}>]` +
    (options.encrypted ? ` /Encrypt ${encryptNumber} 0 R` : "") +
    ` >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return encoder.encode(body + xref + trailer);
}

/** A valid, text-bearing single-page PDF. */
export function validTextPdf(): Uint8Array {
  return buildPdf({ pages: 1, text: "Master services agreement between ARC and Acme Corp" });
}

/** A structurally valid PDF whose pages draw only shapes — no extractable text. */
export function imageOnlyPdf(): Uint8Array {
  return buildPdf({ pages: 2, text: "" });
}

/** A valid PDF with more pages than ARC accepts. */
export function oversizedPageCountPdf(pages = 501): Uint8Array {
  return buildPdf({ pages, text: "Page" });
}

/** An encrypted PDF: the Standard security handler requires a password. */
export function passwordProtectedPdf(): Uint8Array {
  return buildPdf({ pages: 1, text: "Confidential", encrypted: true });
}

/** Bytes that are not a PDF at all. */
export function corruptBytes(): Uint8Array {
  return encoder.encode("this is definitely not a pdf document");
}

/** Bytes larger than the 10 MB ceiling, cheap to allocate. */
export function oversizedBytes(size = 10_485_761): Uint8Array {
  return new Uint8Array(size);
}
