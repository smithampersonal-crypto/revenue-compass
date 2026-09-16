/**
 * Regression: the AI execution context must carry a COMPLETE WorkflowDraft.
 *
 * `analysis_revisions.canonical_inputs` and `guest_workspaces.draft_json` hold
 * the canonical ENVELOPE (`{ schemaVersion, draft }`), not a bare draft. The
 * store once handed that envelope straight to the merge, which then read
 * `draft.promises` as undefined and threw a TypeError during `applying`.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseCanonicalInputs, toCanonicalInputs } from "@/lib/arc/persistence/schema";
import { createEmptyDraft } from "@/lib/asc606-workflow/types";

const STORE_SOURCE = readFileSync("src/lib/arc/ai/runs.store.server.ts", "utf8");

describe("AI execution context envelope", () => {
  it("the stored envelope is not itself a usable draft", () => {
    const stored = toCanonicalInputs(createEmptyDraft()) as unknown as Record<string, unknown>;
    expect(stored["draft"]).toBeDefined();
    expect(stored["promises"]).toBeUndefined();
  });

  it("parsing the envelope yields every canonical collection", () => {
    const parsed = parseCanonicalInputs(toCanonicalInputs(createEmptyDraft()));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(Array.isArray(parsed.draft.promises)).toBe(true);
    expect(Array.isArray(parsed.draft.performanceObligations)).toBe(true);
    expect(Array.isArray(parsed.draft.variableConsiderationComponents)).toBe(true);
    expect(Array.isArray(parsed.draft.contractModifications)).toBe(true);
    expect(Array.isArray(parsed.draft.contractBalances.considerationEvents)).toBe(true);
    expect(Array.isArray(parsed.draft.contractBalances.cashCollections)).toBe(true);
  });

  it("the run store parses on read and re-envelopes on write", () => {
    expect(STORE_SOURCE).toContain("parseCanonicalInputs(data.canonical_inputs");
    expect(STORE_SOURCE).toContain("parseCanonicalInputs(data.draft_json");
    expect(STORE_SOURCE).toContain("toCanonicalInputs(args.canonicalInputs)");
    expect(STORE_SOURCE).not.toContain("data.canonical_inputs as never");
    expect(STORE_SOURCE).not.toContain("data.draft_json as never");
  });
});
