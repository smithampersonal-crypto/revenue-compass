/**
 * Phase 9C — ownership, quota scope, idempotency and safe DTO regressions,
 * plus the acceptance-patch rule that every immutable creation value is
 * authored by the server.
 *
 * These exercise the handler layer against an in-memory store that behaves
 * like the trusted database routines: one active run per owner scope, and
 * identity decided by the server.
 */

import { describe, expect, it } from "vitest";

import {
  AI_RUN_NOT_AVAILABLE,
  AI_WORKSPACE_NOT_EDITABLE,
  deriveAiCaller,
  quotaScopeFor,
  runStatusHandler,
  startAiAnalysisHandler,
  usageSummaryHandler,
  utcMonthOf,
  type AiCallerScope,
  type AiRunCreateArgs,
  type AiRunDeps,
  type AiRunRow,
  type AiRunStore,
} from "../runs.handlers";

interface Fixture {
  deps: AiRunDeps;
  runs: AiRunRow[];
  created: AiRunCreateArgs[];
  monthly: Map<string, number>;
  guestUsed: Map<string, number>;
}

const SNAPSHOT = {
  expectedLockVersion: 7,
  sourceSetFingerprint: "f".repeat(64),
  preRunCanonicalInputs: { step1: { contractTitle: "Genomix" } },
  preRunAiState: { lastSuccessfulRunId: "run-0", sourceState: "stale" },
};

function fixture(
  options: {
    revisions?: Array<{ id: string; userId: string; contractId: string }>;
    guests?: Array<{ id: string; tokenHash: string }>;
    snapshot?: Partial<typeof SNAPSHOT>;
    now?: Date;
  } = {},
): Fixture {
  const runs: AiRunRow[] = [];
  const created: AiRunCreateArgs[] = [];
  const monthly = new Map<string, number>();
  const guestUsed = new Map<string, number>();
  let counter = 0;

  const store: AiRunStore = {
    findEditableRevision: async (revisionId, userId) => {
      const found = (options.revisions ?? []).find(
        (r) => r.id === revisionId && r.userId === userId,
      );
      return found ? { id: found.id, contractId: found.contractId, lockVersion: 1 } : null;
    },
    findActiveGuestWorkspace: async (tokenHash) => {
      const found = (options.guests ?? []).find((g) => g.tokenHash === tokenHash);
      return found ? { id: found.id, lockVersion: 1 } : null;
    },
    findActiveRunForScope: async (scope) =>
      runs.find(
        (r) =>
          (scope.revisionId ? r.revisionId === scope.revisionId : true) &&
          (scope.guestWorkspaceId ? r.guestWorkspaceId === scope.guestWorkspaceId : true) &&
          (scope.revisionId ? true : r.revisionId === null) &&
          r.stage === "created",
      ) ?? null,
    findRun: async (runId) => runs.find((r) => r.id === runId) ?? null,
    loadRunCreationSnapshot: async () => ({ ...SNAPSHOT, ...(options.snapshot ?? {}) }),
    createRun: async (args) => {
      created.push(args);
      const row: AiRunRow = {
        id: args.runId,
        stage: "created",
        revisionId: args.revisionId,
        guestWorkspaceId: args.guestWorkspaceId,
        ownerUserId: args.ownerUserId,
        guestTokenHash: args.guestTokenHash,
        quotaScope: args.quotaScope,
        sourceCount: 0,
        pageCount: 0,
        inputTokens: null,
        reviewIssueCount: 0,
        completedAt: null,
        safeMessage: null,
      };
      runs.push(row);
      return row.id;
    },
    monthlyUsage: async (userId, month) => monthly.get(`${userId}:${month}`) ?? 0,
    guestConsumed: async (workspaceId) => guestUsed.get(workspaceId) ?? 0,
  };

  return {
    runs,
    created,
    monthly,
    guestUsed,
    deps: {
      store,
      limits: {
        guestRunLimit: 3,
        userMonthlyRunLimit: 10,
        model: "gpt-5.6-terra",
        reasoningEffort: "high",
        promptVersion: "arc.ai.prompt.v1",
        outputSchemaVersion: "arc.ai.schema.v1",
        guidanceRegistryHash: "hash",
      },
      now: () => options.now ?? new Date("2026-09-15T00:00:00.000Z"),
      newRunId: () => `run-${++counter}`,
    },
  };
}

const OWNER = "user-a";
const REVISION = { id: "11111111-1111-4111-8111-111111111111", userId: OWNER, contractId: "c-1" };
const OWNER_CALLER: AiCallerScope = {
  kind: "revision",
  userId: OWNER,
  revisionId: REVISION.id,
  contractId: "c-1",
};

describe("AI caller derivation", () => {
  it("accepts the authenticated owner of a draft revision", async () => {
    const { deps } = fixture({ revisions: [REVISION] });
    const caller = await deriveAiCaller(deps.store, {
      authenticatedUserId: OWNER,
      guestTokenHash: null,
      requestedRevisionId: REVISION.id,
    });
    expect(caller).toEqual(OWNER_CALLER);
  });

  it("denies a different authenticated user who knows the revision id", async () => {
    const { deps } = fixture({ revisions: [REVISION] });
    await expect(
      deriveAiCaller(deps.store, {
        authenticatedUserId: "user-b",
        guestTokenHash: null,
        requestedRevisionId: REVISION.id,
      }),
    ).rejects.toThrow(AI_WORKSPACE_NOT_EDITABLE);
  });

  it("accepts an anonymous visitor with an active temporary workspace", async () => {
    const { deps } = fixture({ guests: [{ id: "ws-1", tokenHash: "hash-1" }] });
    const caller = await deriveAiCaller(deps.store, {
      authenticatedUserId: null,
      guestTokenHash: "hash-1",
      requestedRevisionId: null,
    });
    expect(caller).toEqual({
      kind: "guest",
      guestTokenHash: "hash-1",
      guestWorkspaceId: "ws-1",
      authenticatedUserId: null,
    });
    expect(quotaScopeFor(caller)).toBe("guest");
  });

  it("denies an expired or unknown guest credential", async () => {
    const { deps } = fixture({ guests: [] });
    await expect(
      deriveAiCaller(deps.store, {
        authenticatedUserId: null,
        guestTokenHash: "expired",
        requestedRevisionId: null,
      }),
    ).rejects.toThrow(AI_WORKSPACE_NOT_EDITABLE);
  });

  it("cannot turn itself authenticated by naming an account", async () => {
    const { deps } = fixture({ revisions: [REVISION] });
    await expect(
      deriveAiCaller(deps.store, {
        // No verified session: a supplied account id buys nothing.
        authenticatedUserId: null,
        guestTokenHash: null,
        requestedRevisionId: REVISION.id,
      }),
    ).rejects.toThrow(AI_RUN_NOT_AVAILABLE);
  });

  it("uses the account allowance for a signed-in caller in a temporary workspace", async () => {
    const { deps, monthly } = fixture({ guests: [{ id: "ws-1", tokenHash: "hash-1" }] });
    const caller = await deriveAiCaller(deps.store, {
      authenticatedUserId: OWNER,
      guestTokenHash: "hash-1",
      requestedRevisionId: null,
    });
    expect(quotaScopeFor(caller)).toBe("authenticated");

    monthly.set(`${OWNER}:2026-09-01`, 4);
    await expect(usageSummaryHandler(deps, caller)).resolves.toEqual({
      scope: "authenticated",
      limit: 10,
      used: 4,
      remaining: 6,
      utcMonth: "2026-09-01",
    });
  });
});

describe("starting an AI analysis", () => {
  it("returns only approved safe fields", async () => {
    const { deps } = fixture({ revisions: [REVISION] });
    const dto = await startAiAnalysisHandler(deps, OWNER_CALLER);
    expect(Object.keys(dto).sort()).toEqual(
      [
        "completedAt",
        "inputTokens",
        "pageCount",
        "remainingAllowance",
        "reviewIssueCount",
        "runId",
        "safeError",
        "sourceCount",
        "stage",
      ].sort(),
    );
    expect(dto.stage).toBe("created");
    const serialized = JSON.stringify(dto);
    for (const forbidden of ["hash-1", "prompt", "base64", "service_role", "%PDF", "Genomix"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("does not consume allowance and never sets an OpenAI start", async () => {
    const { deps, monthly, guestUsed } = fixture({ guests: [{ id: "ws-1", tokenHash: "h" }] });
    const caller: AiCallerScope = {
      kind: "guest",
      guestTokenHash: "h",
      guestWorkspaceId: "ws-1",
      authenticatedUserId: null,
    };
    const dto = await startAiAnalysisHandler(deps, caller);
    expect(dto.remainingAllowance).toBe(3);
    expect(monthly.size).toBe(0);
    expect(guestUsed.size).toBe(0);
  });

  it("returns the same run on a double click", async () => {
    const { deps, runs } = fixture({ revisions: [REVISION] });
    const first = await startAiAnalysisHandler(deps, OWNER_CALLER);
    const second = await startAiAnalysisHandler(deps, OWNER_CALLER);
    expect(second.runId).toBe(first.runId);
    expect(runs).toHaveLength(1);
  });

  it("takes identity from the server even when the payload claims another owner", async () => {
    const { deps, runs } = fixture({ revisions: [REVISION] });
    // The handler accepts no request payload at all, so hostile extras cannot
    // reach it even if a caller invents them.
    await (
      startAiAnalysisHandler as unknown as (
        deps: AiRunDeps,
        caller: AiCallerScope,
        hostile: unknown,
      ) => Promise<unknown>
    )(deps, OWNER_CALLER, {
      userId: "attacker",
      ownerUserId: "attacker",
      guestTokenHash: "stolen",
      sourceSetFingerprint: "attacker-fingerprint",
      preRunCanonicalInputs: { step1: { contractTitle: "attacker" } },
      expectedLockVersion: 999,
    });
    expect(runs[0]!.ownerUserId).toBe(OWNER);
    expect(runs[0]!.guestTokenHash).toBeNull();
  });
});

describe("server-authored creation provenance", () => {
  it("persists the server snapshot, not any browser value", async () => {
    const { deps, created } = fixture({ revisions: [REVISION] });
    await startAiAnalysisHandler(deps, OWNER_CALLER);
    const args = created[0]!;
    expect(args.sourceSetFingerprint).toBe(SNAPSHOT.sourceSetFingerprint);
    expect(args.preRunCanonicalInputs).toEqual(SNAPSHOT.preRunCanonicalInputs);
    expect(args.preRunAiState).toEqual(SNAPSHOT.preRunAiState);
  });

  it("forwards the observed optimistic lock, never null", async () => {
    const { deps, created } = fixture({ revisions: [REVISION] });
    await startAiAnalysisHandler(deps, OWNER_CALLER);
    expect(created[0]!.expectedLockVersion).toBe(SNAPSHOT.expectedLockVersion);
    expect(created[0]!.expectedLockVersion).not.toBeNull();
  });

  it("stores a null pre-run AI state when the scope has no sidecar yet", async () => {
    const { deps, created } = fixture({
      guests: [{ id: "ws-1", tokenHash: "h" }],
      snapshot: { preRunAiState: null, preRunCanonicalInputs: { draft: true } },
    });
    await startAiAnalysisHandler(deps, {
      kind: "guest",
      guestTokenHash: "h",
      guestWorkspaceId: "ws-1",
      authenticatedUserId: null,
    });
    expect(created[0]!.preRunAiState).toBeNull();
    expect(created[0]!.preRunCanonicalInputs).toEqual({ draft: true });
  });

  it("never exposes the creation snapshot to the browser", async () => {
    const { deps } = fixture({ revisions: [REVISION] });
    const dto = await startAiAnalysisHandler(deps, OWNER_CALLER);
    expect(JSON.stringify(dto)).not.toContain(SNAPSHOT.sourceSetFingerprint);
    expect(Object.keys(dto)).not.toContain("preRunCanonicalInputs");
    expect(Object.keys(dto)).not.toContain("expectedLockVersion");
  });
});

describe("polling and allowance", () => {
  it("refuses a run the caller does not own, even with its id", async () => {
    const { deps } = fixture({
      revisions: [
        REVISION,
        { id: "22222222-2222-4222-8222-222222222222", userId: "user-b", contractId: "c-2" },
      ],
    });
    const other: AiCallerScope = {
      kind: "revision",
      userId: "user-b",
      revisionId: "22222222-2222-4222-8222-222222222222",
      contractId: "c-2",
    };
    const run = await startAiAnalysisHandler(deps, OWNER_CALLER);

    await expect(runStatusHandler(deps, other, { runId: run.runId })).rejects.toThrow(
      AI_RUN_NOT_AVAILABLE,
    );
    await expect(runStatusHandler(deps, OWNER_CALLER, { runId: run.runId })).resolves.toMatchObject({
      runId: run.runId,
    });
  });

  it("refuses another temporary workspace's run", async () => {
    const { deps } = fixture({
      guests: [
        { id: "ws-1", tokenHash: "h1" },
        { id: "ws-2", tokenHash: "h2" },
      ],
    });
    const guestA: AiCallerScope = {
      kind: "guest",
      guestTokenHash: "h1",
      guestWorkspaceId: "ws-1",
      authenticatedUserId: null,
    };
    const guestB: AiCallerScope = {
      kind: "guest",
      guestTokenHash: "h2",
      guestWorkspaceId: "ws-2",
      authenticatedUserId: null,
    };
    const run = await startAiAnalysisHandler(deps, guestA);
    await expect(runStatusHandler(deps, guestB, { runId: run.runId })).rejects.toThrow(
      AI_RUN_NOT_AVAILABLE,
    );
  });

  it("reports the caller's own allowance only", async () => {
    const { deps, guestUsed } = fixture({ guests: [{ id: "ws-1", tokenHash: "h1" }] });
    guestUsed.set("ws-1", 3);
    const caller: AiCallerScope = {
      kind: "guest",
      guestTokenHash: "h1",
      guestWorkspaceId: "ws-1",
      authenticatedUserId: null,
    };
    await expect(usageSummaryHandler(deps, caller)).resolves.toEqual({
      scope: "guest",
      limit: 3,
      used: 3,
      remaining: 0,
      utcMonth: null,
    });
  });

  it("counts the account allowance in the caller's UTC month", () => {
    expect(utcMonthOf(new Date("2026-12-31T23:59:59.000Z"))).toBe("2026-12-01");
    expect(utcMonthOf(new Date("2027-01-01T00:00:00.000Z"))).toBe("2027-01-01");
  });
});
