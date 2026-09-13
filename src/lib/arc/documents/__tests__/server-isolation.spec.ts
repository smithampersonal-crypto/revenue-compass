/**
 * Phase 8B — server-only isolation.
 *
 * The PDF parser, the service-role store and the private Storage helpers must
 * never be reachable from a browser bundle. Client-importable server-function
 * modules may only reach them through a dynamic import inside a handler.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DIR = "src/lib/arc/documents";

function read(file: string): string {
  return readFileSync(`${DIR}/${file}`, "utf8");
}

const CLIENT_REACHABLE = [
  "documents.functions.ts",
  "guest-documents.functions.ts",
  "upload-client.ts",
  "types.ts",
];

describe("source-document server isolation", () => {
  it("never statically imports a server-only module from client-reachable code", () => {
    for (const file of CLIENT_REACHABLE) {
      const source = read(file);
      const staticImports = [...source.matchAll(/^import[^;]*?from\s+"([^"]+)";/gm)].map(
        (match) => match[1]!,
      );
      expect(staticImports.filter((specifier) => specifier.includes(".server"))).toEqual([]);
      expect(staticImports).not.toContain("pdfjs-dist");
      expect(staticImports.some((s) => s.includes("client.server"))).toBe(false);
    }
  });

  it("loads the parser and the service-role store only inside handlers", () => {
    const store = read("documents.store.server.ts");
    expect(store).toContain('await import("@/integrations/supabase/client.server")');

    const handlers = read("documents.handlers.ts");
    // The handlers are pure orchestration: the validator arrives as a
    // dependency or through a dynamic import, never as a static one.
    expect(handlers).not.toMatch(/^import .*validation\.server/m);
    expect(handlers).toContain('await import("./validation.server")');
  });

  it("keeps every privileged helper behind a .server filename", () => {
    expect(() => read("validation.server.ts")).not.toThrow();
    expect(() => read("storage.server.ts")).not.toThrow();
    expect(() => read("documents.store.server.ts")).not.toThrow();
  });

  it("never lets the browser choose a bucket, a path, or a validated fact", () => {
    const client = read("upload-client.ts");
    // The browser uses exactly the server-issued target.
    expect(client).toContain("target.bucket");
    expect(client).toContain("target.path");
    expect(client).toContain("target.token");
    expect(client).not.toContain("arc-source-documents");
    expect(client).not.toMatch(/sha256|page_count|pageCount/);
  });
});
