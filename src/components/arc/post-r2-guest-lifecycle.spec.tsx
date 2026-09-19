// @vitest-environment jsdom
/**
 * Post-R2 live regression patch — defect 5.
 *
 * A temporary guest workspace has no revision, and that is not a loading
 * state. It gets stable accountant-facing copy and is never offered
 * finalization. Saved revisions are untouched.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AiWorkspaceStateDto } from "@/lib/arc/ai/workspace.handlers";
import { createDemoDraftIfKnown } from "@/lib/demo-scenarios";

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useSearch: () => ({}),
    Link: ({ children, to }: { children?: unknown; to?: string }) => (
      <a href={to ?? "#"}>{children as never}</a>
    ),
  };
});

const load = vi.fn();
const history = vi.fn();

vi.mock("@/lib/arc/persistence/revisions.functions", () => ({
  loadContractAnalysis: (args: unknown) => load(args),
  saveDraftRevision: vi.fn(),
  finalizeRevision: vi.fn(),
  listRevisionHistory: (args: unknown) => history(args),
  startNewRevision: vi.fn(),
}));

let aiState: AiWorkspaceStateDto;

vi.mock("@/lib/arc/ai/workspace.functions", () => ({
  getAiWorkspaceState: async () => aiState,
  requestAiAnalysis: async () => ({ ...aiState, executionDisposition: "reused_active_run" }),
  affirmAiReviewItem: async () => aiState,
  resolveAiReviewIssue: async () => aiState,
  acknowledgeAiStaleSources: async () => aiState,
}));

vi.mock("@/lib/arc/persistence/guest.functions", () => ({
  resumeGuestWorkspace: async () => ({
    kind: "guest",
    draft: createDemoDraftIfKnown("horizon")!,
    lockVersion: 1,
    expiresAt: new Date(Date.now() + 9 * 3_600_000).toISOString(),
    schemaVersion: "arc.workflow.v1",
    resumed: false,
  }),
  saveGuestDraft: vi.fn(),
  migrateGuestWorkspace: vi.fn(),
}));

vi.mock("@/components/arc/use-supabase-session", () => ({
  useSupabaseSession: () => ({ status: "signed-out", email: null, userId: null }),
}));

const { AnalysisProvider } = await import("@/components/arc/analysis-context");
const { RevisionLifecyclePanel } = await import("@/components/arc/RevisionLifecyclePanel");

function workspace(): AiWorkspaceStateDto {
  return {
    hasAnalysis: true,
    activeRun: null,
    latestRun: null,
    lastSuccessfulRunId: "run-1",
    sourceState: "current",
    hasIncludedSources: true,
    sourceSetFingerprint: "fp",
    reviewIssueCount: 0,
    reviewItems: [],
    assumptionItems: [],
    assumptionCount: 0,
    reviewPayloadMalformed: false,
    fieldProvenance: {},
    objectProvenance: {},
    staleSourceAcknowledged: false,
    allowance: { scope: "guest", limit: 3, used: 1, remaining: 2, resetAt: null },
    failure: null,
    restorableRun: null,
  } as AiWorkspaceStateDto;
}

function renderGuestPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AnalysisProvider sample={undefined} guest>
        <RevisionLifecyclePanel />
      </AnalysisProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  aiState = workspace();
  load.mockReset();
  history.mockReset().mockResolvedValue({ revisions: [] });
});

describe("post-R2 — guest revision lifecycle copy", () => {
  it("shows stable temporary-workspace copy instead of a loading message", async () => {
    renderGuestPanel();
    await waitFor(() => expect(screen.getByText("Temporary workspace")).toBeInTheDocument());
    expect(
      screen.getByText(/Save this analysis to your account before finalizing a revision\./i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Opening the saved analysis/i)).toBeNull();
  });

  it("never offers finalization for an unsaved guest revision", async () => {
    renderGuestPanel();
    await waitFor(() => expect(screen.getByText("Temporary workspace")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /finalize analysis/i })).toBeNull();
  });
});
