/**
 * Phase 9G — Task 7. The safe workspace read now carries review items and
 * presentation provenance, not merely a count.
 *
 * Two rules are enforced here. Persisted review JSON that cannot be read
 * completely is reported as unavailable rather than flattened into a
 * reassuring empty review UI; and provenance crosses the boundary only as
 * validated presentation state, never as merge internals.
 */

import { describe, expect, it } from "vitest";

import type { AiCallerScope } from "../runs.handlers";
import { normalizePersistedReviewPayload } from "../review-normalization";
import {
  aiWorkspaceStateHandler,
  type AiWorkspaceDeps,
  type AiWorkspaceSnapshot,
  type AiWorkspaceStore,
} from "../workspace.handlers";

const REVISION = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

const caller: AiCallerScope = {
  kind: "revision",
  userId: USER,
  revisionId: REVISION,
  contractId: "44444444-4444-4444-8444-444444444444",
};

function persistedItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "rev-1",
    targetKey: "po:po-saas.recognitionMethod",
    section: "step_5",
    state: "yellow",
    severity: "yellow",
    reasonCode: "accountant_affirmation_required",
    reason: "Confirm the recognition pattern.",
    guidanceIds: [7],
    citations: [
      {
        documentId: "doc-1",
        pageStart: 4,
        pageEnd: 5,
        evidenceMode: "text",
        excerpt: "Services are delivered over the annual term.",
      },
    ],
    valueFingerprint: "value-fp",
    reviewFingerprint: "review-fp",
    resolution: null,
    ...overrides,
  };
}

function deps(snapshot: Partial<AiWorkspaceSnapshot>): AiWorkspaceDeps {
  const store = {
    findEditableRevision: async () => ({ id: REVISION, contractId: "c", lockVersion: 1 }),
    findActiveGuestWorkspace: async () => null,
    findActiveRunForScope: async () => null,
    findRun: async () => null,
    findLatestRunForScope: async () => null,
    loadWorkspaceSnapshot: async (): Promise<AiWorkspaceSnapshot> => ({
      lastSuccessfulRunId: "run-1",
      currentSourceSetFingerprint: "fp",
      sourceState: "current",
      hasIncludedSources: true,
      acknowledgedSourceFingerprint: null,
      outstandingReviewIssueCount: 0,
      guestWorkspaceExpiresAt: null,
      ...snapshot,
    }),
    monthlyUsage: async () => 0,
    guestUsage: async () => 0,
  } as unknown as AiWorkspaceStore;

  return {
    store,
    limits: {
      monthlyAccountRuns: 10,
      guestWorkspaceRuns: 3,
      guidanceRegistryHash: "hash",
    } as unknown as AiWorkspaceDeps["limits"],
    now: () => new Date("2026-09-17T00:00:00.000Z"),
    newRunId: () => "run-new",
  };
}

describe("Task 7 safe review read model", () => {
  it("returns normalized review items with only presentation facts", async () => {
    const payload = normalizePersistedReviewPayload([persistedItem()]);
    const state = await aiWorkspaceStateHandler(
      deps({
        reviewItems: payload.items,
        reviewPayloadMalformed: payload.malformed,
        outstandingReviewIssueCount: 1,
      }),
      caller,
    );

    expect(state.reviewPayloadMalformed).toBe(false);
    expect(state.reviewItems).toHaveLength(1);
    const item = state.reviewItems[0]!;
    expect(item.id).toBe("rev-1");
    expect(item.section).toBe("step_5");
    expect(item.state).toBe("yellow");
    expect(item.severity).toBe("yellow");
    expect(item.reviewFingerprint).toBe("review-fp");
    expect(item.citations).toEqual([
      {
        pageStart: 4,
        pageEnd: 5,
        citationIndex: 0,
        evidenceModes: ["text"],
        excerpts: ["Services are delivered over the annual term."],
      },
    ]);
    expect(JSON.stringify(item)).not.toContain("value-fp");
    expect(JSON.stringify(item)).not.toContain("doc-1");
  });

  it("reports review state as unavailable when any persisted entry is malformed", async () => {
    const payload = normalizePersistedReviewPayload([persistedItem(), { id: "broken" }]);
    const state = await aiWorkspaceStateHandler(
      deps({ reviewItems: payload.items, reviewPayloadMalformed: payload.malformed }),
      caller,
    );

    expect(state.reviewPayloadMalformed).toBe(true);
    // Nothing partially read is offered for review action.
    expect(state.reviewItems).toEqual([]);
  });

  it("sanitizes provenance and never ships merge internals", async () => {
    const state = await aiWorkspaceStateHandler(
      deps({
        fieldProvenance: {
          "contract.customerName": {
            state: "ai_generated_untouched",
            semanticKey: "customer",
            lastAiRunId: "run-1",
            valueFingerprint: "fp",
          },
          bogus: { state: "invented_state" },
        },
        objectProvenance: {
          "po:po-saas": {
            state: "ai_generated_user_edited",
            canonicalId: "po-saas",
            userModified: true,
            semanticKey: "saas",
            lastAiRunId: "run-1",
            valueFingerprint: "fp",
          },
        },
      }),
      caller,
    );

    expect(state.fieldProvenance).toEqual({
      "contract.customerName": { state: "ai_generated_untouched" },
    });
    // The browser-safe map is keyed by canonical id; the persisted semantic
    // key must never cross the trust boundary, not even as a property name.
    expect(state.objectProvenance).toEqual({
      "po-saas": {
        canonicalId: "po-saas",
        state: "ai_generated_user_edited",
        userModified: true,
      },
    });
    const serialized = JSON.stringify(state);
    expect(serialized).not.toContain("semanticKey");
    expect(serialized).not.toContain("lastAiRunId");
    expect(serialized).not.toContain("invented_state");
  });

  it("defaults to an empty, non-malformed review model when no sidecar exists", async () => {
    const state = await aiWorkspaceStateHandler(deps({}), caller);
    expect(state.reviewItems).toEqual([]);
    expect(state.reviewPayloadMalformed).toBe(false);
    expect(state.fieldProvenance).toEqual({});
    expect(state.objectProvenance).toEqual({});
  });
});
