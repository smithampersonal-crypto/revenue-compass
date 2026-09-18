// @vitest-environment jsdom
/**
 * Phase 9G — Task 8. Source-freshness lifecycle through the real provider,
 * the real Task 5 controller and the real Task 6 / Task 8 presentation.
 *
 * The authoritative server state is the only thing that ever changes what the
 * accountant sees: nothing here caches acknowledgment, infers freshness from a
 * fingerprint, or starts an analysis on its own.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AiWorkspaceStateDto } from "@/lib/arc/ai/workspace.handlers";

const FINGERPRINT = "source-set-fingerprint-abcdef";

const server = vi.hoisted(() => ({
  current: null as unknown as AiWorkspaceStateDto,
  reads: 0,
  requests: 0,
  executes: 0,
  acknowledgements: 0,
  /** Set to make the next requested run fail deterministically. */
  failNextRun: false,
}));

vi.mock("@/lib/arc/ai/workspace.functions", () => ({
  getAiWorkspaceState: async () => {
    server.reads += 1;
    return server.current;
  },
  requestAiAnalysis: async () => {
    server.requests += 1;
    server.current = {
      ...server.current,
      activeRun: {
        runId: `run-${server.requests + 1}`,
        phase: "analyzing",
        active: true,
        sourceCount: 1,
        pageCount: 3,
        reviewIssueCount: 0,
        completedAt: null,
      },
    };
    return { ...server.current, executionDisposition: "start_execution" as const };
  },
  affirmAiReviewItem: async () => server.current,
  resolveAiReviewIssue: async () => server.current,
  // The server owns acknowledgment entirely; the browser fingerprint is only a
  // precondition and is never trusted here.
  acknowledgeAiStaleSources: async () => {
    server.acknowledgements += 1;
    server.current = { ...server.current, staleSourceAcknowledged: true };
    return server.current;
  },
}));

vi.mock("@/lib/arc/ai/runs.functions", () => ({
  executeAiAnalysis: async () => {
    server.executes += 1;
    if (server.failNextRun) {
      server.failNextRun = false;
      server.current = {
        ...server.current,
        activeRun: null,
        failure: {
          category: "ai_service" as const,
          headline: "The AI analysis could not be completed.",
          whatHappened: "ARC could not finish reading the contract.",
          impact: "Your accounting work is unchanged.",
          whatYouCanDo: "Try the analysis again in a few minutes.",
          allowance: "This attempt did not use one of your analyses.",
        },
      } as AiWorkspaceStateDto;
      return { ok: false };
    }
    // A successful run applies a new canonical draft against the current set.
    server.current = {
      ...server.current,
      activeRun: null,
      hasAnalysis: true,
      sourceState: "current",
      staleSourceAcknowledged: false,
      failure: null,
    };
    return { ok: true };
  },
}));

vi.mock("@/lib/arc/persistence/guest.functions", async () => {
  const { createEmptyDraft } = await import("@/lib/asc606-workflow");
  return {
    resumeGuestWorkspace: async () => ({
      kind: "guest" as const,
      draft: createEmptyDraft(),
      lockVersion: 1,
      expiresAt: new Date(Date.now() + 9 * 3_600_000).toISOString(),
      schemaVersion: "arc.workflow.v1",
      resumed: false,
    }),
    saveGuestDraft: async () => ({
      ok: true as const,
      lockVersion: 2,
      savedAt: new Date().toISOString(),
    }),
    migrateGuestWorkspace: async () => ({
      ok: false as const,
      code: "failed" as const,
      reason: "not available in tests",
    }),
  };
});

const load = vi.fn();
vi.mock("@/lib/arc/persistence/revisions.functions", () => ({
  loadContractAnalysis: (args: unknown) => load(args),
  saveDraftRevision: async () => ({ ok: true, lockVersion: 4, savedAt: "2026-01-01" }),
  finalizeRevision: async () => ({ ok: true }),
  listRevisionHistory: async () => ({ revisions: [] }),
  startNewRevision: vi.fn(),
}));

const { AnalysisProvider, useAnalysis } = await import("./analysis-context");
const { AiAnalysisAction } = await import("./AiAnalysisAction");
const { AiSourceFreshnessNotice } = await import("./AiSourceFreshnessNotice");
const { createDemoDraftIfKnown } = await import("@/lib/demo-scenarios");

const CONTRACT_ID = "11111111-1111-4111-8111-111111111111";
const REVISION_ID = "22222222-2222-4222-8222-222222222222";

function state(overrides: Partial<AiWorkspaceStateDto> = {}): AiWorkspaceStateDto {
  return {
    hasAnalysis: true,
    activeRun: null,
    latestRun: null,
    lastSuccessfulRunId: "run-1",
    sourceState: "current",
    hasIncludedSources: true,
    sourceSetFingerprint: FINGERPRINT,
    reviewIssueCount: 0,
    reviewItems: [],
    reviewPayloadMalformed: false,
    fieldProvenance: {},
    objectProvenance: {},
    staleSourceAcknowledged: false,
    allowance: { scope: "authenticated", limit: 10, used: 1, remaining: 9, resetAt: null },
    failure: null,
    ...overrides,
  } as AiWorkspaceStateDto;
}

/**
 * Stands in for the accepted Task 6 source-mutation boundary: a successful
 * source change on the server, followed by the existing safe `ai.refresh()`.
 * The component never computes freshness itself.
 */
function Probe({ onSourcesChanged }: { onSourcesChanged: () => void }) {
  const { ai } = useAnalysis();
  return (
    <div>
      <AiAnalysisAction ai={ai} onAddSources={() => undefined} />
      <AiSourceFreshnessNotice ai={ai} />
      <span data-testid="allowance">
        {ai.workspace ? `${ai.workspace.allowance.used}/${ai.workspace.allowance.remaining}` : "—"}
      </span>
      <button
        type="button"
        onClick={() => {
          onSourcesChanged();
          void ai.refresh();
        }}
      >
        Simulate source mutation
      </button>
    </div>
  );
}

function renderWorkspace(kind: "saved" | "guest", onSourcesChanged: () => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      {kind === "saved" ? (
        <AnalysisProvider sample={undefined} contractId={CONTRACT_ID} revisionId={REVISION_ID}>
          <Probe onSourcesChanged={onSourcesChanged} />
        </AnalysisProvider>
      ) : (
        <AnalysisProvider sample={undefined} guest>
          <Probe onSourcesChanged={onSourcesChanged} />
        </AnalysisProvider>
      )}
    </QueryClientProvider>,
  );
}

const STALE_HEADLINE = "Source documents changed since the last AI analysis.";
const ACK_BUTTON = { name: "Acknowledge source changes" };

beforeEach(() => {
  server.current = state();
  server.reads = 0;
  server.requests = 0;
  server.executes = 0;
  server.acknowledgements = 0;
  server.failNextRun = false;
  load.mockReset().mockResolvedValue({
    contractId: CONTRACT_ID,
    contractTitle: "Saved contract",
    contractNumber: null,
    customerName: "A",
    analysisId: "33333333-3333-4333-8333-333333333333",
    revisionId: REVISION_ID,
    revisionNumber: 1,
    status: "draft",
    snapshot: null,
    lockVersion: 3,
    schemaVersion: "arc.workflow.v1",
    readOnly: false,
    draft: createDemoDraftIfKnown("horizon")!,
  });
});

describe("Task 8 — saved analysis source freshness", () => {
  it("warns after a source mutation, and never on its own", async () => {
    const user = userEvent.setup();
    renderWorkspace("saved", () => {
      server.current = state({ sourceState: "stale", staleSourceAcknowledged: false });
    });

    await screen.findByText("AI analysis matches the currently selected source documents.");
    expect(screen.queryByText(STALE_HEADLINE)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Simulate source mutation" }));
    expect(await screen.findByText(STALE_HEADLINE)).toBeInTheDocument();
    // Source mutation never starts AI.
    expect(server.requests).toBe(0);
    expect(server.executes).toBe(0);
  });

  it("acknowledges deliberately, without consuming allowance or starting AI", async () => {
    const user = userEvent.setup();
    server.current = state({ sourceState: "stale" });
    renderWorkspace("saved", () => undefined);

    await screen.findByText(STALE_HEADLINE);
    expect(screen.getByTestId("allowance")).toHaveTextContent("1/9");

    await user.click(screen.getByRole("button", ACK_BUTTON));
    expect(await screen.findByText("Source changes acknowledged.")).toBeInTheDocument();
    // Acknowledgment is an audit fact; the analysis is still stale.
    expect(screen.getByText(/still reflects an earlier source set/i)).toBeInTheDocument();
    expect(server.current.sourceState).toBe("stale");
    expect(screen.queryByRole("button", ACK_BUTTON)).toBeNull();
    expect(server.acknowledgements).toBe(1);
    expect(server.requests).toBe(0);
    expect(server.executes).toBe(0);
    expect(screen.getByTestId("allowance")).toHaveTextContent("1/9");
  });

  it("brings the warning back when the source set changes again after acknowledgment", async () => {
    const user = userEvent.setup();
    server.current = state({ sourceState: "stale" });
    renderWorkspace("saved", () => {
      // The server clears acknowledgment whenever the selection changes.
      server.current = state({ sourceState: "stale", staleSourceAcknowledged: false });
    });

    await screen.findByText(STALE_HEADLINE);
    await user.click(screen.getByRole("button", ACK_BUTTON));
    await screen.findByText("Source changes acknowledged.");

    await user.click(screen.getByRole("button", { name: "Simulate source mutation" }));
    expect(await screen.findByText(STALE_HEADLINE)).toBeInTheDocument();
    expect(screen.getByRole("button", ACK_BUTTON)).toBeEnabled();
  });

  it("does not resurrect an acknowledgment when the source set returns to an earlier one", async () => {
    const user = userEvent.setup();
    server.current = state({ sourceState: "stale", sourceSetFingerprint: "set-b" });
    renderWorkspace("saved", () => {
      // Back to set A — which was analyzed once — but the selection changed
      // again, so the server reports an unacknowledged stale set.
      server.current = state({
        sourceState: "stale",
        staleSourceAcknowledged: false,
        sourceSetFingerprint: "set-a",
      });
    });

    await screen.findByText(STALE_HEADLINE);
    await user.click(screen.getByRole("button", ACK_BUTTON));
    await screen.findByText("Source changes acknowledged.");

    await user.click(screen.getByRole("button", { name: "Simulate source mutation" }));
    expect(await screen.findByText(STALE_HEADLINE)).toBeInTheDocument();
    expect(screen.getByRole("button", ACK_BUTTON)).toBeEnabled();
  });

  it("clears the notice only when a successful re-analysis makes the state current", async () => {
    const user = userEvent.setup();
    server.current = state({ sourceState: "stale" });
    renderWorkspace("saved", () => undefined);

    await screen.findByText(STALE_HEADLINE);
    await user.click(screen.getByRole("button", { name: "Re-analyze Contract" }));

    await waitFor(() => expect(screen.queryByText(STALE_HEADLINE)).toBeNull());
    expect(server.requests).toBe(1);
    expect(server.executes).toBe(1);
    expect(
      await screen.findByText("AI analysis matches the currently selected source documents."),
    ).toBeInTheDocument();
  });

  it("keeps the authoritative stale state when a re-analysis fails", async () => {
    const user = userEvent.setup();
    server.current = state({ sourceState: "stale" });
    server.failNextRun = true;
    renderWorkspace("saved", () => undefined);

    await screen.findByText(STALE_HEADLINE);
    await user.click(screen.getByRole("button", { name: "Re-analyze Contract" }));

    expect(
      await screen.findByText("The AI analysis could not be completed."),
    ).toBeInTheDocument();
    expect(screen.getByText(STALE_HEADLINE)).toBeInTheDocument();
    expect(screen.getByRole("button", ACK_BUTTON)).toBeInTheDocument();
    expect(server.acknowledgements).toBe(0);
  });

  it("keeps the stale notice when every source document has been removed", async () => {
    server.current = state({ sourceState: "stale", hasIncludedSources: false });
    renderWorkspace("saved", () => undefined);

    expect(await screen.findByText(STALE_HEADLINE)).toBeInTheDocument();
    // Task 6 still owns the primary CTA, which routes to the upload step.
    expect(
      screen.getByText(/No contract PDF is included yet/i),
    ).toBeInTheDocument();
    expect(server.requests).toBe(0);
  });

  it("never renders the source-set fingerprint", async () => {
    server.current = state({ sourceState: "stale" });
    const { container } = render(<div />);
    container.remove();
    renderWorkspace("saved", () => undefined);
    await screen.findByText(STALE_HEADLINE);
    expect(document.body.innerHTML).not.toContain(FINGERPRINT);
  });
});

describe("Task 8 — guest workspace source freshness", () => {
  it("acknowledges in the temporary workspace with no identity in the browser", async () => {
    const user = userEvent.setup();
    server.current = state({
      sourceState: "stale",
      allowance: { scope: "guest", limit: 3, used: 1, remaining: 2, resetAt: null },
    });
    renderWorkspace("guest", () => {
      server.current = state({
        sourceState: "stale",
        staleSourceAcknowledged: false,
        allowance: { scope: "guest", limit: 3, used: 1, remaining: 2, resetAt: null },
      });
    });

    await screen.findByText(STALE_HEADLINE);
    await user.click(screen.getByRole("button", ACK_BUTTON));
    await screen.findByText("Source changes acknowledged.");
    expect(server.acknowledgements).toBe(1);
    expect(screen.getByTestId("allowance")).toHaveTextContent("1/2");

    // A further source change invalidates the acknowledgment here too.
    await user.click(screen.getByRole("button", { name: "Simulate source mutation" }));
    expect(await screen.findByText(STALE_HEADLINE)).toBeInTheDocument();
    expect(server.requests).toBe(0);
    expect(server.executes).toBe(0);
  });
});
