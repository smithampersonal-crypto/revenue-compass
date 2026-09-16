/**
 * Phase 9F — the recordPreflight wire contract.
 *
 * The trusted routine `arc_record_ai_preflight` reads snake_case JSON keys and
 * requires a position and the approved registry hash. A camelCase payload is
 * accepted by TypeScript and rejected by the database at runtime, which is
 * exactly the defect the live run exposed. Only the Supabase RPC boundary is
 * mocked here, so the real store builds the outgoing shape.
 */

import { describe, expect, it, vi } from "vitest";

import { GUIDANCE_REGISTRY_HASH } from "@/lib/arc/guidance/registry";

const rpc = vi.fn(async () => ({ data: null, error: null }));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc,
    from: () => {
      throw new Error("no table access expected in this test");
    },
  },
}));

const FINGERPRINT = "f".repeat(64);

describe("createAiRunStore().recordPreflight", () => {
  it("sends the exact snake_case provenance the SQL routine reads", async () => {
    const { createAiRunStore } = await import("../runs.store.server");
    const store = await createAiRunStore();
    rpc.mockClear();

    await store.recordPreflight({
      runId: "run-1",
      sourceSetFingerprint: FINGERPRINT,
      sources: [
        { documentId: "doc-1", sha256: "a".repeat(64), byteSize: 56598, pageCount: 4 },
        { documentId: "doc-2", sha256: "b".repeat(64), byteSize: 120, pageCount: 2 },
      ],
      guidance: [{ cardId: 12, inclusionReason: "signal", matchedSignals: ["usage"] }],
      sourceCount: 2,
      pageCount: 6,
      inputTokens: 33544,
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    const [routine, args] = rpc.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(routine).toBe("arc_record_ai_preflight");

    expect(args["p_sources"]).toEqual([
      {
        source_document_id: "doc-1",
        position: 0,
        sha256: "a".repeat(64),
        byte_size: 56598,
        page_count: 4,
      },
      {
        source_document_id: "doc-2",
        position: 1,
        sha256: "b".repeat(64),
        byte_size: 120,
        page_count: 2,
      },
    ]);

    expect(args["p_guidance"]).toEqual([
      {
        card_id: 12,
        inclusion_reason: "signal",
        matched_signals: ["usage"],
        registry_hash: GUIDANCE_REGISTRY_HASH,
      },
    ]);

    expect(args["p_source_set_fingerprint"]).toBe(FINGERPRINT);
    expect(args["p_source_count"]).toBe(2);
    expect(args["p_page_count"]).toBe(6);
    expect(args["p_input_tokens"]).toBe(33544);

    // A camelCase regression must fail this test.
    const serialized = JSON.stringify(args);
    for (const camel of ["documentId", "byteSize", "pageCount", "cardId", "matchedSignals"]) {
      expect(serialized).not.toContain(camel);
    }
  });
});
