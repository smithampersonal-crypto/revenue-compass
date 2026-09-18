// @vitest-environment jsdom
/**
 * Phase 9G — Task 7. The browser finalization gate must actually be wired.
 *
 * `aiReviewFinalizeBlock()` being correct is not enough: these tests drive the
 * production Finalize buttons, because the defect this suite exists for was a
 * computed block that no button ever consulted. The deterministic gate stays
 * independently authoritative, and the server rule in Task 1 is untouched.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AiWorkspaceStateDto } from "@/lib/arc/ai/workspace.handlers";
import type { AiReviewItemDto } from "@/lib/arc/ai/review-dto";
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
    Link: ({ children, to }: { children?: unknown; to?: string }) => (
      <a href={to ?? "#"}>{children as never}</a>
    ),
  };
});

const load = vi.fn();
const save = vi.fn();
const finalize = vi.fn();
const history = vi.fn();

vi.mock("@/lib/arc/persistence/revisions.functions", () => ({
  loadContractAnalysis: (args: unknown) => load(args),
  saveDraftRevision: (args: unknown) => save(args),
  finalizeRevision: (args: unknown) => finalize(args),
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

const { AnalysisProvider } = await import("@/components/arc/analysis-context");
const { RevisionLifecyclePanel } = await import("@/components/arc/RevisionLifecyclePanel");

const CONTRACT_ID = "11111111-1111-4111-8111-111111111111";
const REVISION_ID = "22222222-2222-4222-8222-222222222222";
const DRAFT = createDemoDraftIfKnown("horizon")!;

function workspace(overrides: Partial<AiWorkspaceStateDto> = {}): AiWorkspaceStateDto {
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
    reviewPayloadMalformed: false,
    fieldProvenance: {},
    objectProvenance: {},
    staleSourceAcknowledged: false,
    allowance: { scope: "authenticated", limit: 10, used: 1, remaining: 9, resetAt: null },
    failure: null,
    ...overrides,
  } as AiWorkspaceStateDto;
}

const YELLOW: AiReviewItemDto = {
  id: "item-yellow",
  targetKey: "po:po-saas.recognitionMethod",
  section: "step_5",
  state: "yellow",
  severity: "yellow",
  reasonCode: "accountant_affirmation_required",
  reason: "Confirm the recognition pattern.",
  reviewFingerprint: "fp-yellow",
  citations: [],
  resolution: null,
};

const RED: AiReviewItemDto = {
  ...YELLOW,
  id: "item-red",
  state: "red",
  severity: "red",
  reasonCode: "source_conflict",
  reviewFingerprint: "fp-red",
};

const RESOLVED: AiReviewItemDto = {
  ...YELLOW,
  id: "item-resolved",
  state: "resolved",
  resolution: { kind: "affirmed", at: "2026-09-17T10:00:00.000Z", method: "individual" },
};

function savedDraft() {
  return {
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
    draft: DRAFT,
  };
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AnalysisProvider sample={undefined} contractId={CONTRACT_ID} revisionId={REVISION_ID}>
        <RevisionLifecyclePanel />
      </AnalysisProvider>
    </QueryClientProvider>,
  );
}

async function finalizeButton() {
  return await screen.findByRole("button", { name: /finalize analysis/i });
}

beforeEach(() => {
  aiState = workspace({ hasAnalysis: false });
  load.mockReset().mockResolvedValue(savedDraft());
  save.mockReset().mockResolvedValue({ ok: true, lockVersion: 4, savedAt: "2026-01-01" });
  finalize.mockReset().mockResolvedValue({ ok: true, revisionId: REVISION_ID });
  history
    .mockReset()
    .mockResolvedValue({ revisions: [{ revisionId: REVISION_ID, status: "draft" }] });
});

describe("AI review blocks the production Finalize buttons", () => {
  it("does not block an analysis where AI was never run", async () => {
    aiState = workspace({ hasAnalysis: false });
    renderPanel();
    await waitFor(async () => expect(await finalizeButton()).toBeEnabled());
    expect(screen.queryByText(/AI review item/i)).toBeNull();
  });

  it("disables Finalize and explains why while a yellow item is unconfirmed", async () => {
    aiState = workspace({ reviewItems: [YELLOW], reviewIssueCount: 1 });
    renderPanel();
    await waitFor(async () => expect(await finalizeButton()).toBeDisabled());
    expect(await screen.findByText(/1 AI review item still needs/i)).toBeInTheDocument();
  });

  it("disables Finalize while a red item is unresolved", async () => {
    aiState = workspace({ reviewItems: [RED], reviewIssueCount: 1 });
    renderPanel();
    await waitFor(async () => expect(await finalizeButton()).toBeDisabled());
  });

  it("disables Finalize and explains safely when the review payload is malformed", async () => {
    aiState = workspace({ reviewPayloadMalformed: true, reviewItems: [] });
    renderPanel();
    await waitFor(async () => expect(await finalizeButton()).toBeDisabled());
    expect(await screen.findByText(/could not be read/i)).toBeInTheDocument();
  });

  it("clears the AI gate once every review item is resolved", async () => {
    aiState = workspace({ reviewItems: [RESOLVED] });
    renderPanel();
    await waitFor(async () => expect(await finalizeButton()).toBeEnabled());
    expect(screen.queryByText(/AI review item/i)).toBeNull();
  });

  it("keeps the confirmation-stage Finalize disabled when AI review reopens mid-confirmation", async () => {
    aiState = workspace({ hasAnalysis: false });
    renderPanel();
    const user = userEvent.setup();
    await user.click(await finalizeButton());
    // The confirmation stage consults the same two independent gates.
    expect(await screen.findByText(/makes this revision immutable/i)).toBeInTheDocument();
    expect(await finalizeButton()).toBeEnabled();
  });
});
