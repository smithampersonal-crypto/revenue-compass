/**
 * Phase 8G acceptance patch — regression for the hosted Save → Source
 * Documents failure.
 *
 * `analyses` and `analysis_revisions` are joined by TWO foreign keys
 * (`analysis_revisions.analysis_id` and `analyses.current_finalized_revision_id`),
 * so an unqualified `analyses!inner(...)` embed is rejected by PostgREST with
 * PGRST201 ("more than one relationship was found"). That is exactly what made
 * the authenticated document workspace fail to load for every saved contract.
 *
 * Any revision lookup that embeds `analyses` must name the relationship
 * explicitly.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const FILES = [
  "src/lib/arc/documents/workspace.store.server.ts",
  "src/lib/arc/documents/documents.store.server.ts",
];

describe("revision lookups disambiguate the analyses relationship", () => {
  for (const file of FILES) {
    it(`${file} never embeds analyses ambiguously`, () => {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/analyses!inner\(/);
      for (const match of source.matchAll(/analyses![a-z_!]*\(/g)) {
        expect(match[0]).toContain("analysis_revisions_analysis_id_fkey");
      }
    });
  }
});
