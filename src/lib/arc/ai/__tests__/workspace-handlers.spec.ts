/**
 * Phase 9G — Task 3. The safe AI workspace server boundary.
 *
 * The workspace read is side-effect free, the deliberate analysis action
 * reuses the frozen Phase 9F creation boundary, and the review actions are
 * thin wrappers over the accepted Task 2 handlers. Identity is always
 * server-derived; the browser names a target and a displayed fingerprint.
 */

import { describe, expect, it } from "vitest";

import {
  AI_REVIEW_ACTION_CONFLICT,
  AI_REVIEW_ACTION_UNAVAILABLE,
} from "../review-actions.handlers";
import { AI_WORKSPACE_NOT_EDITABLE, type AiCallerScope, type AiRunRow } from "../runs.handlers";
import {
  acknowledgeAiStaleSourcesAction,
  affirmAiReviewItemAction,
  aiWorkspaceStateHandler,
  requestAiAnalysisHandler,
  resolveAiReviewIssueAction,
  type AiWorkspaceDeps,
  type AiWorkspaceRunRecord,
  type AiWorkspaceSnapshot,
  type AiWorkspaceStore,
} from "../workspace.handlers";

const REVISION = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const OTHER_USER = "55555555-5555-4555-8555-555555555555";
const GUEST = "33333333-3333-4333-8333-333333333333";
const HASH = "9".repeat(64);
const CURRENT_FINGERPRINT = "a".repeat(64);

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

function runRow(overrides: Partial<AiWorkspaceRunRecord> = {}): AiWorkspaceRunRecord {
  const base: AiRunRow = {
    id: "run-1",
    stage: "analyzing",
    revisionId: REVISION,
    guestWorkspaceId: null,
    ownerUserId: USER,
    guestTokenHash: null,
    quotaScope: "authenticated",
    sourceCount: 2,
    pageCount: 14,
    inputTokens: 91_000,
    reviewIssueCount: 3,
    completedAt: null,
    safeMessage: null,
  };
  return {
    ...base,
    failureStage: null,
    failureCategory: null,
    failureCode: null,
    allowanceConsumed: true,
    ...overrides,
  };
}

const SNAPSHOT: AiWorkspaceSnapshot = {
  lastSuccessfulRunId: null,
  currentSourceSetFingerprint: CURRENT_FINGERPRINT,
  sourceState: "none",
  acknowledgedSourceFingerprint: null,
  outstandingReviewIssueCount: 0,
  guestWorkspaceExpiresAt: null,
};

interface Calls {
  createRun: number;
  affirm: unknown[];
  resolve: unknown[];
  acknowledge: unknown[];
  forbidden: string[];
}

function fixture(
  options: {
    snapshot?: Partial<AiWorkspaceSnapshot>;
    latestRun?: AiWorkspaceRunRecord | null;
    activeRun?: AiWorkspaceRunRecord | null;
    monthlyUsed?: number;
    guestUsed?: number;
    failing?: { operation: "affirm" | "resolve" | "acknowledge"; code: string };
  } = {},
): { deps: AiWorkspaceDeps; calls: Calls; runs: AiWorkspaceRunRecord[] } {
  const calls: Calls = { createRun: 0, affirm: [], resolve: [], acknowledge: [], forbidden: [] };
  const runs: AiWorkspaceRunRecord[] = [];
  if (options.latestRun) runs.push(options.latestRun);

  const boom = (operation: string) => {
    if (options.failing && options.failing.operation === operation) {
      const error = new Error("database said no: service_role gpt-5.6-terra") as Error & {
        code?: string;
      };
      error.code = options.failing.code;
      throw error;
    }
  };

  const store = {
    findEditableRevision: async (revisionId: string, userId: string) =>
      revisionId === REVISION && userId === USER
        ? { id: REVISION, contractId: "c", lockVersion: 7 }
        : null,
    findActiveGuestWorkspace: async (tokenHash: string) =>
      tokenHash === HASH ? { id: GUEST, lockVersion: 4 } : null,
    findActiveRunForScope: async () => options.activeRun ?? null,
    findRun: async (runId: string) => runs.find((run) => run.id === runId) ?? null,
    findLatestRunForScope: async () => runs[runs.length - 1] ?? null,
    loadWorkspaceSnapshot: async () => ({ ...SNAPSHOT, ...(options.snapshot ?? {}) }),
    loadRunCreationSnapshot: async () => ({
      expectedLockVersion: 7,
      sourceSetFingerprint: CURRENT_FINGERPRINT,
      preRunCanonicalInputs: {},
      preRunAiState: null,
    }),
    createRun: async () => {
      calls.createRun += 1;
      runs.push(runRow({ id: "run-created", stage: "created", reviewIssueCount: 0 }));
      return "run-created";
    },
    monthlyUsage: async () => options.monthlyUsed ?? 1,
    guestConsumed: async () => options.guestUsed ?? 0,
    affirmReviewItem: async (args: unknown) => {
      boom("affirm");
      calls.affirm.push(args);
      return { lockVersion: 8, alreadyResolved: false, eventId: "e1" };
    },
    resolveReviewIssue: async (args: unknown) => {
      boom("resolve");
      calls.resolve.push(args);
      return { lockVersion: 8, alreadyResolved: false, eventId: "e2" };
    },
    acknowledgeStaleSources: async (args: unknown) => {
      boom("acknowledge");
      calls.acknowledge.push(args);
      return {
        lockVersion: 8,
        sourceSetFingerprint: CURRENT_FINGERPRINT,
        alreadyAcknowledged: false,
        eventId: "e3",
      };
    },
  } as unknown as AiWorkspaceStore;

  return {
    calls,
    runs,
    deps: {
      store,
      limits: {
        guestRunLimit: 3,
        userMonthlyRunLimit: 10,
        model: "gpt-5.6-terra",
        reasoningEffort: "high",
        promptVersion: "arc.ai.prompt.v4",
        outputSchemaVersion: "arc.ai.schema.v3",
        guidanceRegistryHash: "hash",
      },
      now: () => new Date("2026-09-17T05:00:00.000Z"),
      newRunId: () => "run-created",
    },
  };
}

const PROHIBITED = [
  "model",
  "reasoningEffort",
  "promptVersion",
  "outputSchemaVersion",
  "guidanceRegistryHash",
  "guestTokenHash",
  "ownerUserId",
  "guestWorkspaceId",
  "revisionId",
  "lockVersion",
  "safeError",
  "safeMessage",
  "inputTokens",
  "failureCategory",
  "failureCode",
  "failureStage",
  "stage",
  "quotaScope",
  "responseId",
  "structuredResult",
];

function keysDeep(value: unknown, found: string[] = []): string[] {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, entry] of Object.entries(value)) {
      found.push(key);
      keysDeep(entry, found);
    }
  }
  return found;
}

describe("AI workspace read boundary", () => {
  it("returns the owner's own workspace state", async () => {
    const { deps } = fixture({
      snapshot: {
        lastSuccessfulRunId: "run-0",
        sourceState: "current",
        outstandingReviewIssueCount: 4,
      },
      monthlyUsed: 3,
    });
    const state = await aiWorkspaceStateHandler(deps, revisionCaller);
    expect(state.hasAnalysis).toBe(true);
    expect(state.lastSuccessfulRunId).toBe("run-0");
    expect(state.sourceState).toBe("current");
    expect(state.reviewIssueCount).toBe(4);
    expect(state.allowance).toEqual({
      scope: "authenticated",
      limit: 10,
      used: 3,
      remaining: 7,
      resetAt: "2026-10-01T00:00:00.000Z",
    });
  });

  it("refuses another account and a wrong temporary-workspace credential", async () => {
    const { deps } = fixture();
    await expect(
      aiWorkspaceStateHandler(deps, { ...revisionCaller, userId: OTHER_USER }),
    ).rejects.toThrow(AI_WORKSPACE_NOT_EDITABLE);
    await expect(
      aiWorkspaceStateHandler(deps, { ...guestCaller, guestTokenHash: "0".repeat(64) }),
    ).rejects.toThrow(AI_WORKSPACE_NOT_EDITABLE);
  });

  it("serves a temporary workspace with the correct credential", async () => {
    const { deps } = fixture({
      guestUsed: 1,
      snapshot: { guestWorkspaceExpiresAt: "2026-09-17T14:00:00.000Z" },
    });
    const state = await aiWorkspaceStateHandler(deps, guestCaller);
    expect(state.allowance).toEqual({
      scope: "guest",
      limit: 3,
      used: 1,
      remaining: 2,
      resetAt: "2026-09-17T14:00:00.000Z",
    });
  });

  it("has no side effects: no run, no allowance, no event, no acknowledgment", async () => {
    const { deps, calls } = fixture();
    await aiWorkspaceStateHandler(deps, revisionCaller);
    await aiWorkspaceStateHandler(deps, revisionCaller);
    await aiWorkspaceStateHandler(deps, revisionCaller);
    expect(calls.createRun).toBe(0);
    expect(calls.affirm).toHaveLength(0);
    expect(calls.resolve).toHaveLength(0);
    expect(calls.acknowledge).toHaveLength(0);
  });

  it("exposes no internal field anywhere in the DTO", async () => {
    const { deps } = fixture({
      latestRun: runRow({
        stage: "api_failed",
        failureStage: "analyzing",
        failureCategory: "api",
        failureCode: "api_failure",
        safeMessage: "service_role failed: gpt-5.6-terra prompt-v4 <contract payload>",
        completedAt: "2026-09-17T04:00:00.000Z",
      }),
    });
    const state = await aiWorkspaceStateHandler(deps, revisionCaller);
    const keys = keysDeep(state);
    for (const forbidden of PROHIBITED) expect(keys).not.toContain(forbidden);
    const serialized = JSON.stringify(state);
    for (const leak of ["service_role", "gpt-5.6-terra", "prompt-v4", "contract payload"]) {
      expect(serialized).not.toContain(leak);
    }
    expect(state.failure?.category).toBe("ai_service");
  });

  it("publishes the current source fingerprint as an acknowledgment precondition", async () => {
    const { deps } = fixture({
      snapshot: {
        sourceState: "stale",
        lastSuccessfulRunId: "run-0",
        acknowledgedSourceFingerprint: CURRENT_FINGERPRINT,
      },
    });
    const state = await aiWorkspaceStateHandler(deps, revisionCaller);
    expect(state.sourceSetFingerprint).toBe(CURRENT_FINGERPRINT);
    expect(state.staleSourceAcknowledged).toBe(true);
  });

  it("does not treat an outdated acknowledgment as acknowledged", async () => {
    const { deps } = fixture({
      snapshot: {
        sourceState: "stale",
        lastSuccessfulRunId: "run-0",
        acknowledgedSourceFingerprint: "b".repeat(64),
      },
    });
    const state = await aiWorkspaceStateHandler(deps, revisionCaller);
    expect(state.staleSourceAcknowledged).toBe(false);
  });
});

describe("AI workspace active run and reconnect", () => {
  it("returns the active run for reconnect without a run id", async () => {
    const active = runRow({ id: "run-active", stage: "validating" });
    const { deps } = fixture({ activeRun: active, latestRun: active });
    const state = await aiWorkspaceStateHandler(deps, revisionCaller);
    expect(state.activeRun?.runId).toBe("run-active");
    // Validation is its own progress step; it must not collapse into analysis.
    expect(state.activeRun?.phase).toBe("validating");
    expect(state.activeRun?.active).toBe(true);
  });

  it("preserves every approved progress phase distinctly", async () => {
    const expected: Array<[AiRunRow["stage"], string]> = [
      ["created", "preparing"],
      ["extracting", "preparing"],
      ["preflight_ready", "preparing"],
      ["analyzing", "analyzing"],
      ["validating", "validating"],
      ["applying", "applying"],
      ["succeeded", "succeeded"],
      ["api_failed", "failed"],
    ];
    for (const [stage, phase] of expected) {
      const run = runRow({ id: `run-${stage}`, stage });
      const { deps } = fixture({ latestRun: run, activeRun: run });
      const state = await aiWorkspaceStateHandler(deps, revisionCaller);
      expect(state.latestRun?.phase).toBe(phase);
    }
  });

  it("presents a terminal successful run and no active run", async () => {
    const done = runRow({
      id: "run-done",
      stage: "succeeded",
      completedAt: "2026-09-17T04:30:00.000Z",
      reviewIssueCount: 2,
    });
    const { deps } = fixture({ latestRun: done, snapshot: { lastSuccessfulRunId: "run-done" } });
    const state = await aiWorkspaceStateHandler(deps, revisionCaller);
    expect(state.activeRun).toBeNull();
    expect(state.latestRun).toEqual({
      runId: "run-done",
      phase: "succeeded",
      active: false,
      sourceCount: 2,
      pageCount: 14,
      reviewIssueCount: 2,
      completedAt: "2026-09-17T04:30:00.000Z",
    });
    expect(state.failure).toBeNull();
  });
});

describe("deliberate analyze / re-analyze", () => {
  it("creates one run through the frozen creation boundary", async () => {
    const { deps, calls } = fixture();
    const state = await requestAiAnalysisHandler(deps, revisionCaller);
    expect(calls.createRun).toBe(1);
    expect(state.activeRun?.runId).toBe("run-created");
  });

  it("reuses the active run on a second click", async () => {
    const active = runRow({ id: "run-active", stage: "extracting" });
    const { deps, calls } = fixture({ activeRun: active, latestRun: active });
    const first = await requestAiAnalysisHandler(deps, revisionCaller);
    const second = await requestAiAnalysisHandler(deps, revisionCaller);
    expect(calls.createRun).toBe(0);
    expect(first.activeRun?.runId).toBe("run-active");
    expect(second.activeRun?.runId).toBe("run-active");
  });

  it("rejects a scope that is not editable", async () => {
    const { deps, calls } = fixture();
    await expect(
      requestAiAnalysisHandler(deps, { ...revisionCaller, userId: OTHER_USER }),
    ).rejects.toThrow(AI_WORKSPACE_NOT_EDITABLE);
    expect(calls.createRun).toBe(0);
  });

  // Phase 9G — Task 5. The disposition is derived from persisted lifecycle
  // facts, never from elapsed time, a run id or anything the browser knows.
  it("tells a newly created run apart from a reconnect", async () => {
    const created = await requestAiAnalysisHandler(fixture().deps, revisionCaller);
    expect(created.executionDisposition).toBe("start_execution");

    const active = runRow({ id: "run-active", stage: "analyzing" });
    const rejoined = await requestAiAnalysisHandler(
      fixture({ activeRun: active, latestRun: active }).deps,
      revisionCaller,
    );
    expect(rejoined.executionDisposition).toBe("reconnect");
    expect(rejoined.activeRun?.runId).toBe("run-active");
  });

  it("calls a finished earlier run a new execution, not a reconnect", async () => {
    const done = runRow({ id: "run-done", stage: "succeeded" });
    const requested = await requestAiAnalysisHandler(
      fixture({ latestRun: done, snapshot: { lastSuccessfulRunId: "run-done" } }).deps,
      revisionCaller,
    );
    expect(requested.executionDisposition).toBe("start_execution");
  });

  // The disposition describes the run that actually survived this deliberate
  // request, not whatever the lifecycle happened to look like a moment before
  // it: a run still at `created` has never been executed, so this action owns
  // its execution.
  it("executes a surviving run that is still waiting to be executed", async () => {
    const waiting = runRow({ id: "run-waiting", stage: "created" });
    const requested = await requestAiAnalysisHandler(
      fixture({ activeRun: waiting, latestRun: waiting }).deps,
      revisionCaller,
    );
    expect(requested.executionDisposition).toBe("start_execution");
    expect(requested.activeRun?.runId).toBe("run-waiting");
  });

  it("executes a run created after an earlier run finished mid-request", async () => {
    // The previous run left the active set between the two reads: creation
    // succeeds, and the new run must not be mislabelled a reconnect.
    const finishing = runRow({ id: "run-finishing", stage: "analyzing" });
    const requested = await requestAiAnalysisHandler(
      fixture({ latestRun: finishing, activeRun: null }).deps,
      revisionCaller,
    );
    expect(requested.executionDisposition).toBe("start_execution");
  });

  it.each(["extracting", "preflight_ready", "analyzing", "validating", "applying"] as const)(
    "reconnects to a run already advanced to %s",
    async (stage) => {
      const advanced = runRow({ id: `run-${stage}`, stage });
      const requested = await requestAiAnalysisHandler(
        fixture({ activeRun: advanced, latestRun: advanced }).deps,
        revisionCaller,
      );
      expect(requested.executionDisposition).toBe("reconnect");
    },
  );
});

describe("browser-facing review actions", () => {
  it("affirms a yellow conclusion through the Task 2 handler", async () => {
    const { deps, calls } = fixture();
    const state = await affirmAiReviewItemAction(deps, revisionCaller, {
      reviewItemId: "item-1",
      expectedReviewFingerprint: "fp-1",
      method: "individual",
      // Hostile extras must never become authority.
      ownerUserId: OTHER_USER,
      actorUserId: OTHER_USER,
      expectedLockVersion: 99,
      guestTokenHash: "0".repeat(64),
    } as never);
    expect(calls.affirm).toHaveLength(1);
    expect(calls.affirm[0]).toMatchObject({
      ownerUserId: USER,
      actorUserId: USER,
      revisionId: REVISION,
      expectedLockVersion: 7,
      reviewItemId: "item-1",
      expectedReviewFingerprint: "fp-1",
      method: "individual",
    });
    expect(state.reviewIssueCount).toBe(0);
  });

  it("resolves a red issue through the Task 2 handler", async () => {
    const { deps, calls } = fixture();
    await resolveAiReviewIssueAction(deps, revisionCaller, {
      reviewItemId: "item-2",
      expectedReviewFingerprint: "fp-2",
      reason: "reviewed_current_treatment",
      note: "Checked against the signed order form.",
    });
    expect(calls.resolve).toHaveLength(1);
    expect(calls.resolve[0]).toMatchObject({
      reason: "reviewed_current_treatment",
      note: "Checked against the signed order form.",
      ownerUserId: USER,
    });
  });

  it("acknowledges stale sources through the Task 2 handler", async () => {
    const { deps, calls } = fixture({
      snapshot: { sourceState: "stale", lastSuccessfulRunId: "run-0" },
    });
    await acknowledgeAiStaleSourcesAction(deps, revisionCaller, {
      expectedSourceSetFingerprint: CURRENT_FINGERPRINT,
    });
    expect(calls.acknowledge).toHaveLength(1);
    expect(calls.acknowledge[0]).toMatchObject({
      expectedSourceSetFingerprint: CURRENT_FINGERPRINT,
      ownerUserId: USER,
    });
  });

  it("rejects a cross-owner review action", async () => {
    const { deps, calls } = fixture();
    await expect(
      affirmAiReviewItemAction(
        deps,
        { ...revisionCaller, userId: OTHER_USER },
        { reviewItemId: "item-1", expectedReviewFingerprint: "fp-1" },
      ),
    ).rejects.toThrow(AI_WORKSPACE_NOT_EDITABLE);
    expect(calls.affirm).toHaveLength(0);
  });

  it("turns a stale fingerprint conflict into settled copy", async () => {
    const { deps } = fixture({ failing: { operation: "affirm", code: "40001" } });
    await expect(
      affirmAiReviewItemAction(deps, revisionCaller, {
        reviewItemId: "item-1",
        expectedReviewFingerprint: "fp-stale",
      }),
    ).rejects.toThrow(AI_REVIEW_ACTION_CONFLICT);
  });

  it("never lets raw store error text reach the caller", async () => {
    const { deps } = fixture({ failing: { operation: "resolve", code: "22023" } });
    await expect(
      resolveAiReviewIssueAction(deps, revisionCaller, {
        reviewItemId: "item-2",
        expectedReviewFingerprint: "fp-2",
        reason: "not_applicable",
      }),
    ).rejects.toThrow(AI_REVIEW_ACTION_UNAVAILABLE);
    const captured = await resolveAiReviewIssueAction(deps, revisionCaller, {
      reviewItemId: "item-2",
      expectedReviewFingerprint: "fp-2",
      reason: "not_applicable",
    }).catch((error: unknown) => error as Error);
    expect((captured as Error).message).toBe(AI_REVIEW_ACTION_UNAVAILABLE);
    expect(JSON.stringify((captured as Error).message)).not.toContain("service_role");
  });

  it("rejects an unapproved reason and an unapproved affirmation method", async () => {
    const { deps, calls } = fixture();
    await expect(
      resolveAiReviewIssueAction(deps, revisionCaller, {
        reviewItemId: "item-2",
        expectedReviewFingerprint: "fp-2",
        reason: "because_i_said_so",
      }),
    ).rejects.toThrow(AI_REVIEW_ACTION_UNAVAILABLE);
    await expect(
      affirmAiReviewItemAction(deps, revisionCaller, {
        reviewItemId: "item-1",
        expectedReviewFingerprint: "fp-1",
        method: "everything",
      }),
    ).rejects.toThrow(AI_REVIEW_ACTION_UNAVAILABLE);
    expect(calls.resolve).toHaveLength(0);
    expect(calls.affirm).toHaveLength(0);
  });

  it("starts no run and consumes no allowance from a review action", async () => {
    const { deps, calls } = fixture();
    await affirmAiReviewItemAction(deps, revisionCaller, {
      reviewItemId: "item-1",
      expectedReviewFingerprint: "fp-1",
    });
    expect(calls.createRun).toBe(0);
  });
});

describe("stale allowance exhaustion never contradicts the current allowance", () => {
  const exhaustedRun = () =>
    runRow({
      id: "run-exhausted",
      stage: "preflight_failed",
      failureStage: "preflight",
      failureCategory: "preflight",
      failureCode: "allowance_exhausted",
      allowanceConsumed: false,
      completedAt: "2026-09-30T23:00:00.000Z",
    });

  it("keeps the allowance-exhausted presentation while the allowance is truly spent", async () => {
    const { deps } = fixture({ latestRun: exhaustedRun(), monthlyUsed: 10 });
    const state = await aiWorkspaceStateHandler(deps, revisionCaller);
    expect(state.allowance.remaining).toBe(0);
    expect(state.failure?.category).toBe("allowance_exhausted");
  });

  it("drops the stale warning once the allowance is available again", async () => {
    const { deps } = fixture({ latestRun: exhaustedRun(), monthlyUsed: 0 });
    const state = await aiWorkspaceStateHandler(deps, revisionCaller);
    expect(state.allowance.remaining).toBe(10);
    expect(state.failure).toBeNull();
  });

  it("follows the same rule for a signed-in temporary workspace", async () => {
    const signedInGuest: AiCallerScope = { ...guestCaller, authenticatedUserId: USER };
    const spent = fixture({ latestRun: exhaustedRun(), monthlyUsed: 10 });
    expect((await aiWorkspaceStateHandler(spent.deps, signedInGuest)).failure?.category).toBe(
      "allowance_exhausted",
    );
    const reset = fixture({ latestRun: exhaustedRun(), monthlyUsed: 2 });
    expect((await aiWorkspaceStateHandler(reset.deps, signedInGuest)).failure).toBeNull();
  });

  it("leaves ordinary provider and validation failures untouched", async () => {
    const api = fixture({
      latestRun: runRow({
        stage: "api_failed",
        failureCategory: "api",
        failureCode: "api_failure",
      }),
      monthlyUsed: 0,
    });
    expect((await aiWorkspaceStateHandler(api.deps, revisionCaller)).failure?.category).toBe(
      "ai_service",
    );
    const validation = fixture({
      latestRun: runRow({
        stage: "response_invalid",
        failureCategory: "response",
        failureCode: "citation_validation_failure",
      }),
      monthlyUsed: 0,
    });
    expect((await aiWorkspaceStateHandler(validation.deps, revisionCaller)).failure?.category).toBe(
      "arc_validation",
    );
  });
});
