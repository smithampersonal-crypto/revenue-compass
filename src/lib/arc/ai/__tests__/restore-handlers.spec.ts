/**
 * Phase 9G — Task 9C. The deliberate whole-run restore action.
 *
 * One confirmation, one attempt, no retry, no merge. The offer is re-derived
 * from persistence on every call, the trusted routine owns the real security
 * checks, and any refusal from it reads as "nothing was changed".
 */

import { describe, expect, it, vi } from "vitest";

import type { AiRestoreCandidate } from "../restore-eligibility";
import {
  AI_RESTORE_CONFLICT,
  AI_RESTORE_UNAVAILABLE,
  restorableRunForCaller,
  restoreAiAnalysisHandler,
  type AiRestoreDeps,
} from "../restore.handlers";
import { AI_WORKSPACE_NOT_EDITABLE, type AiCallerScope } from "../runs.handlers";

const REVISION = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const GUEST = "33333333-3333-4333-8333-333333333333";
const HASH = "9".repeat(64);
const FINGERPRINT = "a".repeat(64);
const RUN = "run-1";

const caller: AiCallerScope = {
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

function candidate(overrides: Partial<AiRestoreCandidate> = {}): AiRestoreCandidate {
  return {
    runId: RUN,
    stage: "succeeded",
    completedAt: "2026-09-18T10:00:00.000Z",
    restoredAt: null,
    sourceSetFingerprint: FINGERPRINT,
    preRunSnapshot: "exact",
    belongsToScope: true,
    ...overrides,
  };
}

interface Options {
  editable?: boolean;
  candidate?: AiRestoreCandidate | null;
  lastSuccessfulRunId?: string | null;
  activeRun?: boolean;
  restoreThrows?: Error;
}

function fixture(options: Options = {}): {
  deps: AiRestoreDeps;
  restore: ReturnType<typeof vi.fn>;
} {
  const restore = vi.fn(async () => {
    if (options.restoreThrows) throw options.restoreThrows;
    return { lockVersion: 8, idempotent: false };
  });

  const activeRun = options.activeRun === true ? { id: "run-active", stage: "analyzing" } : null;

  const store = {
    findEditableRevision: async (revisionId: string, userId: string) =>
      options.editable === false || revisionId !== REVISION || userId !== USER
        ? null
        : { id: REVISION, contractId: "c", lockVersion: 7 },
    findActiveGuestWorkspace: async (tokenHash: string) =>
      options.editable === false || tokenHash !== HASH ? null : { id: GUEST, lockVersion: 4 },
    findActiveRunForScope: async () => activeRun,
    findLatestRunForScope: async () => null,
    findRun: async () => null,
    loadWorkspaceSnapshot: async () => ({
      lastSuccessfulRunId:
        options.lastSuccessfulRunId === undefined ? RUN : options.lastSuccessfulRunId,
      currentSourceSetFingerprint: FINGERPRINT,
      sourceState: "current",
      hasIncludedSources: true,
      acknowledgedSourceFingerprint: null,
      outstandingReviewIssueCount: 0,
      guestWorkspaceExpiresAt: null,
      reviewItems: [],
      reviewPayloadMalformed: false,
    }),
    loadRestoreCandidate: async (_caller: AiCallerScope, runId: string) =>
      options.candidate === undefined ? candidate({ runId }) : options.candidate,
    monthlyUsage: async () => 1,
    guestConsumed: async () => 0,
    restorePreAiRun: restore,
  } as unknown as AiRestoreDeps["store"];

  return {
    restore,
    deps: {
      store,
      limits: {
        guestRunLimit: 3,
        userMonthlyRunLimit: 10,
        model: "m",
        reasoningEffort: "high",
        promptVersion: "p",
        outputSchemaVersion: "s",
        guidanceRegistryHash: "h",
      },
      now: () => new Date("2026-09-18T12:00:00.000Z"),
      newRunId: () => "run-new",
    } as unknown as AiRestoreDeps,
  };
}

describe("restorableRunForCaller", () => {
  it("offers nothing when there is no successful run, without loading a candidate", async () => {
    const f = fixture();
    const loadRestoreCandidate = vi.fn();
    const store = { ...f.deps.store, loadRestoreCandidate } as AiRestoreDeps["store"];
    const offer = await restorableRunForCaller(store, caller, {
      lastSuccessfulRunId: null,
      currentSourceSetFingerprint: FINGERPRINT,
      activeRun: false,
    });
    expect(offer).toBeNull();
    expect(loadRestoreCandidate).not.toHaveBeenCalled();
  });

  it("offers the compatible current run", async () => {
    const f = fixture();
    await expect(
      restorableRunForCaller(f.deps.store, caller, {
        lastSuccessfulRunId: RUN,
        currentSourceSetFingerprint: FINGERPRINT,
        activeRun: false,
      }),
    ).resolves.toEqual({ runId: RUN, completedAt: "2026-09-18T10:00:00.000Z" });
  });

  it("offers nothing while a run is executing", async () => {
    const f = fixture();
    await expect(
      restorableRunForCaller(f.deps.store, caller, {
        lastSuccessfulRunId: RUN,
        currentSourceSetFingerprint: FINGERPRINT,
        activeRun: true,
      }),
    ).resolves.toBeNull();
  });
});

describe("restoreAiAnalysisHandler", () => {
  it("applies the offered run once, with the scope lock the server read", async () => {
    const f = fixture();
    const result = await restoreAiAnalysisHandler(f.deps, caller, { expectedRunId: RUN });
    expect(result.restoredRunId).toBe(RUN);
    expect(result.workspace).toBeTruthy();
    expect(f.restore).toHaveBeenCalledTimes(1);
    expect(f.restore).toHaveBeenCalledWith({
      runId: RUN,
      ownerUserId: USER,
      guestTokenHash: null,
      expectedLockVersion: 7,
    });
  });

  it("passes the guest token hash and no owner for a guest scope", async () => {
    const f = fixture();
    await restoreAiAnalysisHandler(f.deps, guestCaller, { expectedRunId: RUN });
    expect(f.restore).toHaveBeenCalledWith({
      runId: RUN,
      ownerUserId: null,
      guestTokenHash: HASH,
      expectedLockVersion: 4,
    });
  });

  it("refuses a scope that is no longer editable, and never calls the routine", async () => {
    const f = fixture({ editable: false });
    await expect(restoreAiAnalysisHandler(f.deps, caller, { expectedRunId: RUN })).rejects.toThrow(
      AI_WORKSPACE_NOT_EDITABLE,
    );
    expect(f.restore).not.toHaveBeenCalled();
  });

  it("refuses a run that is not the one currently offered", async () => {
    const f = fixture();
    await expect(
      restoreAiAnalysisHandler(f.deps, caller, { expectedRunId: "run-other" }),
    ).rejects.toThrow(AI_RESTORE_UNAVAILABLE);
    expect(f.restore).not.toHaveBeenCalled();
  });

  it("refuses when nothing is restorable any more", async () => {
    const f = fixture({ candidate: candidate({ restoredAt: "2026-09-18T11:00:00.000Z" }) });
    await expect(restoreAiAnalysisHandler(f.deps, caller, { expectedRunId: RUN })).rejects.toThrow(
      AI_RESTORE_UNAVAILABLE,
    );
    expect(f.restore).not.toHaveBeenCalled();
  });

  it("reports the trusted routine's refusal as a conflict, and never retries", async () => {
    const f = fixture({ restoreThrows: new Error("lock_version mismatch") });
    await expect(restoreAiAnalysisHandler(f.deps, caller, { expectedRunId: RUN })).rejects.toThrow(
      AI_RESTORE_CONFLICT,
    );
    expect(f.restore).toHaveBeenCalledTimes(1);
  });
});
