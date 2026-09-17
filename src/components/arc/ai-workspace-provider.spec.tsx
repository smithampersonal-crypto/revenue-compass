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
import { AiAnalysisAction } from "./AiAnalysisAction";
import type { AiWorkspaceStateDto } from "@/lib/arc/ai/workspace.handlers";

// Explicitly typed, so a fixture can never invent a state the server DTO
// cannot actually produce.
const idle: AiWorkspaceStateDto = {
  hasAnalysis: false,
  activeRun: null,
  latestRun: null,
  lastSuccessfulRunId: null,
  sourceState: "none",
  hasIncludedSources: true,
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

const active: AiWorkspaceStateDto = {
  ...idle,
  activeRun: {
    runId: "run-1",
    phase: "analyzing",
    active: true,
    sourceCount: 1,
    pageCount: 4,
    reviewIssueCount: 0,
    completedAt: null,
  },
};

const succeeded: AiWorkspaceStateDto = {
  ...idle,
  hasAnalysis: true,
  lastSuccessfulRunId: "run-1",
  latestRun: { ...active.activeRun!, phase: "succeeded", active: false },
};

/** The same authoritative state with no contract PDF included. */
const idleWithoutSources: AiWorkspaceStateDto = { ...idle, hasIncludedSources: false };

const server = vi.hoisted(() => ({
  current: null as AiWorkspaceStateDto | null,
  addSources: 0,
  reads: 0,
  executes: 0,
  requests: 0,
}));

vi.mock("@/lib/arc/ai/workspace.functions", () => ({
  getAiWorkspaceState: async () => {
    server.reads += 1;
    return server.current;
  },
  requestAiAnalysis: async () => {
    server.requests += 1;
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
const savePending = vi.hoisted(() => ({
  release: null as null | (() => void),
  hold: false,
  waiters: [] as (() => void)[],
  /** Drafts the server actually accepted, newest last. */
  accepted: [] as string[],
  /** Rejects the next save with the given text. */
  rejectWith: null as string | null,
}));

const guestSave = vi.hoisted(() =>
  vi.fn(
    async (input: {
      data: { expectedLockVersion: number; draft: { transactionPriceNotes?: string } };
    }) => {
      const expected = input?.data?.expectedLockVersion ?? 1;
      const notes = input?.data?.draft?.transactionPriceNotes ?? "";
      if (savePending.hold) {
        await new Promise<void>((resolve) => {
          savePending.waiters.push(resolve);
        });
      }
      if (savePending.release !== null) {
        await new Promise<void>((resolve) => {
          savePending.release = resolve;
        });
      }
      if (savePending.rejectWith !== null) {
        const message = savePending.rejectWith;
        savePending.rejectWith = null;
        throw new Error(message);
      }
      savePending.accepted.push(notes);
      return { ok: true as const, lockVersion: expected + 1, savedAt: new Date().toISOString() };
    },
  ),
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
      <button
        type="button"
        onClick={() => setDraft((current) => ({ ...current, transactionPriceNotes: "" }))}
      >
        Revert
      </button>
    </div>
  );
}

function Task6Probe() {
  const { ai, draft, setDraft } = useAnalysis();
  return (
    <div>
      <AiAnalysisAction
        ai={ai}
        onAddSources={() => {
          server.addSources += 1;
        }}
      />
      <label>
        Accounting note
        <input
          value={draft.transactionPriceNotes}
          onChange={(event) =>
            setDraft((current) => ({ ...current, transactionPriceNotes: event.target.value }))
          }
        />
      </label>
      <button type="button" onClick={() => void ai.refresh()}>
        Refresh test status
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

function renderTask6Provider() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AnalysisProvider sample={undefined} guest>
        <Task6Probe />
      </AnalysisProvider>
    </QueryClientProvider>,
  );
}

function releaseHeldSaves() {
  const waiters = savePending.waiters.splice(0, savePending.waiters.length);
  for (const resolve of waiters) resolve();
}

beforeEach(() => {
  server.current = idle;
  server.reads = 0;
  server.executes = 0;
  server.requests = 0;
  server.addSources = 0;
  guestServer.lockVersion = 1;
  guestServer.notes = "";
  savePending.release = null;
  savePending.hold = false;
  savePending.waiters = [];
  savePending.accepted = [];
  savePending.rejectWith = null;
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

  // A deliberate analysis may only cross the AI boundary once the server holds
  // the current canonical draft — however slow the save is.
  it("waits for a slow in-flight save before requesting an analysis", async () => {
    const user = userEvent.setup();
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("load")).toHaveTextContent("ready"));

    savePending.hold = true;
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await waitFor(() => expect(guestSave).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: "Analyze" }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    expect(server.requests).toBe(0);
    expect(server.executes).toBe(0);

    savePending.hold = false;
    await act(async () => {
      releaseHeldSaves();
      await new Promise((resolve) => setTimeout(resolve, 200));
    });

    await waitFor(() => expect(server.requests).toBe(1));
    expect(server.executes).toBe(1);
  });

  // The key regression: the draft is reverted to the old baseline while the
  // newer save is still unresolved, so equality with the stale snapshot must
  // not be read as "the server holds this".
  it("waits out a reverted draft whose newer save is still unresolved", async () => {
    const user = userEvent.setup();
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("load")).toHaveTextContent("ready"));

    savePending.hold = true;
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await waitFor(() => expect(guestSave).toHaveBeenCalledTimes(1));

    // Back to the copy the server already holds, while the edit's save is
    // still in flight.
    await user.click(screen.getByRole("button", { name: "Revert" }));
    await user.click(screen.getByRole("button", { name: "Analyze" }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    expect(server.requests).toBe(0);

    savePending.hold = false;
    await act(async () => {
      releaseHeldSaves();
      await new Promise((resolve) => setTimeout(resolve, 300));
    });

    // The edit settled, then the compensating save put the reverted copy back
    // on the server, and only then did the analysis begin.
    await waitFor(() => expect(server.requests).toBe(1));
    expect(savePending.accepted).toEqual(["Edited ", ""]);
    expect(screen.getByTestId("lock")).toHaveTextContent("3");
  });

  // Twin of the stale-success regression: a stale rejection must not present
  // an error against the workspace the AI result has already replaced.
  it("discards a stale save rejection after the AI-applied draft is adopted", async () => {
    const user = userEvent.setup();
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("load")).toHaveTextContent("ready"));

    await user.click(screen.getByRole("button", { name: "Analyze" }));
    await waitFor(() => expect(server.executes).toBe(1));

    savePending.hold = true;
    savePending.rejectWith = "service_role failed: SQLSTATE 40001 gpt-5.6-terra";
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await waitFor(() => expect(guestSave).toHaveBeenCalledTimes(1));

    guestServer.notes = "AI applied";
    guestServer.lockVersion = 7;
    server.current = succeeded;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2_100));
    });
    await waitFor(() => expect(screen.getByTestId("customer")).toHaveTextContent("AI applied"));

    savePending.hold = false;
    await act(async () => {
      releaseHeldSaves();
      await new Promise((resolve) => setTimeout(resolve, 300));
    });

    expect(screen.getByTestId("save-status")).not.toHaveTextContent("error");
    expect(screen.getByTestId("customer")).toHaveTextContent("AI applied");
    expect(screen.getByTestId("lock")).toHaveTextContent("7");
  });

  it("still reports an ordinary save failure for the current workspace", async () => {
    const user = userEvent.setup();
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("load")).toHaveTextContent("ready"));

    savePending.rejectWith = "network down";
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await waitFor(() => expect(screen.getByTestId("save-status")).toHaveTextContent("error"));

    // Editing again retries through the ordinary pipeline.
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await waitFor(() => expect(screen.getByTestId("save-status")).toHaveTextContent("saved"));
  });

  // Cross-generation ownership: a pre-AI request that is still physically in
  // flight must not own the newly adopted workspace's autosave slot, or a
  // valid post-AI edit would never be saved at all.
  for (const variant of ["settles successfully", "rejects"] as const) {
    it(`saves a post-AI edit while the stale pre-AI save still ${variant}`, async () => {
      const user = userEvent.setup();
      renderProvider();
      await waitFor(() => expect(screen.getByTestId("load")).toHaveTextContent("ready"));

      await user.click(screen.getByRole("button", { name: "Analyze" }));
      await waitFor(() => expect(server.executes).toBe(1));

      // A pre-AI save begins and is held indefinitely.
      savePending.hold = true;
      await user.click(screen.getByRole("button", { name: "Edit" }));
      await waitFor(() => expect(guestSave).toHaveBeenCalledTimes(1));

      // The run succeeds and the applied canonical draft is adopted.
      guestServer.notes = "AI applied";
      guestServer.lockVersion = 7;
      server.current = succeeded;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 2_100));
      });
      await waitFor(() => expect(screen.getByTestId("customer")).toHaveTextContent("AI applied"));
      expect(screen.getByTestId("lock")).toHaveTextContent("7");

      // The stale request is still unresolved. New saves must not be held.
      savePending.hold = false;
      await user.click(screen.getByRole("button", { name: "Edit" }));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1_500));
      });

      // A current-generation save was issued against the adopted lock.
      await waitFor(() => expect(guestSave).toHaveBeenCalledTimes(2));
      expect(guestSave.mock.calls[1]?.[0]?.data.expectedLockVersion).toBe(7);
      await waitFor(() => expect(screen.getByTestId("lock")).toHaveTextContent("8"));
      expect(screen.getByTestId("customer")).toHaveTextContent("Edited AI applied");
      expect(screen.getByTestId("save-status")).toHaveTextContent("saved");

      // Only now does the superseded request settle. It changes nothing.
      if (variant === "rejects") savePending.rejectWith = "SQLSTATE 40001 service_role";
      await act(async () => {
        releaseHeldSaves();
        await new Promise((resolve) => setTimeout(resolve, 500));
      });

      expect(screen.getByTestId("customer")).toHaveTextContent("Edited AI applied");
      expect(screen.getByTestId("lock")).toHaveTextContent("8");
      expect(screen.getByTestId("save-status")).toHaveTextContent("saved");
      expect(guestSave).toHaveBeenCalledTimes(2);
    });
  }
});

describe("Task 6 production presentation through the real provider", () => {
  it("follows a deliberate run through all four phases and authoritative success", async () => {
    const user = userEvent.setup();
    server.current = idle;
    renderTask6Provider();

    await user.click(await screen.findByRole("button", { name: "Analyze Contract" }));
    await waitFor(() => expect(server.requests).toBe(1));
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "AI analysis progress" })).toHaveTextContent(
        "Analyzing contract",
      ),
    );

    for (const [phase, label] of [
      ["preparing", "Preparing documents"],
      ["analyzing", "Analyzing contract"],
      ["validating", "Validating analysis"],
      ["applying", "Updating workspace"],
    ] as const) {
      server.current = {
        ...active,
        activeRun: { ...active.activeRun!, phase },
      };
      await user.click(screen.getByRole("button", { name: "Refresh test status" }));
      await waitFor(() =>
        expect(screen.getByRole("status", { name: "AI analysis progress" })).toHaveTextContent(
          label,
        ),
      );
    }

    server.current = succeeded;
    await user.click(screen.getByRole("button", { name: "Refresh test status" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("status", { name: "AI analysis progress" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Re-analyze Contract" })).toBeEnabled();
    expect(server.requests).toBe(1);
    expect(server.executes).toBe(1);
  });

  it("renders a reconnected active run immediately without executing and keeps accounting editable", async () => {
    const user = userEvent.setup();
    server.current = {
      ...active,
      activeRun: { ...active.activeRun!, phase: "validating" },
    };
    renderTask6Provider();

    expect(await screen.findByRole("status", { name: "AI analysis progress" })).toHaveTextContent(
      "Validating analysis",
    );
    expect(screen.getByRole("button", { name: "Validating analysis…" })).toBeDisabled();
    const note = screen.getByRole("textbox", { name: "Accounting note" });
    await user.type(note, "Still editable");
    expect(note).toHaveValue("Still editable");
    expect(server.requests).toBe(0);
    expect(server.executes).toBe(0);
  });
});

/**
 * Phase 9G — Task 6 source prerequisite, end to end through the real provider:
 * uploading or removing a contract never runs AI by itself, and the deliberate
 * Analyze click follows the authoritative source-presence fact.
 */
describe("Task 6 source prerequisite through the real provider", () => {
  it("routes to the upload experience, then analyzes only on the next deliberate click", async () => {
    const user = userEvent.setup();
    server.current = idleWithoutSources;
    renderTask6Provider();

    // No contract yet: the click opens the existing upload experience.
    await user.click(await screen.findByRole("button", { name: "Analyze Contract" }));
    expect(server.addSources).toBe(1);
    expect(server.requests).toBe(0);
    expect(server.executes).toBe(0);

    // The accountant uploads and includes a PDF. Nothing runs from that alone.
    server.current = idle;
    await user.click(screen.getByRole("button", { name: "Refresh test status" }));
    await waitFor(() => expect(server.requests).toBe(0));
    expect(server.executes).toBe(0);

    // Only the next deliberate click starts the analysis.
    await user.click(screen.getByRole("button", { name: "Analyze Contract" }));
    await waitFor(() => expect(server.requests).toBe(1));
    await waitFor(() => expect(server.executes).toBe(1));
    expect(server.addSources).toBe(1);
  });

  it("routes back to the upload experience once the last source is removed", async () => {
    const user = userEvent.setup();
    server.current = idle;
    renderTask6Provider();
    await screen.findByRole("button", { name: "Analyze Contract" });

    server.current = idleWithoutSources;
    await user.click(screen.getByRole("button", { name: "Refresh test status" }));
    await waitFor(() =>
      expect(screen.getByText(/No contract PDF is included yet/)).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "Analyze Contract" }));
    expect(server.addSources).toBe(1);
    expect(server.requests).toBe(0);
    expect(server.executes).toBe(0);
  });
});
