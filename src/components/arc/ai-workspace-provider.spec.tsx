// @vitest-environment jsdom
/**
 * Phase 9G — Task 5. Provider-level integration: the analysis workspace owns
 * exactly one AI controller, it reads the safe Task 3 state for the analysis
 * that is open, and a successful run reloads the server-applied canonical
 * draft instead of letting a stale in-memory draft be autosaved over it.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AnalysisProvider, useAnalysis } from "./analysis-context";

const idle = {
  hasAnalysis: false,
  activeRun: null,
  latestRun: null,
  lastSuccessfulRunId: null,
  sourceState: "none" as const,
  sourceSetFingerprint: null,
  reviewIssueCount: 0,
  staleSourceAcknowledged: false,
  allowance: {
    scope: "guest" as const,
    limit: 3,
    used: 0,
    remaining: 3,
    resetAt: null,
  },
  failure: null,
};

const active = {
  ...idle,
  activeRun: {
    runId: "run-1",
    phase: "analyzing" as const,
    active: true,
    sourceCount: 1,
    pageCount: 4,
    reviewIssueCount: 0,
    completedAt: null,
  },
};

const succeeded = {
  ...idle,
  hasAnalysis: true,
  lastSuccessfulRunId: "run-1",
  latestRun: { ...active.activeRun, phase: "succeeded" as const, active: false },
};

const server = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
  reads: 0,
  executes: 0,
}));

vi.mock("@/lib/arc/ai/workspace.functions", () => ({
  getAiWorkspaceState: async () => {
    server.reads += 1;
    return server.current;
  },
  requestAiAnalysis: async () => {
    server.current = active;
    return { ...active, executionDisposition: "start_execution" as const };
  },
  affirmAiReviewItem: async () => idle,
  resolveAiReviewIssue: async () => idle,
  acknowledgeAiStaleSources: async () => idle,
}));

vi.mock("@/lib/arc/ai/runs.functions", () => ({
  executeAiAnalysis: async () => {
    server.executes += 1;
    return { ok: true };
  },
}));

/** The authoritative guest copy the server would return on a fresh load. */
const guestServer = vi.hoisted(() => ({ lockVersion: 1, notes: "" }));

/** Lets a queued save be held in flight, the way a slow network would. */
const savePending = vi.hoisted(() => ({ release: null as null | (() => void) }));

const guestSave = vi.hoisted(() =>
  vi.fn(async () => {
    if (savePending.release === null) {
      return { ok: true as const, lockVersion: 2, savedAt: new Date().toISOString() };
    }
    await new Promise<void>((resolve) => {
      savePending.release = resolve;
    });
    return { ok: true as const, lockVersion: 2, savedAt: new Date().toISOString() };
  }),
);

vi.mock("@/lib/arc/persistence/guest.functions", async () => {
  const { createEmptyDraft } = await import("@/lib/asc606-workflow");
  return {
    resumeGuestWorkspace: async () => ({
      kind: "guest" as const,
      draft: { ...createEmptyDraft(), transactionPriceNotes: guestServer.notes },
      lockVersion: guestServer.lockVersion,
      expiresAt: new Date(Date.now() + 9 * 3_600_000).toISOString(),
      schemaVersion: "arc.workflow.v1",
      resumed: false,
    }),
    saveGuestDraft: guestSave,
    migrateGuestWorkspace: async () => ({
      ok: false as const,
      code: "failed" as const,
      reason: "not available in tests",
    }),
  };
});

function Probe() {
  const { ai, setDraft, draft, persistence } = useAnalysis();
  return (
    <div>
      <span data-testid="load">{ai.loadState}</span>
      <span data-testid="mode">{ai.analyzeMode}</span>
      <span data-testid="phase">{ai.progress?.phase ?? "none"}</span>
      <span data-testid="analysis">{ai.workspace?.hasAnalysis ? "yes" : "no"}</span>
      <span data-testid="customer">{draft.transactionPriceNotes || "empty"}</span>
      <span data-testid="lock">{persistence.lockVersion ?? "none"}</span>
      <span data-testid="save-status">{persistence.status.kind}</span>
      <button type="button" onClick={() => persistence.reload()}>
        Reload
      </button>
      <button type="button" onClick={() => void ai.analyze()}>
        Analyze
      </button>
      <button
        type="button"
        onClick={() =>
          setDraft((current) => ({
            ...current,
            transactionPriceNotes: `Edited ${current.transactionPriceNotes}`,
          }))
        }
      >
        Edit
      </button>
    </div>
  );
}

function renderProvider() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AnalysisProvider sample={undefined} guest>
        <Probe />
      </AnalysisProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  server.current = idle;
  server.reads = 0;
  server.executes = 0;
  guestServer.lockVersion = 1;
  guestServer.notes = "";
  savePending.release = null;
  guestSave.mockClear();
});

describe("the analysis workspace AI controller", () => {
  it("loads the safe workspace state once and starts nothing on mount", async () => {
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("load")).toHaveTextContent("ready"));
    expect(screen.getByTestId("mode")).toHaveTextContent("analyze");
    expect(screen.getByTestId("phase")).toHaveTextContent("none");
    expect(server.executes).toBe(0);
    expect(server.reads).toBe(1);
  });

  it("saves the pending draft, runs once and adopts the server-applied analysis", async () => {
    const user = userEvent.setup();
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("load")).toHaveTextContent("ready"));

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Analyze" }));

    // The deliberate action flushes the accepted autosave path before asking
    // the server for a run, so AI never sees an unsaved canonical draft.
    await waitFor(() => expect(guestSave).toHaveBeenCalled());
    await waitFor(() => expect(server.executes).toBe(1));

    server.current = succeeded;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2_100));
    });

    await waitFor(() => expect(screen.getByTestId("analysis")).toHaveTextContent("yes"));
    expect(screen.getByTestId("phase")).toHaveTextContent("none");

    // The pre-AI draft in memory must never be written back over the applied
    // result: no further save is issued after the run succeeds.
    const savesAfterSuccess = guestSave.mock.calls.length;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_200));
    });
    expect(guestSave.mock.calls.length).toBe(savesAfterSuccess);
  });

  // The AI-success reload is a write barrier, not an ordinary reload: a queued
  // pre-AI save that settles afterwards must never be re-issued against the
  // draft the server has just applied.
  it("keeps autosave blocked from AI success until the applied draft is adopted", async () => {
    const user = userEvent.setup();
    savePending.release = () => undefined;
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("load")).toHaveTextContent("ready"));

    await user.click(screen.getByRole("button", { name: "Analyze" }));
    await waitFor(() => expect(server.executes).toBe(1));

    // The accountant keeps editing while the run is active: the queued save is
    // issued, but it is still in flight and has not become authoritative.
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await waitFor(() => expect(guestSave).toHaveBeenCalledTimes(1));
    const savesBeforeSuccess = guestSave.mock.calls.length;

    // The run succeeds; the server holds the applied canonical draft.
    guestServer.notes = "AI applied";
    guestServer.lockVersion = 5;
    server.current = succeeded;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2_100));
    });
    await waitFor(() => expect(screen.getByTestId("analysis")).toHaveTextContent("yes"));

    // Now the queued pre-AI save settles.
    await act(async () => {
      savePending.release?.();
      savePending.release = () => undefined;
      await new Promise((resolve) => setTimeout(resolve, 1_500));
    });

    expect(guestSave.mock.calls.length).toBe(savesBeforeSuccess);
    await waitFor(() => expect(screen.getByTestId("customer")).toHaveTextContent("AI applied"));
    expect(screen.getByTestId("lock")).toHaveTextContent("5");

    // Autosave resumes only against the adopted authoritative draft.
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await act(async () => {
      savePending.release?.();
      await new Promise((resolve) => setTimeout(resolve, 1_500));
    });
    expect(guestSave.mock.calls.length).toBe(savesBeforeSuccess + 1);
  });

  it("still clears a prior write block on an ordinary explicit reload", async () => {
    const user = userEvent.setup();
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("load")).toHaveTextContent("ready"));

    guestServer.notes = "Server copy";
    guestServer.lockVersion = 3;
    await user.click(screen.getByRole("button", { name: "Reload" }));
    await waitFor(() => expect(screen.getByTestId("customer")).toHaveTextContent("Server copy"));
    expect(screen.getByTestId("lock")).toHaveTextContent("3");

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await waitFor(() => expect(guestSave).toHaveBeenCalled());
  });
});
