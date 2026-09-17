/**
 * Phase 9G — Task 4. A malformed persisted review payload is never repaired by
 * an ordinary autosave.
 *
 * Tolerant normalization belongs to merge and carry-forward. At this write
 * boundary it would destroy the evidence finalization depends on, so the store
 * reports the sidecar as unreadable and the autosave writes nothing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ review_items: [] as unknown }));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              last_successful_run_id: null,
              source_set_fingerprint: null,
              source_state: "current",
              field_provenance: {},
              object_provenance: {},
              tombstones: [],
              review_items: state.review_items,
            },
            error: null,
          }),
        }),
      }),
    }),
    rpc: async () => ({ data: null, error: null }),
  },
}));

const REVISION = "22222222-2222-4222-8222-222222222222";

const validRow = {
  id: "rev-1",
  targetKey: "po:po-1.recognitionMethod",
  section: "step_5",
  state: "yellow",
  severity: "yellow",
  reasonCode: "accountant_affirmation_required",
  reason: "Affirm this.",
  guidanceIds: [],
  citations: [],
  valueFingerprint: "fp-1",
  reviewFingerprint: "rfp-1",
  resolution: null,
  affirmedAt: null,
  affirmedMethod: null,
};

async function load(reviewItems: unknown) {
  state.review_items = reviewItems;
  const { createAutosaveReconciliationStore } = await import("../autosave.store.server");
  const store = await createAutosaveReconciliationStore(async () => null);
  return store.loadAiState({
    revisionId: REVISION,
    guestWorkspaceId: null,
    ownerUserId: "11111111-1111-4111-8111-111111111111",
    guestTokenHash: null,
    actorUserId: null,
  });
}

describe("the autosave store refuses to interpret an unreadable review payload", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("reports a valid payload as loaded", async () => {
    const loaded = await load([validRow]);
    expect(loaded.status).toBe("loaded");
  });

  it("reports one valid row plus one unreadable row as unreadable", async () => {
    const loaded = await load([validRow, { id: "rev-2", state: "greenish" }]);
    expect(loaded.status).toBe("unreadable");
  });

  it("reports a payload that is not an array as unreadable", async () => {
    expect((await load({ oops: true })).status).toBe("unreadable");
  });
});
