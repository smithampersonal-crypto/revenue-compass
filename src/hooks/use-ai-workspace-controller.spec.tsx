// @vitest-environment jsdom
/**
 * Phase 9G — Task 5. The AI workspace client controller.
 *
 * Every server call is a spy: no OpenAI, no network, no framework transform.
 * The point of these tests is the sequencing — one read on mount, execution
 * only from a deliberate action, polling only while a run is active, and a
 * response from an older scope never landing on a newer one.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AI_ANALYSIS_NOT_STARTED_NO_ALLOWANCE,
  AI_ANALYSIS_NOT_STARTED_UNSAVED,
  AI_CONTROLLER_UNAVAILABLE,
} from "@/lib/arc/ai/workspace-client";
import type { AiWorkspacePhase, AiWorkspaceStateDto } from "@/lib/arc/ai/workspace.handlers";

import { useAiWorkspaceController, type AiWorkspacePorts } from "./use-ai-workspace-controller";

const RUN = "11111111-1111-4111-8111-111111111111";
const OTHER_RUN = "22222222-2222-4222-8222-222222222222";

function run(runId: string, phase: AiWorkspacePhase) {
  return {
    runId,
    phase,
    active: phase !== "succeeded" && phase !== "failed",
    sourceCount: 1,
    pageCount: 4,
    reviewIssueCount: 0,
    completedAt: null,
  };
}

function state(overrides: Partial<AiWorkspaceStateDto> = {}): AiWorkspaceStateDto {
  return {
    hasAnalysis: false,
    activeRun: null,
    latestRun: null,
    lastSuccessfulRunId: null,
    sourceState: "current",
    hasIncludedSources: true,
    sourceSetFingerprint: "fp-current",
    reviewIssueCount: 0,
    reviewItems: [],
    assumptionItems: [],
    assumptionCount: 0,
    reviewPayloadMalformed: false,
    fieldProvenance: {},
    objectProvenance: {},
    staleSourceAcknowledged: false,
    allowance: { scope: "authenticated", limit: 10, used: 0, remaining: 10, resetAt: null },
    failure: null,
    restorableRun: null,
    ...overrides,
  };
}

const activeState = (phase: AiWorkspacePhase = "preparing") =>
  state({ activeRun: run(RUN, phase), latestRun: run(RUN, phase) });

const succeededState = () =>
  state({
    hasAnalysis: true,
    activeRun: null,
    latestRun: { ...run(RUN, "succeeded"), completedAt: "2026-01-01T00:00:00.000Z" },
    lastSuccessfulRunId: RUN,
    allowance: { scope: "authenticated", limit: 10, used: 1, remaining: 9, resetAt: null },
  });

const failedState = () =>
  state({
    activeRun: null,
    latestRun: { ...run(RUN, "failed"), completedAt: "2026-01-01T00:00:00.000Z" },
    failure: {
      category: "ai_service",
      headline: "AI analysis did not run",
      whatHappened: "The AI service could not be reached.",
      impact: "Nothing in the analysis changed.",
      whatYouCanDo: "Try the analysis again in a moment.",
      allowance: "This attempt did not use an analysis.",
    },
  });

interface Harness {
  ports: AiWorkspacePorts;
  spies: {
    getWorkspaceState: ReturnType<typeof vi.fn>;
    requestAnalysis: ReturnType<typeof vi.fn>;
    executeAnalysis: ReturnType<typeof vi.fn>;
    affirmReviewItem: ReturnType<typeof vi.fn>;
    resolveReviewIssue: ReturnType<typeof vi.fn>;
    acknowledgeStaleSources: ReturnType<typeof vi.fn>;
    flushAutosave: ReturnType<typeof vi.fn>;
    reloadCanonicalAnalysis: ReturnType<typeof vi.fn>;
  };
  calls: string[];
}

function harness(overrides: Partial<Record<keyof AiWorkspacePorts, unknown>> = {}): Harness {
  const calls: string[] = [];
  // The default double behaves like the server: once a run has been created,
  // every later read reports that run as active.
  const box: { current: AiWorkspaceStateDto } = { current: state() };
  const spies = {
    getWorkspaceState: vi.fn(async () => {
      calls.push("read");
      return box.current;
    }),
    requestAnalysis: vi.fn(async () => {
      calls.push("request");
      box.current = activeState();
      return { ...activeState(), executionDisposition: "start_execution" as const };
    }),
    executeAnalysis: vi.fn(async () => {
      calls.push("execute");
      return { ok: true };
    }),
    affirmReviewItem: vi.fn(async () => state()),
    resolveReviewIssue: vi.fn(async () => state()),
    acknowledgeStaleSources: vi.fn(async () => state({ staleSourceAcknowledged: true })),
    flushAutosave: vi.fn(async () => {
      calls.push("flush");
      return { ok: true };
    }),
    reloadCanonicalAnalysis: vi.fn(() => {
      calls.push("reload");
    }),
  };
  Object.assign(spies, overrides);
  return { ports: spies as unknown as AiWorkspacePorts, spies, calls };
}

function mount(
  h: Harness,
  scopeKey: string | null = "contract:rev-1",
  revisionId: string | null = "rev-1",
) {
  return renderHook(
    (props: { scopeKey: string | null; revisionId: string | null }) =>
      useAiWorkspaceController({ ...props, ports: h.ports, pollIntervalMs: 2_000 }),
    { initialProps: { scopeKey, revisionId } },
  );
}

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("the AI workspace controller", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("initial load", () => {
    it("performs exactly one safe read and starts nothing", async () => {
      const h = harness();
      const { result } = mount(h);
      await waitFor(() => expect(result.current.loadState).toBe("ready"));
      expect(h.spies.getWorkspaceState).toHaveBeenCalledTimes(1);
      expect(h.spies.requestAnalysis).not.toHaveBeenCalled();
      expect(h.spies.executeAnalysis).not.toHaveBeenCalled();
      expect(result.current.workspace?.allowance.remaining).toBe(10);
      expect(result.current.analyzeMode).toBe("analyze");
      expect(result.current.active).toBe(false);
      expect(result.current.progress).toBeNull();
    });

    it("stays idle and reads nothing without a workspace scope", async () => {
      const h = harness();
      const { result } = mount(h, null, null);
      await tick(5_000);
      expect(result.current.loadState).toBe("idle");
      expect(h.spies.getWorkspaceState).not.toHaveBeenCalled();
    });

    it("never polls an idle workspace", async () => {
      const h = harness();
      mount(h);
      await tick(10_000);
      expect(h.spies.getWorkspaceState).toHaveBeenCalledTimes(1);
    });
  });

  describe("reconnect", () => {
    it("adopts an already-running analysis without executing anything", async () => {
      const h = harness({ getWorkspaceState: vi.fn(async () => activeState("analyzing")) });
      const { result } = mount(h);
      await waitFor(() => expect(result.current.active).toBe(true));
      expect(result.current.progress).toEqual({
        phase: "analyzing",
        step: 2,
        label: "Analyzing contract",
      });
      expect(h.spies.executeAnalysis).not.toHaveBeenCalled();
      expect(h.spies.requestAnalysis).not.toHaveBeenCalled();
    });

    it("polls while the run is active and reports each distinct phase", async () => {
      let current = activeState("preparing");
      const h = harness({ getWorkspaceState: vi.fn(async () => current) });
      const { result } = mount(h);
      await waitFor(() => expect(result.current.progress?.phase).toBe("preparing"));
      expect(result.current.progress).toEqual({
        phase: "preparing",
        step: 1,
        label: "Preparing documents",
      });
      const expected = [
        { phase: "analyzing", step: 2, label: "Analyzing contract" },
        { phase: "validating", step: 3, label: "Validating analysis" },
        { phase: "applying", step: 4, label: "Updating workspace" },
      ] as const;
      for (const next of expected) {
        current = activeState(next.phase);
        await tick(2_000);
        await waitFor(() => expect(result.current.progress).toEqual(next));
      }
    });

    it("keeps at most one workspace read outstanding", async () => {
      let resolve: ((value: AiWorkspaceStateDto) => void) | null = null;
      const h = harness({
        getWorkspaceState: vi.fn(
          () =>
            new Promise<AiWorkspaceStateDto>((r) => {
              resolve = r;
            }),
        ),
      });
      const { result } = mount(h);
      await tick(10_000);
      expect(h.spies.getWorkspaceState).toHaveBeenCalledTimes(1);
      await act(async () => {
        resolve!(activeState());
      });
      expect(result.current.active).toBe(true);
    });

    it("stops polling once the run is terminal, and on unmount", async () => {
      let current = activeState();
      const h = harness({ getWorkspaceState: vi.fn(async () => current) });
      const { result, unmount } = mount(h);
      await waitFor(() => expect(result.current.active).toBe(true));
      current = succeededState();
      await tick(2_000);
      await waitFor(() => expect(result.current.active).toBe(false));
      const after = h.spies.getWorkspaceState.mock.calls.length;
      await tick(10_000);
      expect(h.spies.getWorkspaceState.mock.calls.length).toBe(after);
      unmount();
      await tick(10_000);
      expect(h.spies.getWorkspaceState.mock.calls.length).toBe(after);
    });
  });

  describe("scope races", () => {
    it("ignores a slow response from the previous analysis", async () => {
      const pending: ((value: AiWorkspaceStateDto) => void)[] = [];
      const h = harness({
        getWorkspaceState: vi.fn(() => new Promise<AiWorkspaceStateDto>((r) => pending.push(r))),
      });
      const view = mount(h);
      view.rerender({ scopeKey: "contract:rev-2", revisionId: "rev-2" });
      await act(async () => {
        // The first analysis answers last, and with a completely different state.
        pending[1]!(state({ hasAnalysis: false, reviewIssueCount: 0 }));
        pending[0]!(state({ hasAnalysis: true, reviewIssueCount: 9 }));
      });
      expect(view.result.current.workspace?.reviewIssueCount).toBe(0);
      expect(view.result.current.analyzeMode).toBe("analyze");
    });

    it("moves from a guest workspace to the saved revision without reusing guest state", async () => {
      const h = harness({
        getWorkspaceState: vi.fn(async (input: { revisionId: string | null }) =>
          input.revisionId === null ? activeState() : state({ hasAnalysis: true }),
        ),
      });
      const view = mount(h, "guest", null);
      await waitFor(() => expect(view.result.current.active).toBe(true));
      view.rerender({ scopeKey: "contract:rev-9", revisionId: "rev-9" });
      await waitFor(() => expect(view.result.current.workspace?.hasAnalysis).toBe(true));
      expect(view.result.current.active).toBe(false);
      expect(h.spies.executeAnalysis).not.toHaveBeenCalled();
      expect(JSON.stringify(view.result.current.workspace)).not.toContain("token");
    });

    it("never lets an older poll overwrite a newer action result", async () => {
      let resolvePoll: ((value: AiWorkspaceStateDto) => void) | null = null;
      let first = true;
      const h = harness({
        getWorkspaceState: vi.fn(() => {
          if (first) {
            first = false;
            return Promise.resolve(state({ reviewIssueCount: 3 }));
          }
          return new Promise<AiWorkspaceStateDto>((r) => {
            resolvePoll = r;
          });
        }),
        affirmReviewItem: vi.fn(async () => state({ reviewIssueCount: 1 })),
      });
      const { result } = mount(h);
      await waitFor(() => expect(result.current.workspace?.reviewIssueCount).toBe(3));
      await act(async () => {
        void result.current.refresh();
      });
      await act(async () => {
        await result.current.affirmReviewItem({
          reviewItemId: "r1",
          expectedReviewFingerprint: "rfp-1",
        });
      });
      expect(result.current.workspace?.reviewIssueCount).toBe(1);
      await act(async () => {
        resolvePoll!(state({ reviewIssueCount: 3 }));
      });
      expect(result.current.workspace?.reviewIssueCount).toBe(1);
    });

    // A deliberate action belongs to the scope that started it. It may finish
    // starting its own run, but it may never touch the workspace the user has
    // since moved to.
    it("keeps a deliberate action bound to the analysis that started it", async () => {
      const releases: ((value: unknown) => void)[] = [];
      const h = harness({
        getWorkspaceState: vi.fn(async (input: { revisionId: string | null }) =>
          state({ reviewIssueCount: input.revisionId === "rev-a" ? 7 : 2 }),
        ),
        requestAnalysis: vi.fn(
          () =>
            new Promise((resolve) => {
              releases.push(resolve);
            }),
        ),
      });
      const view = mount(h, "contract:rev-a", "rev-a");
      await waitFor(() => expect(view.result.current.workspace?.reviewIssueCount).toBe(7));

      let analyzing: Promise<void> | null = null;
      await act(async () => {
        analyzing = view.result.current.analyze();
        await Promise.resolve();
      });

      view.rerender({ scopeKey: "contract:rev-b", revisionId: "rev-b" });
      await waitFor(() => expect(view.result.current.workspace?.reviewIssueCount).toBe(2));

      // The new workspace can start its own deliberate action while the old
      // scope's request is still unresolved.
      await act(async () => {
        void view.result.current.analyze();
        await Promise.resolve();
      });
      expect(h.spies.requestAnalysis).toHaveBeenCalledTimes(2);
      expect(h.spies.requestAnalysis.mock.calls[1]![0]).toEqual({ revisionId: "rev-b" });

      await act(async () => {
        releases[0]!({
          ...activeState(),
          executionDisposition: "start_execution" as const,
        });
        await analyzing;
      });

      // The old run is executed against its own analysis, never the new one.
      expect(h.spies.executeAnalysis).toHaveBeenCalledWith({ runId: RUN, revisionId: "rev-a" });
      expect(h.spies.executeAnalysis.mock.calls.every((c) => c[0].revisionId !== "rev-b")).toBe(
        true,
      );
      // And it never lands on the workspace the user is now looking at.
      expect(view.result.current.workspace?.reviewIssueCount).toBe(2);
      expect(view.result.current.actionState).not.toBe("executing");
    });

    // The read gate is owned by the read that set it: an abandoned read's
    // cleanup must not free the new scope's gate.
    it("does not let an abandoned read free the new analysis's read gate", async () => {
      const pending: ((value: AiWorkspaceStateDto) => void)[] = [];
      const h = harness({
        getWorkspaceState: vi.fn(() => new Promise<AiWorkspaceStateDto>((r) => pending.push(r))),
      });
      const view = mount(h, "contract:rev-a", "rev-a");
      view.rerender({ scopeKey: "contract:rev-b", revisionId: "rev-b" });
      expect(h.spies.getWorkspaceState).toHaveBeenCalledTimes(2);

      // The abandoned first read answers while the new scope's read is open.
      await act(async () => {
        pending[0]!(state({ reviewIssueCount: 9 }));
      });
      await act(async () => {
        void view.result.current.refresh();
      });
      expect(h.spies.getWorkspaceState).toHaveBeenCalledTimes(2);
      expect(view.result.current.workspace).toBeNull();

      await act(async () => {
        pending[1]!(state({ reviewIssueCount: 2 }));
      });
      expect(view.result.current.workspace?.reviewIssueCount).toBe(2);
      await act(async () => {
        void view.result.current.refresh();
      });
      expect(h.spies.getWorkspaceState).toHaveBeenCalledTimes(3);
    });
  });

  describe("the deliberate analyze action", () => {
    it("flushes autosave first, requests once and executes once", async () => {
      const h = harness();
      const { result } = mount(h);
      await waitFor(() => expect(result.current.loadState).toBe("ready"));
      await act(async () => {
        await result.current.analyze();
      });
      expect(h.calls.slice(0, 3)).toEqual(["read", "flush", "request"]);
      expect(h.spies.requestAnalysis).toHaveBeenCalledTimes(1);
      expect(h.spies.executeAnalysis).toHaveBeenCalledTimes(1);
      expect(h.spies.executeAnalysis).toHaveBeenCalledWith({ runId: RUN, revisionId: "rev-1" });
      expect(result.current.active).toBe(true);
    });

    it("treats a rapid double click as one analysis", async () => {
      const h = harness();
      const { result } = mount(h);
      await waitFor(() => expect(result.current.loadState).toBe("ready"));
      await act(async () => {
        await Promise.all([result.current.analyze(), result.current.analyze()]);
      });
      expect(h.spies.requestAnalysis).toHaveBeenCalledTimes(1);
      expect(h.spies.executeAnalysis).toHaveBeenCalledTimes(1);
    });

    it("rejoins an already-active run instead of executing a second time", async () => {
      let current: AiWorkspaceStateDto = state();
      const h = harness({
        getWorkspaceState: vi.fn(async () => current),
        requestAnalysis: vi.fn(async () => {
          current = activeState("analyzing");
          return { ...activeState("analyzing"), executionDisposition: "reconnect" as const };
        }),
      });
      const { result } = mount(h);
      await waitFor(() => expect(result.current.loadState).toBe("ready"));
      await act(async () => {
        await result.current.analyze();
      });
      expect(h.spies.executeAnalysis).not.toHaveBeenCalled();
      expect(result.current.active).toBe(true);
    });

    it("starts polling immediately without waiting for execution to finish", async () => {
      let finishExecution: (() => void) | null = null;
      const h = harness({
        executeAnalysis: vi.fn(
          () =>
            new Promise<void>((r) => {
              finishExecution = () => r();
            }),
        ),
        getWorkspaceState: vi.fn(async () => activeState("analyzing")),
      });
      const { result } = mount(h);
      await waitFor(() => expect(result.current.loadState).toBe("ready"));
      const before = h.spies.getWorkspaceState.mock.calls.length;
      await act(async () => {
        await result.current.analyze();
      });
      await tick(4_000);
      expect(h.spies.getWorkspaceState.mock.calls.length).toBeGreaterThan(before);
      expect(result.current.progress?.phase).toBe("analyzing");
      await act(async () => {
        finishExecution!();
      });
    });

    it("re-analyzes through the same path once an analysis exists", async () => {
      const h = harness({ getWorkspaceState: vi.fn(async () => succeededState()) });
      const { result } = mount(h);
      await waitFor(() => expect(result.current.analyzeMode).toBe("reanalyze"));
      await act(async () => {
        await result.current.analyze();
      });
      expect(h.spies.requestAnalysis).toHaveBeenCalledTimes(1);
      expect(h.spies.executeAnalysis).toHaveBeenCalledTimes(1);
    });

    it("does not start an analysis when the pending save fails", async () => {
      const h = harness({ flushAutosave: vi.fn(async () => ({ ok: false })) });
      const { result } = mount(h);
      await waitFor(() => expect(result.current.loadState).toBe("ready"));
      await act(async () => {
        await result.current.analyze();
      });
      expect(h.spies.requestAnalysis).not.toHaveBeenCalled();
      expect(h.spies.executeAnalysis).not.toHaveBeenCalled();
      expect(result.current.message).toBe(AI_ANALYSIS_NOT_STARTED_UNSAVED);
    });

    it("does not start an analysis, or contact the provider, with no allowance left", async () => {
      const h = harness({
        getWorkspaceState: vi.fn(async () =>
          state({
            allowance: { scope: "authenticated", limit: 10, used: 10, remaining: 0, resetAt: null },
          }),
        ),
      });
      const { result } = mount(h);
      await waitFor(() => expect(result.current.loadState).toBe("ready"));
      await act(async () => {
        await result.current.analyze();
      });
      expect(h.spies.requestAnalysis).not.toHaveBeenCalled();
      expect(h.spies.executeAnalysis).not.toHaveBeenCalled();
      expect(result.current.message).toBe(AI_ANALYSIS_NOT_STARTED_NO_ALLOWANCE);
      expect(result.current.workspace?.allowance.remaining).toBe(0);
    });
  });

  describe("terminal outcomes", () => {
    it("reloads the authoritative canonical analysis exactly once after success", async () => {
      let current: AiWorkspaceStateDto = activeState("applying");
      const h = harness({ getWorkspaceState: vi.fn(async () => current) });
      const { result } = mount(h);
      await waitFor(() => expect(result.current.active).toBe(true));
      current = succeededState();
      await tick(2_000);
      await waitFor(() => expect(result.current.workspace?.hasAnalysis).toBe(true));
      await tick(6_000);
      expect(h.spies.reloadCanonicalAnalysis).toHaveBeenCalledTimes(1);
      expect(result.current.workspace?.lastSuccessfulRunId).toBe(RUN);
      expect(result.current.workspace?.allowance.used).toBe(1);
      expect(result.current.active).toBe(false);
    });

    it("exposes the deterministic failure and never retries by itself", async () => {
      let current: AiWorkspaceStateDto = activeState("analyzing");
      const h = harness({
        getWorkspaceState: vi.fn(async () => current),
        executeAnalysis: vi.fn(async () => {
          throw new Error("service_role failed: SQLSTATE 40001 gpt-5.6-terra prompt-v4");
        }),
      });
      const { result } = mount(h);
      await waitFor(() => expect(result.current.loadState).toBe("ready"));
      await act(async () => {
        await result.current.analyze();
      });
      current = failedState();
      await tick(4_000);
      await waitFor(() => expect(result.current.workspace?.failure).not.toBeNull());
      expect(result.current.workspace?.failure?.headline).toBe("AI analysis did not run");
      expect(result.current.message ?? "").not.toContain("SQLSTATE");
      expect(result.current.message ?? "").not.toContain("gpt-5.6-terra");
      expect(h.spies.requestAnalysis).toHaveBeenCalledTimes(1);
      expect(h.spies.executeAnalysis).toHaveBeenCalledTimes(1);
      expect(h.spies.reloadCanonicalAnalysis).not.toHaveBeenCalled();
    });

    it("keeps the accountant's saved work after a workspace-conflict failure", async () => {
      let current: AiWorkspaceStateDto = activeState("applying");
      const h = harness({ getWorkspaceState: vi.fn(async () => current) });
      const { result } = mount(h);
      await waitFor(() => expect(result.current.active).toBe(true));
      current = state({
        activeRun: null,
        latestRun: { ...run(RUN, "failed"), completedAt: "2026-01-01T00:00:00.000Z" },
        failure: {
          category: "workspace_conflict",
          headline: "AI analysis was not applied",
          whatHappened: "The analysis changed while the AI was working.",
          impact: "Your saved work was kept exactly as it is.",
          whatYouCanDo: "Run the analysis again when you are ready.",
          allowance: "This attempt used one analysis.",
        },
      });
      await tick(2_000);
      await waitFor(() =>
        expect(result.current.workspace?.failure?.category).toBe("workspace_conflict"),
      );
      expect(h.spies.reloadCanonicalAnalysis).not.toHaveBeenCalled();
      expect(h.spies.requestAnalysis).not.toHaveBeenCalled();
      expect(h.spies.executeAnalysis).not.toHaveBeenCalled();
    });
  });

  describe("action locks", () => {
    it("locks AI actions during a run and never locks canonical editing", async () => {
      const h = harness({ getWorkspaceState: vi.fn(async () => activeState()) });
      const { result } = mount(h);
      await waitFor(() => expect(result.current.active).toBe(true));
      expect(result.current.locks).toEqual({
        analyze: true,
        reviewActions: true,
        sourceDocuments: true,
        finalize: true,
      });
      // Review actions are refused client-side while the run is active.
      await act(async () => {
        await result.current.affirmReviewItem({
          reviewItemId: "r1",
          expectedReviewFingerprint: "rfp-1",
        });
      });
      expect(h.spies.affirmReviewItem).not.toHaveBeenCalled();
    });

    it("releases the locks again once the run is terminal", async () => {
      let current: AiWorkspaceStateDto = activeState();
      const h = harness({ getWorkspaceState: vi.fn(async () => current) });
      const { result } = mount(h);
      await waitFor(() => expect(result.current.locks.analyze).toBe(true));
      current = succeededState();
      await tick(2_000);
      await waitFor(() => expect(result.current.locks.analyze).toBe(false));
      expect(result.current.locks.finalize).toBe(false);
    });
  });

  describe("review actions", () => {
    it("adopts the authoritative state an accepted affirmation returns", async () => {
      const h = harness({
        affirmReviewItem: vi.fn(async () => state({ reviewIssueCount: 2, hasAnalysis: true })),
      });
      const { result } = mount(h);
      await waitFor(() => expect(result.current.loadState).toBe("ready"));
      await act(async () => {
        await result.current.affirmReviewItem({
          reviewItemId: "r1",
          expectedReviewFingerprint: "rfp-1",
          method: "individual",
        });
      });
      expect(h.spies.affirmReviewItem).toHaveBeenCalledWith({
        revisionId: "rev-1",
        reviewItemId: "r1",
        expectedReviewFingerprint: "rfp-1",
        method: "individual",
      });
      expect(result.current.workspace?.reviewIssueCount).toBe(2);
    });

    it("adopts the authoritative state an accepted red resolution returns", async () => {
      const h = harness({
        resolveReviewIssue: vi.fn(async () => state({ reviewIssueCount: 0, hasAnalysis: true })),
      });
      const { result } = mount(h);
      await waitFor(() => expect(result.current.loadState).toBe("ready"));
      await act(async () => {
        await result.current.resolveReviewIssue({
          reviewItemId: "r2",
          expectedReviewFingerprint: "rfp-2",
          reason: "reviewed_and_accepted",
          note: "Checked against the contract.",
        });
      });
      expect(result.current.workspace?.reviewIssueCount).toBe(0);
    });

    it("acknowledges stale sources against the fingerprint the server returned", async () => {
      const h = harness({
        getWorkspaceState: vi.fn(async () =>
          state({ sourceState: "stale", sourceSetFingerprint: "fp-new" }),
        ),
      });
      const { result } = mount(h);
      await waitFor(() => expect(result.current.workspace?.sourceState).toBe("stale"));
      await act(async () => {
        await result.current.acknowledgeStaleSources();
      });
      expect(h.spies.acknowledgeStaleSources).toHaveBeenCalledWith({
        revisionId: "rev-1",
        expectedSourceSetFingerprint: "fp-new",
      });
      expect(result.current.workspace?.staleSourceAcknowledged).toBe(true);
    });

    it("re-reads rather than merging when a review action conflicts", async () => {
      const h = harness({
        affirmReviewItem: vi.fn(async () => {
          throw new Error("service_role failed: SQLSTATE 40001 relation ai_review_events");
        }),
      });
      const { result } = mount(h);
      await waitFor(() => expect(result.current.loadState).toBe("ready"));
      const before = h.spies.getWorkspaceState.mock.calls.length;
      await act(async () => {
        await result.current.affirmReviewItem({
          reviewItemId: "r1",
          expectedReviewFingerprint: "rfp-stale",
        });
      });
      expect(h.spies.getWorkspaceState.mock.calls.length).toBe(before + 1);
      expect(result.current.message).toBe(AI_CONTROLLER_UNAVAILABLE);
      expect(result.current.message).not.toContain("SQLSTATE");
    });
  });

  describe("the guest workspace", () => {
    it("reads and reconnects without any credential reaching the browser", async () => {
      const h = harness({ getWorkspaceState: vi.fn(async () => activeState("validating")) });
      const { result } = mount(h, "guest", null);
      await waitFor(() => expect(result.current.active).toBe(true));
      expect(h.spies.getWorkspaceState).toHaveBeenCalledWith({ revisionId: null });
      expect(result.current.progress?.label).toBe("Validating analysis");
      const serialized = JSON.stringify(result.current.workspace);
      expect(serialized).not.toContain("hash");
      expect(serialized).not.toContain("token");
    });
  });

  describe("no automatic analysis", () => {
    it("never requests or executes from a read, a poll, a refresh or a review action", async () => {
      const h = harness({ getWorkspaceState: vi.fn(async () => activeState()) });
      const { result, rerender, unmount } = mount(h);
      await waitFor(() => expect(result.current.active).toBe(true));
      await tick(10_000);
      await act(async () => {
        await result.current.refresh();
      });
      rerender({ scopeKey: "contract:rev-1", revisionId: "rev-1" });
      await tick(4_000);
      unmount();
      expect(h.spies.requestAnalysis).not.toHaveBeenCalled();
      expect(h.spies.executeAnalysis).not.toHaveBeenCalled();
    });
  });
});
