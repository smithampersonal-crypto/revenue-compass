/**
 * Phase 9F — production instruction-path regression.
 *
 * This exercises the REAL production boundary, `createExecutionBoundaries()`,
 * not `buildAiRequestPackage` directly. Only the authorization, storage and
 * OpenAI boundaries are replaced. If production ever silently falls back to the
 * legacy `packageInstructions()` preamble, these assertions fail.
 */

import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildPdf } from "@/lib/arc/documents/__tests__/pdf-fixtures";

import { AI_LIMITS } from "../config.server";
import { AI_PROMPT_SECTIONS } from "../prompt";

const pdfBytes = buildPdf({
  pageTexts: ["hosted access terms\nsubscription term", "service credits\nuptime commitment"],
});
const sha256 = createHash("sha256").update(pdfBytes).digest("hex");

vi.mock("../authorized-sources.server", () => ({
  loadAuthorizedSelectedSources: async () => [
    {
      documentId: "doc-master",
      displayName: "Master Agreement",
      originalFilename: "master.pdf",
      sha256,
      byteSize: pdfBytes.byteLength,
      storageObjectPath: "documents/doc-master.pdf",
    },
  ],
}));

vi.mock("@/lib/arc/documents/storage.server", () => ({
  downloadPrivateObject: async () => pdfBytes,
}));

vi.mock("../openai.server", () => ({
  productionTokenCounter: async () => ({ count: async () => ({ input_tokens: 4321 }) }),
  productionTerraAnalyzer: async () => async () => {
    throw new Error("no generative call in this regression");
  },
}));

async function productionCanonicalRequest(): Promise<Record<string, unknown>> {
  const { createExecutionBoundaries } = await import("../orchestrator.server");
  const boundaries = await createExecutionBoundaries();
  const result = await boundaries.buildPackage({
    scope: {
      kind: "authenticated",
      userId: "user-1",
      contractId: "contract-1",
      revisionId: "revision-1",
    },
    currentContext: {
      manuallyEnteredFacts: { contractTitle: "Genomix master agreement" },
      draftFingerprint: "draft-1",
    },
    priorContext: null,
    arcFactSignals: [],
  });
  if (!result.ok) throw new Error(`preflight failed: ${result.code}`);
  return result.canonicalRequest as Record<string, unknown>;
}

describe("production execution boundary instructions", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("sends the trust-tier instructions, never the legacy package preamble", async () => {
    const request = await productionCanonicalRequest();
    const instructions = request["instructions"] as string;

    for (const heading of Object.values(AI_PROMPT_SECTIONS)) {
      expect(instructions).toContain(heading);
    }
    expect(instructions).toContain(`promptVersion: ${AI_LIMITS.promptVersion}`);
    expect(instructions).toContain("promptVersion: arc.ai.prompt.v9");
    expect(instructions).toContain(`outputSchemaVersion: ${AI_LIMITS.outputSchemaVersion}`);
    expect(instructions).toContain("outputSchemaVersion: arc.ai.schema.v5");

    // Anchor-selection rules, not excerpt transcription.
    expect(instructions).toContain("anchorIds");
    expect(instructions).not.toContain("anchorStart");
    expect(instructions).not.toContain("anchorEnd");
    expect(instructions).toContain("ARC owns the excerpt");
    expect(instructions).toContain("never contain more than 3 ids");
    expect(instructions).toContain(
      "anchorIds is an explicit list of every selected anchor, NOT a start/end range",
    );
    expect(instructions).toContain('["P0001-S0015","P0001-S0016","P0001-S0017"]');
    expect(instructions).toContain('["P0001-S0015","P0001-S0017"] is invalid');
    expect(instructions).toContain("Never omit an intermediate anchor");
    expect(instructions).toContain("do not return endpoints");
    expect(instructions).toContain("Never fabricate a missing middle id");

    // The legacy fallback preamble must not be what production sends.
    expect(instructions).not.toContain(
      "You are analyzing contract PDFs supplied by ARC (Ayden's Revenue Compass).",
    );
  });

  it("carries the v8 Step 2 grouping rule for priced capacity and usage entitlements", async () => {
    const request = await productionCanonicalRequest();
    const instructions = request["instructions"] as string;

    // A separately priced line is not automatically its own obligation.
    expect(instructions).toContain(
      "Do not create a separate performance obligation merely because a contract separately prices or labels a volume, capacity, tier, quota, entitlement, or usage allowance",
    );
    expect(instructions).toContain(
      "A separately stated price does not by itself establish a separate performance obligation.",
    );

    // The affirmative decision rule: additional transferred service versus a
    // quantity/capacity/access attribute of the underlying service.
    expect(instructions).toContain(
      "whether it transfers an additional good or service independently from the underlying service, or merely defines the quantity, capacity, access level, or included usage of that underlying service",
    );
    expect(instructions).toContain(
      "group it with the underlying service rather than creating a separate performance obligation",
    );

    // Grouped entitlement pricing belongs in the underlying PO's provisional SSP.
    expect(instructions).toContain(
      "include that amount in the provisional SSP of the underlying performance obligation rather than creating a separate SSP item",
    );

    // Combination is never hard-coded: genuine evidence can still separate.
    expect(instructions).toContain(
      "When the evidence does show that such an item transfers an additional distinct good or service, conclude it is a separate performance obligation",
    );

    // The v7 anchor-enumeration rule survives the v8 bump.
    expect(instructions).toContain(
      "anchorIds is an explicit list of every selected anchor, NOT a start/end range",
    );
  });

  it("carries the retrieved Guidance and the ARC source identity in the counted request", async () => {
    const request = await productionCanonicalRequest();
    const instructions = request["instructions"] as string;
    expect(instructions).toContain("guidanceRegistryHash: ");
    expect(instructions).toContain("documentId=doc-master");
    expect(instructions).toContain(`sha256=${sha256}`);
  });
});
