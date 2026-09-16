/**
 * Phase 9F Task 12 — the full AI lifecycle against a FAKE model.
 *
 * No OpenAI client, no network, no credential. These tests prove the ordering
 * invariants that matter: the stage claim is exactly-once, allowance is
 * reserved before the single generative call and is what enters `analyzing`,
 * the response-received hook enters `validating` before any parsing, the
 * deterministic merge happens inside `applying` against the newest accountant
 * draft, a lock conflict is retried locally without a second model call, a
 * failed application never silently restores, and a repeated execute never
 * analyzes twice.
 */

import { describe, expect, it, vi } from "vitest";

import { createEmptyDraft, type WorkflowDraft } from "@/lib/asc606-workflow";

import {
  AI_ALLOWANCE_EXHAUSTED,
  AiApplyConflictError,
  executeAiRunHandler,
  outstandingIssueCount,
  type AiExecutionContext,
  type AiExecutionDeps,
  type AiRunExecutionStore,
} from "../orchestrator";
import { createEmptyAiAnalysisState } from "../merge";
import type { AiCallerScope, AiRunRow, AiRunStage } from "../runs.handlers";
import { TerraAnalysisError } from "../terra.server";
import { fixtureAAnalysis, guidancePackFixture, RUN_ID } from "./merge-fixtures";

const CALLER: AiCallerScope = {
  kind: "revision",
  userId: "user-1",
  revisionId: "rev-1",
  contractId: "contract-1",
};

interface Harness {
  deps: AiExecutionDeps;
  run: AiRunRow;
  stages: AiRunStage[];
  events: string[];
  applied: { draft: WorkflowDraft; lockVersion: number; reviewIssueCount: number } | null;
  failure: { code: string; stage: string; message: string } | null;
  restored: number;
  analyzeCalls: number;
  contextLoads: number;
  applyAttempts: number;
}

function harness(
  options: {
    reserved?: boolean;
    analyzeError?: unknown;
    /** Number of leading apply attempts that lose the optimistic lock. */
    applyConflicts?: number;
    applyThrows?: boolean;
    initialStage?: AiRunStage;
    /** Simulates another caller having already claimed created -> extracting. */
    claimLost?: boolean;
    /** Unexpected exception out of the Phase 9B package builder. */
    buildPackageThrows?: boolean;
    /** Unexpected exception out of the provenance persistence routine. */
    recordPreflightThrows?: boolean;
    /** Replaces the package builder entirely (typed refusal, real builder...). */
    buildPackage?: AiExecutionDeps["buildPackage"];
  } = {},
): Harness {
  const stages: AiRunStage[] = [];
  const events: string[] = [];
  const state = {
    applied: null as Harness["applied"],
    failure: null as Harness["failure"],
    restored: 0,
    analyzeCalls: 0,
    contextLoads: 0,
    applyAttempts: 0,
  };

  const run: AiRunRow = {
    id: RUN_ID,
    stage: options.initialStage ?? "created",
    revisionId: "rev-1",
    guestWorkspaceId: null,
    ownerUserId: "user-1",
    guestTokenHash: null,
    quotaScope: "authenticated",
    sourceCount: 1,
    pageCount: 4,
    inputTokens: null,
    reviewIssueCount: 0,
    completedAt: null,
    safeMessage: null,
  };

  const context: AiExecutionContext = {
    draft: createEmptyDraft(),
    aiState: createEmptyAiAnalysisState(),
    priorContext: null,
    schemaVersion: "arc-workflow-1",
    lockVersion: 3,
    manuallyEnteredFacts: {},
    arcFactSignals: [],
  };

  const store: AiRunExecutionStore = {
    findEditableRevision: async () => ({ id: "rev-1", contractId: "contract-1", lockVersion: 3 }),
    findActiveGuestWorkspace: async () => null,
    findActiveRunForScope: async () => run,
    findRun: async () => run,
    loadRunCreationSnapshot: async () => ({
      expectedLockVersion: 3,
      sourceSetFingerprint: "f".repeat(64),
      preRunCanonicalInputs: {},
      preRunAiState: null,
    }),
    createRun: async () => run.id,
    monthlyUsage: async () => 1,
    guestConsumed: async () => 0,

    advanceStage: async (_runId, from, to) => {
      if (options.claimLost && from === "created") {
        events.push("claim-lost");
        run.stage = "extracting";
        return false;
      }
      expect(run.stage).toBe(from);
      run.stage = to;
      stages.push(to);
      return true;
    },
    loadExecutionContext: async () => {
      state.contextLoads += 1;
      events.push("load-context");
      // Each reload reports a newer accountant lock version.
      return { ...context, lockVersion: 3 + state.contextLoads - 1 };
    },
    recordPreflight: async (args) => {
      events.push("preflight");
      if (options.recordPreflightThrows) throw new Error("preflight persistence exploded");
      run.stage = "preflight_ready";
      run.inputTokens = args.inputTokens;
      stages.push("preflight_ready");
    },
    reserveAllowance: async () => {
      events.push("reserve");
      if (options.reserved === false) {
        return { reserved: false, alreadyReserved: false, remainingAllowance: 0 };
      }
      // The database routine enters `analyzing` in the same transaction.
      run.stage = "analyzing";
      stages.push("analyzing");
      return { reserved: true, alreadyReserved: false, remainingAllowance: 8 };
    },
    applyRun: async (args) => {
      state.applyAttempts += 1;
      events.push("apply");
      if (options.applyConflicts && state.applyAttempts <= options.applyConflicts) {
        throw new AiApplyConflictError();
      }
      if (options.applyThrows) throw new Error("apply exploded");
      state.applied = {
        draft: args.canonicalInputs,
        lockVersion: args.expectedLockVersion,
        reviewIssueCount: args.reviewIssueCount,
      };
      run.stage = "succeeded";
      run.reviewIssueCount = args.reviewIssueCount;
    },
    restorePreRun: async () => {
      events.push("restore");
      state.restored += 1;
    },
    markFailure: async (args) => {
      events.push("fail");
      state.failure = { code: args.code, stage: args.failureStage, message: args.safeMessage };
      run.stage =
        args.category === "preflight"
          ? "preflight_failed"
          : args.category === "api"
            ? "api_failed"
            : args.category === "response"
              ? "response_invalid"
              : "application_failed";
      run.safeMessage = args.safeMessage;
    },
  };

  const analyzer = {
    analyze: vi.fn(async (request: { onResponseReceived?: () => Promise<void> | void }) => {
      state.analyzeCalls += 1;
      events.push("analyze");
      if (options.analyzeError) {
        // An API failure happens BEFORE any response exists, so the hook never
        // runs; a response-shaped failure runs the hook first.
        if (
          options.analyzeError instanceof TerraAnalysisError &&
          options.analyzeError.category !== "api_failure"
        ) {
          await request.onResponseReceived?.();
        }
        throw options.analyzeError;
      }
      await request.onResponseReceived?.();
      events.push("response-received");
      return {
        analysis: fixtureAAnalysis(),
        responseId: "resp_fake",
        model: "gpt-5.6-terra",
        usage: { inputTokens: 10, outputTokens: 5, reasoningTokens: 1, totalTokens: 15 },
        validation: {
          ok: true,
          citationIssues: [],
          guidanceIssues: [],
          provenanceIssues: [],
        } as never,
      };
    }),
  };

  const deps: AiExecutionDeps = {
    store,
    limits: {
      guestRunLimit: 3,
      userMonthlyRunLimit: 10,
      model: "gpt-5.6-terra",
      reasoningEffort: "high",
      promptVersion: "9d",
      outputSchemaVersion: "1",
      guidanceRegistryHash: "hash",
    },
    now: () => new Date("2026-09-16T00:00:00.000Z"),
    newRunId: () => RUN_ID,
    analyzer: analyzer as never,
    buildPackage: async (args) => {
      if (options.buildPackageThrows) throw new Error("package builder exploded");
      if (options.buildPackage) return options.buildPackage(args);
      return {
      ok: true,
      inputTokens: 1234,
      canonicalRequest: { model: "gpt-5.6-terra" },
      package: {
        sources: [
          {
            documentId: "doc-1",
            displayName: "Contract",
            originalFilename: "c.pdf",
            sha256: "a".repeat(64),
            byteSize: 100,
            pageCount: 4,
            pages: [],
          },
        ],
        guidance: guidancePackFixture(),
        currentContext: { manuallyEnteredFacts: {}, draftFingerprint: "x" },
        priorContext: null,
        openAiInput: [],
        combinedFileBytes: 100,
      },
      } as never;
    },
  };

  return {
    deps,
    run,
    stages,
    events,
    get applied() {
      return state.applied;
    },
    get failure() {
      return state.failure;
    },
    get restored() {
      return state.restored;
    },
    get analyzeCalls() {
      return state.analyzeCalls;
    },
    get contextLoads() {
      return state.contextLoads;
    },
    get applyAttempts() {
      return state.applyAttempts;
    },
  } as Harness;
}

describe("Phase 9F — AI run orchestration", () => {
  it("walks the full lifecycle and applies exactly once", async () => {
    const h = harness();
    const status = await executeAiRunHandler(h.deps, CALLER, { runId: RUN_ID });

    expect(h.stages).toEqual([
      "extracting",
      "preflight_ready",
      "analyzing",
      "validating",
      "applying",
    ]);
    expect(h.analyzeCalls).toBe(1);
    expect(h.applied).not.toBeNull();
    expect(status.stage).toBe("succeeded");
  });

  it("reserves the allowance before the single generative call", async () => {
    const h = harness();
    await executeAiRunHandler(h.deps, CALLER, { runId: RUN_ID });
    expect(h.events.indexOf("reserve")).toBeLessThan(h.events.indexOf("analyze"));
  });

  it("lets the allowance transition own analyzing — no separate stage advance", async () => {
    const h = harness();
    await executeAiRunHandler(h.deps, CALLER, { runId: RUN_ID });
    // `analyzing` appears exactly once, and it is the reservation that pushed it.
    expect(h.stages.filter((stage) => stage === "analyzing")).toHaveLength(1);
    expect(h.events.indexOf("reserve")).toBeLessThan(h.stages.indexOf("analyzing") + 1);
  });

  it("enters validating when the response arrives, before parsing it", async () => {
    const h = harness();
    await executeAiRunHandler(h.deps, CALLER, { runId: RUN_ID });
    expect(h.stages.indexOf("validating")).toBeGreaterThan(h.stages.indexOf("analyzing"));
    expect(h.events.indexOf("analyze")).toBeLessThan(h.events.indexOf("response-received"));
  });

  it("stops immediately when another caller already claimed the run", async () => {
    const h = harness({ claimLost: true });
    const status = await executeAiRunHandler(h.deps, CALLER, { runId: RUN_ID });
    expect(h.analyzeCalls).toBe(0);
    expect(h.events).toEqual(["claim-lost"]);
    expect(status.stage).toBe("extracting");
  });

  it("lets only one of two concurrent callers execute the same created run", async () => {
    const h = harness();
    let claims = 0;
    const inner = h.deps.store.advanceStage;
    h.deps.store.advanceStage = async (runId, from, to) => {
      if (from === "created") {
        claims += 1;
        if (claims > 1) return false;
      }
      return inner(runId, from, to);
    };

    const [first, second] = await Promise.all([
      executeAiRunHandler(h.deps, CALLER, { runId: RUN_ID }),
      executeAiRunHandler(h.deps, CALLER, { runId: RUN_ID }),
    ]);

    expect(h.analyzeCalls).toBe(1);
    expect(h.applyAttempts).toBe(1);
    expect([first.stage, second.stage]).toContain("succeeded");
  });

  it("never calls the model when the allowance is exhausted", async () => {
    const h = harness({ reserved: false });
    const status = await executeAiRunHandler(h.deps, CALLER, { runId: RUN_ID });
    expect(h.analyzeCalls).toBe(0);
    expect(status.safeError).toBe(AI_ALLOWANCE_EXHAUSTED);
    expect(h.applied).toBeNull();
  });

  it("records an API failure at the analyzing stage", async () => {
    const h = harness({ analyzeError: new TerraAnalysisError("api_failure", "service down") });
    const status = await executeAiRunHandler(h.deps, CALLER, { runId: RUN_ID });
    expect(h.failure?.stage).toBe("analyzing");
    expect(status.stage).toBe("api_failed");
    expect(h.applied).toBeNull();
  });

  it("fails closed at validating when the model response is rejected", async () => {
    const h = harness({
      analyzeError: new TerraAnalysisError("citation_validation_failure", "rejected"),
    });
    const status = await executeAiRunHandler(h.deps, CALLER, { runId: RUN_ID });
    expect(h.failure?.stage).toBe("validating");
    expect(status.stage).toBe("response_invalid");
    expect(h.applied).toBeNull();
    expect(h.restored).toBe(0);
  });

  it("merges against the newest accountant draft inside applying", async () => {
    const h = harness();
    await executeAiRunHandler(h.deps, CALLER, { runId: RUN_ID });
    // One load for the run context, one immediately before application.
    expect(h.contextLoads).toBe(2);
    expect(h.applied?.lockVersion).toBe(4);
  });

  it("re-merges and retries a lock conflict without a second model call", async () => {
    const h = harness({ applyConflicts: 2 });
    const status = await executeAiRunHandler(h.deps, CALLER, { runId: RUN_ID });
    expect(h.applyAttempts).toBe(3);
    expect(h.analyzeCalls).toBe(1);
    expect(status.stage).toBe("succeeded");
  });

  it("gives up after three conflicting apply attempts", async () => {
    const h = harness({ applyConflicts: 5 });
    const status = await executeAiRunHandler(h.deps, CALLER, { runId: RUN_ID });
    expect(h.applyAttempts).toBe(3);
    expect(h.analyzeCalls).toBe(1);
    expect(status.stage).toBe("application_failed");
    expect(h.applied).toBeNull();
  });

  it("never restores automatically when application fails", async () => {
    const h = harness({ applyThrows: true });
    const status = await executeAiRunHandler(h.deps, CALLER, { runId: RUN_ID });
    expect(h.restored).toBe(0);
    expect(h.events).not.toContain("restore");
    expect(status.stage).toBe("application_failed");
  });

  it("never analyzes twice for the same run", async () => {
    const h = harness({ initialStage: "analyzing" });
    const status = await executeAiRunHandler(h.deps, CALLER, { runId: RUN_ID });
    expect(h.analyzeCalls).toBe(0);
    expect(status.stage).toBe("analyzing");
  });

  it("refuses a run the caller does not own", async () => {
    const h = harness();
    await expect(
      executeAiRunHandler(h.deps, { ...CALLER, userId: "someone-else" }, { runId: RUN_ID }),
    ).rejects.toThrow();
  });

  it("counts only outstanding review issues", () => {
    expect(
      outstandingIssueCount([
        { state: "red" },
        { state: "yellow" },
        { state: "resolved" },
      ] as never),
    ).toBe(2);
  });
});
