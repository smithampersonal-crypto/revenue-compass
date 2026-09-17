/**
 * Phase 9G — a malformed AI sidecar is not the same thing as no AI sidecar.
 *
 * Persisted review rows that cannot be read are dropped for carry-forward
 * (they can never inherit an approval), but they must NEVER quietly reduce the
 * finalization gate's inputs. The finalization read reports that the persisted
 * payload was unreadable, and the gate blocks on it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { aiFinalizationIssues } from "@/lib/arc/persistence/revisions.handlers";

const state = vi.hoisted(() => ({ review_items: [] as unknown }));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === "ai_analysis_state") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: state, error: null }) }),
          }),
        };
      }
      return {
        select: () => ({ eq: () => ({ in: async () => ({ count: 0, error: null }) }) }),
      };
    },
  },
}));

const REVISION = "22222222-2222-4222-8222-222222222222";

const validResolved = {
  id: "rev-1",
  targetKey: "po:po-1.recognitionMethod",
  section: "step_5",
  state: "resolved",
  severity: "red",
  reasonCode: "engine_support_gap",
  reason: "Reviewed.",
  guidanceIds: [2],
  citations: [],
  valueFingerprint: "fp-9",
  reviewFingerprint: "rfp-9",
  resolution: {
    kind: "manual_red",
    at: "2026-09-01T00:00:00.000Z",
    reason: "outside_source_information",
    note: null,
    reviewFingerprint: "rfp-9",
  },
  affirmedAt: null,
  affirmedMethod: null,
};

async function issuesFor(reviewItems: unknown): Promise<string[]> {
  state.review_items = reviewItems;
  const { readAiFinalizationState } = await import("../finalization-state.server");
  return aiFinalizationIssues(await readAiFinalizationState(REVISION));
}

describe("finalization never loses an unreadable review row", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("blocks when a resolved-looking row names an unknown section", async () => {
    expect(await issuesFor([{ ...validResolved, section: "step_42" }])).toHaveLength(1);
  });

  it("blocks when a row names an unknown reason code", async () => {
    expect(await issuesFor([{ ...validResolved, reasonCode: "vibes" }])).toHaveLength(1);
  });

  it("blocks when a row names an unknown state", async () => {
    expect(await issuesFor([{ ...validResolved, state: "greenish" }])).toHaveLength(1);
  });

  it("blocks on a review entry that is not an object at all", async () => {
    expect(await issuesFor([validResolved, "nope"])).toHaveLength(1);
  });

  it("blocks when the persisted payload is not an array", async () => {
    expect(await issuesFor({ oops: true })).toHaveLength(1);
  });

  it("still allows finalization when every persisted row is valid and resolved", async () => {
    expect(await issuesFor([validResolved])).toEqual([]);
  });

  it("keeps legacy Phase 9F compatibility: a readable affirmed legacy row allows finalization", async () => {
    expect(
      await issuesFor([
        {
          id: "rev-legacy",
          targetKey: "transactionPrice.input",
          section: "step_3",
          state: "resolved",
          reason: "Preserved.",
          guidanceIds: [5],
          valueFingerprint: "fp-1",
          affirmedAt: "2026-05-01T00:00:00.000Z",
          affirmedMethod: "individual",
        },
      ]),
    ).toEqual([]);
  });

  it("still blocks on an ordinary unresolved item", async () => {
    expect(
      await issuesFor([{ ...validResolved, state: "red", resolution: null }]),
    ).toHaveLength(1);
  });
});
