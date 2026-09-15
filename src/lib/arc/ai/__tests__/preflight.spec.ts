/**
 * Phase 9B — Task 4. Exact byte and token preflight.
 *
 * No generative request is ever made here, and no allowance is consumed: the
 * only OpenAI interaction is the injected non-generative token counter.
 */

import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { buildPdf } from "@/lib/arc/documents/__tests__/pdf-fixtures";

import { AI_LIMITS } from "../config.server";
import { createTokenCounter } from "../openai.server";
import { preflightAiRequest } from "../preflight.server";
import {
  buildAiRequestPackage,
  type AiPackageDeps,
  type AuthorizedSource,
} from "../request-package.server";
import type { CurrentAccountingContext } from "../types";

const pdfBytes = buildPdf({ pages: 2, text: "Hosted access subscription with service credits" });

const currentContext: CurrentAccountingContext = {
  manuallyEnteredFacts: {},
  draftFingerprint: "fingerprint",
};

const scope = {
  kind: "authenticated" as const,
  userId: "user-1",
  contractId: "contract-1",
  revisionId: "revision-1",
};

function authorized(byteSize: number): AuthorizedSource[] {
  return [
    {
      documentId: "doc-1",
      displayName: "Master Agreement",
      originalFilename: "master.pdf",
      sha256: createHash("sha256").update(pdfBytes).digest("hex"),
      byteSize,
      storageObjectPath: "documents/doc-1.pdf",
    },
  ];
}

async function run(overrides: Partial<AiPackageDeps>, reportedBytes = pdfBytes.byteLength) {
  const deps: AiPackageDeps = {
    loadAuthorizedSelectedSources: async () => authorized(reportedBytes),
    download: async () => pdfBytes,
    countTokens: { count: async () => ({ input_tokens: 100 }) },
    ...overrides,
  };
  return buildAiRequestPackage({ scope, currentContext, deps });
}

describe("exact caps", () => {
  it("uses the approved caps", () => {
    expect(AI_LIMITS.maxInputTokens).toBe(200000);
    expect(AI_LIMITS.maxCombinedFileBytes).toBe(50000000);
  });
});

describe("byte preflight", () => {
  it("rejects over the combined byte cap before any token count happens", async () => {
    const count = vi.fn(async () => ({ input_tokens: 1 }));
    const big = new Uint8Array(0);
    const result = await buildAiRequestPackage({
      scope,
      currentContext,
      deps: {
        loadAuthorizedSelectedSources: async () => authorized(AI_LIMITS.maxCombinedFileBytes + 1),
        download: async () => {
          // Reported size is authoritative for the cap; bytes are never read
          // once the package has already exceeded it.
          void big;
          return pdfBytes;
        },
        countTokens: { count },
      },
    });

    expect(result).toMatchObject({ ok: false, code: "combined_bytes_exceeded" });
    expect(count).not.toHaveBeenCalled();
  });

  it("allows a package at exactly the combined byte cap", async () => {
    const result = await run({}, pdfBytes.byteLength);
    expect(result.ok).toBe(true);
  });

  it("never drops a source to fit under the cap", async () => {
    const result = await buildAiRequestPackage({
      scope,
      currentContext,
      deps: {
        loadAuthorizedSelectedSources: async () => [
          ...authorized(AI_LIMITS.maxCombinedFileBytes),
          {
            documentId: "doc-2",
            displayName: "Order Form",
            originalFilename: "order.pdf",
            sha256: "b".repeat(64),
            byteSize: 10,
            storageObjectPath: "documents/doc-2.pdf",
          },
        ],
        download: async () => pdfBytes,
        countTokens: { count: async () => ({ input_tokens: 1 }) },
      },
    });
    expect(result).toMatchObject({ ok: false, code: "combined_bytes_exceeded" });
    if (result.ok) return;
    expect(result.combinedFileBytes).toBe(AI_LIMITS.maxCombinedFileBytes + 10);
  });
});

describe("token preflight", () => {
  it("records the exact proposed-request input token count", async () => {
    const result = await run({ countTokens: { count: async () => ({ input_tokens: 4242 }) } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.inputTokens).toBe(4242);
  });

  it("counts over the materially complete proposed request", async () => {
    const count = vi.fn(async (_payload: Record<string, unknown>) => ({ input_tokens: 7 }));
    await run({ countTokens: { count } });

    const payload = count.mock.calls[0]![0];
    expect(payload["model"]).toBe(AI_LIMITS.model);
    expect(JSON.stringify(payload)).toContain("data:application/pdf;base64,");
    expect(JSON.stringify(payload)).toContain("doc-1");
  });

  it("permits exactly the token cap", async () => {
    const result = await run({
      countTokens: { count: async () => ({ input_tokens: AI_LIMITS.maxInputTokens }) },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects one token over the cap without truncating anything", async () => {
    const result = await run({
      countTokens: { count: async () => ({ input_tokens: AI_LIMITS.maxInputTokens + 1 }) },
    });
    expect(result).toMatchObject({ ok: false, code: "input_tokens_exceeded" });
    if (result.ok) return;
    expect(result.inputTokens).toBe(AI_LIMITS.maxInputTokens + 1);
  });
});

describe("no generative call", () => {
  it("the production token counter uses the non-generative count endpoint only", async () => {
    const create = vi.fn();
    const count = vi.fn(async () => ({ input_tokens: 11 }));
    const client = { responses: { create, inputTokens: { count } } };

    const counter = createTokenCounter(client as never);
    await expect(counter.count({ model: "m", input: [] })).resolves.toEqual({ input_tokens: 11 });

    expect(count).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });

  it("package construction never reaches a generative endpoint", async () => {
    const create = vi.fn();
    const count = vi.fn(async () => ({ input_tokens: 9 }));
    const client = { responses: { create, inputTokens: { count } } };

    const result = await run({ countTokens: createTokenCounter(client as never) });
    expect(result.ok).toBe(true);
    expect(create).not.toHaveBeenCalled();
  });
});

/**
 * Finding 1 — preflight counts the canonical envelope verbatim. It owns no
 * field list, so a future token-bearing parameter cannot be dropped silently.
 */
describe("canonical request envelope", () => {
  const representative = {
    model: "gpt-5.6-terra",
    instructions: "TRUSTED ARC POLICY: analyze the attached contract PDFs.",
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: "ARC guidance prose" },
          {
            type: "input_file",
            filename: "arc-source-doc-1.pdf",
            detail: "high",
            file_data: "data:application/pdf;base64,AAAA",
          },
        ],
      },
    ],
    reasoning: { effort: "high" },
    text: {
      format: {
        type: "json_schema",
        name: "arc_contract_analysis",
        strict: true,
        schema: { type: "object", properties: {}, required: [], additionalProperties: false },
      },
    },
    store: false,
    truncation: "disabled",
    tools: [],
    // Stands in for any Phase 9D parameter that does not exist yet.
    future_token_bearing_field: "must survive preflight untouched",
  } as const;

  it("hands the request object to the counter unchanged, field for field", async () => {
    const count = vi.fn(async (_request: Record<string, unknown>) => ({ input_tokens: 5 }));
    const result = await preflightAiRequest({
      requestParams: representative as unknown as Record<string, unknown>,
      combinedFileBytes: 100,
      tokenCounter: { count },
    });

    expect(result.ok).toBe(true);
    const counted = count.mock.calls[0]![0] as Record<string, unknown>;
    // Identity, not a copy: nothing was reconstructed or projected.
    expect(counted).toBe(representative);
    expect(counted["instructions"]).toContain("TRUSTED ARC POLICY");
    expect(counted["reasoning"]).toEqual({ effort: "high" });
    expect(counted["text"]).toEqual(representative.text);
    expect(counted["future_token_bearing_field"]).toBe("must survive preflight untouched");
    expect(JSON.stringify(counted)).toContain("data:application/pdf;base64,");
  });

  it("rejects over the token cap and permits exactly the cap", async () => {
    const over = await preflightAiRequest({
      requestParams: { model: "m" },
      combinedFileBytes: 1,
      tokenCounter: { count: async () => ({ input_tokens: AI_LIMITS.maxInputTokens + 1 }) },
    });
    expect(over).toMatchObject({ ok: false, code: "input_tokens_exceeded" });

    const exact = await preflightAiRequest({
      requestParams: { model: "m" },
      combinedFileBytes: 1,
      tokenCounter: { count: async () => ({ input_tokens: AI_LIMITS.maxInputTokens }) },
    });
    expect(exact.ok).toBe(true);
  });

  it("fails the byte cap before any counting happens", async () => {
    const count = vi.fn(async () => ({ input_tokens: 1 }));
    const result = await preflightAiRequest({
      requestParams: { model: "m" },
      combinedFileBytes: AI_LIMITS.maxCombinedFileBytes + 1,
      tokenCounter: { count },
    });
    expect(result).toMatchObject({ ok: false, code: "combined_bytes_exceeded" });
    expect(count).not.toHaveBeenCalled();
  });

  it("the package builder's counted envelope carries instructions, reasoning and 9D params", async () => {
    const count = vi.fn(async (_request: Record<string, unknown>) => ({ input_tokens: 12 }));
    await buildAiRequestPackage({
      scope,
      currentContext,
      additionalRequestParams: { text: representative.text },
      deps: {
        loadAuthorizedSelectedSources: async () => authorized(pdfBytes.byteLength),
        download: async () => pdfBytes,
        countTokens: { count },
      },
    });

    const counted = count.mock.calls[0]![0] as Record<string, unknown>;
    expect(counted["model"]).toBe(AI_LIMITS.model);
    expect(String(counted["instructions"])).toContain("ARC");
    expect(counted["reasoning"]).toEqual({ effort: AI_LIMITS.reasoningEffort });
    expect(counted["store"]).toBe(false);
    expect(counted["truncation"]).toBe("disabled");
    expect(counted["text"]).toEqual(representative.text);
    const serialized = JSON.stringify(counted);
    expect(serialized).toContain("data:application/pdf;base64,");
    expect(serialized).toContain("TRUSTED ARC GUIDANCE PACK");
  });
});
