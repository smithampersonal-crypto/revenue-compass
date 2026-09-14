/**
 * TEMPORARY diagnostic (Phase 8E investigation).
 *
 * Runs the server PDF validator inside the deployed runtime on a tiny
 * synthetic PDF and reports the raw parser failure. No user data, no uploaded
 * bytes, no PDF text. Delete once the root cause is fixed.
 */

import { createFileRoute } from "@tanstack/react-router";

const TINY_PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj
4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
5 0 obj<</Length 90>>stream
BT /F1 12 Tf 20 100 Td (Hello contract text for revenue recognition testing purposes) Tj ET
endstream
endobj
trailer<</Root 1 0 R>>
`;

export const Route = createFileRoute("/api/public/pdf-runtime-check")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const body = new Uint8Array(await request.arrayBuffer());
        const bytes = body.byteLength > 0 ? body : new TextEncoder().encode(TINY_PDF);
        const report: Record<string, unknown> = {
          runtime: typeof navigator !== "undefined" ? String(navigator.userAgent) : "unknown",
          hasDOMMatrix: typeof (globalThis as Record<string, unknown>)["DOMMatrix"] !== "undefined",
          hasPath2D: typeof (globalThis as Record<string, unknown>)["Path2D"] !== "undefined",
          hasImageData: typeof (globalThis as Record<string, unknown>)["ImageData"] !== "undefined",
          hasStructuredClone: typeof structuredClone !== "undefined",
        };

        try {
          const { validatePdfBytes } = await import("@/lib/arc/documents/validation.server");
          report["validate"] = await validatePdfBytes(bytes);
        } catch (error) {
          report["validateThrew"] = {
            name: (error as Error)?.name,
            message: (error as Error)?.message,
          };
        }

        try {
          const mod = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as {
            getDocument: (a: Record<string, unknown>) => { promise: Promise<{ numPages: number }> };
          };
          report["importedParser"] = true;
          const doc = await mod.getDocument({
            data: bytes,
            isEvalSupported: false,
            useSystemFonts: false,
            disableFontFace: true,
            useWorkerFetch: false,
          }).promise;
          report["numPages"] = doc.numPages;
        } catch (error) {
          report["parserError"] = {
            name: (error as Error)?.name,
            message: (error as Error)?.message,
            stack: String((error as Error)?.stack ?? "").split("\n").slice(0, 4),
          };
        }

        return new Response(JSON.stringify(report, null, 2), {
          headers: { "content-type": "application/json", "cache-control": "no-store" },
        });
      },
    },
  },
});
