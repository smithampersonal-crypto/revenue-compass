import { describe, expect, it } from "vitest";

import type { AiCallerScope, AiRunStore } from "../runs.handlers";
import {
  AI_REVIEW_ACTION_CONFLICT,
  AI_REVIEW_ACTION_UNAVAILABLE,
  AI_REVIEW_NOTE_LIMIT,
  acknowledgeStaleSourcesHandler,
  affirmReviewItemHandler,
  resolveReviewIssueHandler,
  type AiReviewActionStore,
} from "../review-actions.handlers";

const REVISION = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const GUEST = "33333333-3333-4333-8333-333333333333";
const HASH = "9".repeat(64);
const FINGERPRINT = "fp-material-conclusion";
const SOURCE_FINGERPRINT = "a".repeat(64);

const revisionCaller: AiCallerScope = {
  kind: "revision",
  userId: USER,
  revisionId: REVISION,
  contractId: "44444444-4444-4444-8444-444444444444",
};

const guestCaller: AiCallerScope = {
  kind: "guest",
  guestTokenHash: HASH,
  guestWorkspaceId: GUEST,
  authenticatedUserId: null,
};

interface Recorded {
  affirm: unknown[];
  resolve: unknown[];
  acknowledge: unknown[];
  otherCalls: string[];
}

function storeFor(
  recorded: Recorded,
  overrides: Partial<AiReviewActionStore> = {},
): AiReviewActionStore {
  const refuse = (name: string) => () => {
    recorded.otherCalls.push(name);
    throw new Error(`${name} must not be called by a review action`);
  };
  const base = {
    findEditableRevision: async (revisionId: string, userId: string) =>
      revisionId === REVISION && userId === USER
        ? { id: REVISION, contractId: "c", lockVersion: 7 }
        : null,
    findActiveGuestWorkspace: async (tokenHash: string) =>
      tokenHash === HASH ? { id: GUEST, lockVersion: 4 } : null,
    findActiveRunForScope: refuse("findActiveRunForScope"),
    findRun: refuse("findRun"),
    loadRunCreationSnapshot: refuse("loadRunCreationSnapshot"),
    createRun: refuse("createRun"),
    monthlyUsage: refuse("monthlyUsage"),
    guestConsumed: refuse("guestConsumed"),
    affirmReviewItem: async (args: unknown) => {
      recorded.affirm.push(args);
      return { lockVersion: 8, alreadyResolved: false, eventId: "event-1" };
    },
    resolveReviewIssue: async (args: unknown) => {
      recorded.resolve.push(args);
      return { lockVersion: 8, alreadyResolved: false, eventId: "event-2" };
    },
    acknowledgeStaleSources: async (args: unknown) => {
      recorded.acknowledge.push(args);
      return {
        lockVersion: 8,
        sourceSetFingerprint: SOURCE_FINGERPRINT,
        alreadyAcknowledged: false,
        eventId: "event-3",
      };
    },
  } as unknown as AiReviewActionStore;
  return { ...base, ...overrides } as AiReviewActionStore;
}

function empty(): Recorded {
  return { affirm: [], resolve: [], acknowledge: [], otherCalls: [] };
}

function failing(code: string): (args: unknown) => Promise<never> {
  return async () => {
    const error = new Error("database said no") as Error & { code?: string };
    error.code = code;
    throw error;
  };
}

describe("Phase 9G review actions — yellow affirmation", () => {
  it("sends the server-derived owner scope, never anything from the browser", async () => {
    const recorded = empty();
    const store = storeFor(recorded);

    const result = await affirmReviewItemHandler({ store }, revisionCaller, {
      reviewItemId: "rev-yellow-1",
      expectedReviewFingerprint: FINGERPRINT,
      // Hostile extras the browser must never be able to author.
      ownerUserId: "99999999-9999-4999-8999-999999999999",
      actorUserId: "99999999-9999-4999-8999-999999999999",
      at: "2020-01-01T00:00:00Z",
      state: "resolved",
    } as never);

    expect(result).toEqual({ applied: true, alreadyResolved: false, lockVersion: 8 });
    expect(recorded.affirm).toEqual([
      {
        ownerUserId: USER,
        guestTokenHash: null,
        revisionId: REVISION,
        guestWorkspaceId: null,
        actorUserId: USER,
        expectedLockVersion: 7,
        reviewItemId: "rev-yellow-1",
        expectedReviewFingerprint: FINGERPRINT,
        method: "individual",
      },
    ]);
    expect(recorded.otherCalls).toEqual([]);
  });

  it("carries the temporary-workspace credential for a guest caller", async () => {
    const recorded = empty();
    await affirmReviewItemHandler({ store: storeFor(recorded) }, guestCaller, {
      reviewItemId: "rev-yellow-1",
      expectedReviewFingerprint: FINGERPRINT,
      method: "page_all",
    });

    expect(recorded.affirm[0]).toMatchObject({
      ownerUserId: null,
      guestTokenHash: HASH,
      revisionId: null,
      guestWorkspaceId: GUEST,
      actorUserId: null,
      expectedLockVersion: 4,
      method: "page_all",
    });
  });

  it("names a signed-in accountant working in a temporary workspace", async () => {

    const recorded = empty();
    await affirmReviewItemHandler(
      { store: storeFor(recorded) },
      { ...guestCaller, authenticatedUserId: USER },
      {
        reviewItemId: "rev-yellow-1",
        expectedReviewFingerprint: FINGERPRINT,
        // The browser cannot substitute anyone else's identity.
        actorUserId: "99999999-9999-4999-8999-999999999999",
      } as never,
    );

    expect(recorded.affirm[0]).toMatchObject({
      ownerUserId: null,
      guestTokenHash: HASH,
      guestWorkspaceId: GUEST,
      actorUserId: USER,
    });

  });

  it("refuses an unknown affirmation method", async () => {
    const recorded = empty();
    await expect(
      affirmReviewItemHandler({ store: storeFor(recorded) }, revisionCaller, {
        reviewItemId: "rev-yellow-1",
        expectedReviewFingerprint: FINGERPRINT,
        method: "everything_everywhere",
      } as never),
    ).rejects.toThrow(AI_REVIEW_ACTION_UNAVAILABLE);
    expect(recorded.affirm).toEqual([]);
  });

  it("requires an item identity and an expected fingerprint", async () => {
    const recorded = empty();
    const store = storeFor(recorded);
    await expect(
      affirmReviewItemHandler({ store }, revisionCaller, {
        reviewItemId: "",
        expectedReviewFingerprint: FINGERPRINT,
      }),
    ).rejects.toThrow(AI_REVIEW_ACTION_UNAVAILABLE);
    await expect(
      affirmReviewItemHandler({ store }, revisionCaller, {
        reviewItemId: "rev-yellow-1",
        expectedReviewFingerprint: "",
      }),
    ).rejects.toThrow(AI_REVIEW_ACTION_UNAVAILABLE);
    expect(recorded.affirm).toEqual([]);
  });

  it("reports a changed conclusion as a plain-language conflict", async () => {
    const recorded = empty();
    const store = storeFor(recorded, { affirmReviewItem: failing("40001") as never });
    await expect(
      affirmReviewItemHandler({ store }, revisionCaller, {
        reviewItemId: "rev-yellow-1",
        expectedReviewFingerprint: FINGERPRINT,
      }),
    ).rejects.toThrow(AI_REVIEW_ACTION_CONFLICT);
  });

  it("never leaks a raw database error", async () => {
    const store = storeFor(empty(), { affirmReviewItem: failing("42501") as never });
    await expect(
      affirmReviewItemHandler({ store }, revisionCaller, {
        reviewItemId: "rev-yellow-1",
        expectedReviewFingerprint: FINGERPRINT,
      }),
    ).rejects.toThrow(AI_REVIEW_ACTION_UNAVAILABLE);
  });

  it("refuses a revision the caller does not own", async () => {
    const recorded = empty();
    const store = storeFor(recorded, { findEditableRevision: async () => null });
    await expect(
      affirmReviewItemHandler({ store }, revisionCaller, {
        reviewItemId: "rev-yellow-1",
        expectedReviewFingerprint: FINGERPRINT,
      }),
    ).rejects.toThrow();
    expect(recorded.affirm).toEqual([]);
  });

  it("reports an idempotent repeat without pretending it was a new approval", async () => {
    const store = storeFor(empty(), {
      affirmReviewItem: (async () => ({
        lockVersion: 8,
        alreadyResolved: true,
        eventId: "event-1",
      })) as never,
    });
    await expect(
      affirmReviewItemHandler({ store }, revisionCaller, {
        reviewItemId: "rev-yellow-1",
        expectedReviewFingerprint: FINGERPRINT,
      }),
    ).resolves.toEqual({ applied: true, alreadyResolved: true, lockVersion: 8 });
  });
});

describe("Phase 9G review actions — manual red resolution", () => {
  it("passes an approved reason and a trimmed note", async () => {
    const recorded = empty();
    await resolveReviewIssueHandler({ store: storeFor(recorded) }, revisionCaller, {
      reviewItemId: "rev-red-1",
      expectedReviewFingerprint: FINGERPRINT,
      reason: "outside_source_information",
      note: "   Checked the side letter.  ",
    });

    expect(recorded.resolve[0]).toEqual({
      ownerUserId: USER,
      guestTokenHash: null,
      revisionId: REVISION,
      guestWorkspaceId: null,
      actorUserId: USER,
      expectedLockVersion: 7,
      reviewItemId: "rev-red-1",
      expectedReviewFingerprint: FINGERPRINT,
      reason: "outside_source_information",
      note: "Checked the side letter.",
    });
  });

  it("treats a blank note as no note", async () => {
    const recorded = empty();
    await resolveReviewIssueHandler({ store: storeFor(recorded) }, revisionCaller, {
      reviewItemId: "rev-red-1",
      expectedReviewFingerprint: FINGERPRINT,
      reason: "not_applicable",
      note: "   ",
    });
    expect(recorded.resolve[0]).toMatchObject({ note: null });
  });

  it("refuses an unsupported reason", async () => {
    const recorded = empty();
    await expect(
      resolveReviewIssueHandler({ store: storeFor(recorded) }, revisionCaller, {
        reviewItemId: "rev-red-1",
        expectedReviewFingerprint: FINGERPRINT,
        reason: "because_i_said_so",
        note: null,
      } as never),
    ).rejects.toThrow(AI_REVIEW_ACTION_UNAVAILABLE);
    expect(recorded.resolve).toEqual([]);
  });

  it("refuses a note beyond the published limit", async () => {
    const recorded = empty();
    await expect(
      resolveReviewIssueHandler({ store: storeFor(recorded) }, revisionCaller, {
        reviewItemId: "rev-red-1",
        expectedReviewFingerprint: FINGERPRINT,
        reason: "not_applicable",
        note: "x".repeat(AI_REVIEW_NOTE_LIMIT + 1),
      }),
    ).rejects.toThrow();
    expect(recorded.resolve).toEqual([]);
  });

  it("reports a changed conclusion as a conflict", async () => {
    const store = storeFor(empty(), { resolveReviewIssue: failing("40001") as never });
    await expect(
      resolveReviewIssueHandler({ store }, revisionCaller, {
        reviewItemId: "rev-red-1",
        expectedReviewFingerprint: FINGERPRINT,
        reason: "not_applicable",
        note: null,
      }),
    ).rejects.toThrow(AI_REVIEW_ACTION_CONFLICT);
  });
});

describe("Phase 9G review actions — stale-source acknowledgment", () => {
  it("sends the displayed source fingerprint only as a precondition", async () => {
    const recorded = empty();
    const result = await acknowledgeStaleSourcesHandler(
      { store: storeFor(recorded) },
      revisionCaller,
      { expectedSourceSetFingerprint: SOURCE_FINGERPRINT },
    );

    expect(recorded.acknowledge[0]).toEqual({
      ownerUserId: USER,
      guestTokenHash: null,
      revisionId: REVISION,
      guestWorkspaceId: null,
      actorUserId: USER,
      expectedLockVersion: 7,
      expectedSourceSetFingerprint: SOURCE_FINGERPRINT,
    });
    expect(result).toEqual({
      acknowledged: true,
      alreadyAcknowledged: false,
      sourceSetFingerprint: SOURCE_FINGERPRINT,
      lockVersion: 8,
    });
  });

  it("requires the browser to state which source set it displayed", async () => {
    const recorded = empty();
    await expect(
      acknowledgeStaleSourcesHandler({ store: storeFor(recorded) }, revisionCaller, {
        expectedSourceSetFingerprint: "",
      }),
    ).rejects.toThrow(AI_REVIEW_ACTION_UNAVAILABLE);
    expect(recorded.acknowledge).toEqual([]);
  });

  it("reports a superseded source set as a conflict", async () => {
    const store = storeFor(empty(), { acknowledgeStaleSources: failing("40001") as never });
    await expect(
      acknowledgeStaleSourcesHandler({ store }, revisionCaller, {
        expectedSourceSetFingerprint: SOURCE_FINGERPRINT,
      }),
    ).rejects.toThrow(AI_REVIEW_ACTION_CONFLICT);
  });

  it("works in a temporary workspace and touches no run or allowance", async () => {
    const recorded = empty();
    await acknowledgeStaleSourcesHandler({ store: storeFor(recorded) }, guestCaller, {
      expectedSourceSetFingerprint: SOURCE_FINGERPRINT,
    });
    expect(recorded.acknowledge[0]).toMatchObject({
      guestTokenHash: HASH,
      guestWorkspaceId: GUEST,
      ownerUserId: null,
      actorUserId: null,
      expectedLockVersion: 4,
    });
    expect(recorded.otherCalls).toEqual([]);
  });
});

describe("Phase 9G review actions — store surface", () => {
  it("extends the AI run store rather than replacing it", () => {
    const store: AiReviewActionStore = storeFor(empty());
    const asRunStore: AiRunStore = store;
    expect(typeof asRunStore.findEditableRevision).toBe("function");
  });
});
