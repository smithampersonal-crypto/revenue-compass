/**
 * Phase 9C — the server-only half of the AI run layer must stay server-only,
 * and the browser-safe half must stay free of identity merging.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

describe("AI run server isolation", () => {
  it("keeps the service-role store out of browser-safe modules", () => {
    for (const file of ["src/lib/arc/ai/runs.handlers.ts", "src/lib/arc/ai/types.ts"]) {
      const contents = read(file);
      // Composed so this guardrail does not itself contain the forbidden names.
      for (const forbidden of [
        ["supabase", "Admin"].join(""),
        ["client", "server"].join("."),
        ["SUPABASE", "SERVICE", "ROLE", "KEY"].join("_"),
        ["OPENAI", "API", "KEY"].join("_"),
      ]) {
        expect(contents).not.toContain(forbidden);
      }
    }
  });

  it("loads server-only modules inside handlers only", () => {
    const functions = read("src/lib/arc/ai/runs.functions.ts");
    for (const serverOnly of ["./runs.store.server", "./config.server"]) {
      expect(functions).toContain(`import("${serverOnly}")`);
      expect(functions).not.toContain(`from "${serverOnly}"`);
    }
  });

  it("exposes exactly three AI server functions to the browser", () => {
    const functions = read("src/lib/arc/ai/runs.functions.ts");
    const exported = [...functions.matchAll(/export const (\w+) = createServerFn/g)].map(
      (match) => match[1],
    );
    expect(exported.sort()).toEqual(["getAiRunStatus", "getAiUsageSummary", "startAiAnalysis"]);
    // No allowance reservation, raw table read or structured-result API.
    expect(functions).not.toContain("arc_reserve_ai_allowance");
    expect(functions).not.toContain("arc_mark_ai_run_failure");
  });

  it("accepts no browser-authored run provenance", () => {
    const functions = read("src/lib/arc/ai/runs.functions.ts");
    for (const forbidden of [
      "sourceSetFingerprint",
      "preRunCanonicalInputs",
      "preRunAiState",
      "expectedLockVersion",
      "ownerUserId",
    ]) {
      expect(functions).not.toContain(forbidden);
    }
  });

  it("always forwards a real optimistic lock version", () => {
    const handlers = read("src/lib/arc/ai/runs.handlers.ts");
    expect(handlers).not.toContain("expectedLockVersion: null");
    expect(handlers).toContain("expectedLockVersion: snapshot.expectedLockVersion");
  });

  it("never merges request fields over a derived identity", () => {
    for (const file of ["src/lib/arc/ai/runs.handlers.ts", "src/lib/arc/ai/runs.functions.ts"]) {
      const contents = read(file);
      // `{ ...identity, ...requestBody }` is the mistake class being defended.
      expect(contents).not.toMatch(/\.\.\.\s*(caller|identity|serverIdentity)\s*,\s*\.\.\./);
      expect(contents).not.toMatch(/\.\.\.\s*(data|input|request|body|payload)\b[^)]*ownerUserId/);
    }
  });

  it("starts no OpenAI work and reserves no allowance in Phase 9C", () => {
    const sources = [
      read("src/lib/arc/ai/runs.handlers.ts"),
      read("src/lib/arc/ai/runs.functions.ts"),
      read("src/lib/arc/ai/runs.store.server.ts"),
    ].join("\n");
    for (const forbidden of [
      "responses.create",
      "inputTokens.count",
      "openai.server",
      "openai_started_at = ",
      "arc_reserve_ai_allowance",
    ]) {
      expect(sources).not.toContain(forbidden);
    }
  });

  it("persists no raw evidence through the run store", () => {
    const store = read("src/lib/arc/ai/runs.store.server.ts");
    for (const forbidden of [
      "raw_pdf",
      "pdf_base64",
      "full_page_text",
      "raw_prompt",
      "signed_url",
      "unvalidated_full_response",
      "base64",
    ]) {
      expect(store).not.toContain(forbidden);
    }
  });
});
