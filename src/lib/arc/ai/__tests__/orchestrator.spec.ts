/**
 * Phase 9F Task 12 — the full AI lifecycle against a FAKE model.
 *
 * No OpenAI client, no network, no credential. These tests prove the ordering
 * invariants that matter: allowance is reserved before the single generative
 * call, exactly one generative call happens per run, a failure after the model
 * responded restores the pre-run state, and a repeated execute never analyzes
 * twice.
 */

import { describe, expect, it, vi } from "vitest";

import { createEmptyDraft, type WorkflowDraft } from "@/lib/asc606-workflow";

import {
  AI_ALLOWANCE_EXHAUSTED,
  executeAiRunHandler,
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
  applied: { draft: WorkflowDraft } | null;
  failure: { code: string; message: string } | null;
  restored: number;
  analyzeCalls: number;
}

function harness(
  options: {
    reserved?: boolean;
    analyzeError?: unknown;
    applyThrows?: boolean;
    initialStage?: AiRunStage;
  } = {},
): Harness {
  const stages: AiRunStage[] = [];
  const events: string[] = [];
  const state = {
    applied: null as { draft: WorkflowDraft } | null,
    failure: null as { code: string; message: string } | null,
    restored: 0,
    analyzeCalls: 0,
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
      expect(run.stage).toBe(from);
      run.stage = to;
      stages.push(to);
    },
    loadExecutionContext: async () => context,
    recordPreflight: async (args) => {
      events.push("preflight");
      run.stage = "preflight_ready";
      run.inputTokens = args.inputTokens;
      stages.push("preflight_ready");
    },
    reserveAllowance: async () => {
      events.push("reserve");
      return options.reserved === false
        ? { reserved: false, alreadyReserved: false, remainingAllowance: 0 }
        : { reserved: true, alreadyReserved: false, remainingAllowance: 8 };
    },
    applyRun: async (args) => {
      events.push("apply");
      if (options.applyThrows) throw new Error("conflict");
      state.applied = { draft: args.canonicalInputs };
      run.stage = "succeeded";
      run.reviewIssueCount = args.reviewIssueCount;
    },
    restorePreRun: async () => {
      events.push("restore");
      state.restored += 1;
    },
    markFailure: async (args) => {
      events.push("fail");
      state.failure = { code: args.code, message: args.safeMessage };
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
    analyze: vi.fn(async () => {
      state.analyzeCalls += 1;
      events.push("analyze");
      if (options.analyzeError) throw options.analyzeError;
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
    analyzer,
    buildPackage: async () => ({
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
    }),
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
    expect(h.events).toEqual(["preflight", "reserve", "analyze", "apply"]);
    expect(h.analyzeCalls).toBe(1);
    expect(h.applied).not.toBeNull();
    expect(status.stage).toBe("succeeded");
  });

  it("reserves the allowance before the single generative call", async () => {
    const h = harness();
    await executeAiRunHandler(h.deps, CALLER, { runId: RUN_ID });
    expect(h.events.indexOf("reserve")).toBeLessThan(h.events.indexOf("analyze"));
  });

  it("never calls the model when the allowance is exhausted", async () => {
    const h = harness({ reserved: false });
    const status = await executeAiRunHandler(h.deps, CALLER, { runId: RUN_ID });
    expect(h.analyzeCalls).toBe(0);
    expect(status.safeError).toBe(AI_ALLOWANCE_EXHAUSTED);
    expect(h.applied).toBeNull();
  });

  it("fails closed without applying when the model response is rejected", async () => {
    const h = harness({
      analyzeError: new TerraAnalysisError("citation_validation_failure", "rejected"),
    });
    const status = await executeAiRunHandler(h.deps, CALLER, { runId: RUN_ID });
    expect(status.stage).toBe("response_invalid");
    expect(h.applied).toBeNull();
    expect(h.restored).toBe(0);
  });

  it("restores the pre-run state when application fails", async () => {
    const h = harness({ applyThrows: true });
    const status = await executeAiRunHandler(h.deps, CALLER, { runId: RUN_ID });
    expect(h.restored).toBe(1);
    expect(h.events).toEqual(["preflight", "reserve", "analyze", "apply", "restore", "fail"]);
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
});
