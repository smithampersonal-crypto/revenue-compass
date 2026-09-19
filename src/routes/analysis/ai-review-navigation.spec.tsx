// @vitest-environment jsdom
/**
 * Phase 9G — Task 7. Exact review navigation against real production controls.
 *
 * The anchor these tests scroll to is created by the production field wrapper,
 * not by the test: a review intent that resolves to a canonical field must
 * reach that field's own element. A review intent naming an item the
 * authoritative workspace no longer has is consumed safely instead of hanging.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AiReviewItemDto } from "@/lib/arc/ai/review-dto";
import type { AiWorkspaceStateDto } from "@/lib/arc/ai/workspace.handlers";
import { reviewTargetAnchorId } from "@/lib/arc/ai/review-presentation";

const navigate = vi.fn();
let search: Record<string, string> = {};

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useNavigate: () => navigate,
    useSearch: () => search,
    Link: ({ children, to }: { children?: unknown; to?: string }) => (
      <a href={to ?? "#"}>{children as never}</a>
    ),
  };
});

let aiState: AiWorkspaceStateDto;
let loading = false;

vi.mock("@/lib/arc/ai/workspace.functions", () => ({
  getAiWorkspaceState: async () => {
    if (loading) await new Promise(() => {});
    return aiState;
  },
  requestAiAnalysis: async () => ({ ...aiState, executionDisposition: "reused_active_run" }),
  affirmAiReviewItem: async () => aiState,
  resolveAiReviewIssue: async () => aiState,
  acknowledgeAiStaleSources: async () => aiState,
}));

vi.mock("@/lib/arc/persistence/guest.functions", () => ({
  resumeGuestWorkspace: async () => ({
    kind: "guest",
    draft: createEmptyDraft(),
    lockVersion: 1,
    expiresAt: new Date(Date.now() + 9 * 3_600_000).toISOString(),
    schemaVersion: "arc.workflow.v1",
    resumed: false,
  }),
  saveGuestDraft: vi.fn(),
  migrateGuestWorkspace: vi.fn(),
}));

vi.mock("@/lib/arc/persistence/revisions.functions", () => ({
  loadContractAnalysis: vi.fn(),
  saveDraftRevision: vi.fn(),
}));

vi.mock("@/components/arc/use-supabase-session", () => ({
  useSupabaseSession: () => ({ status: "signed-out", email: null, userId: null }),
}));

const { createEmptyDraft } = await import("@/lib/asc606-workflow");
const { AnalysisProvider } = await import("@/components/arc/analysis-context");
const { Asc606AnalysisArea } = await import("./index");

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
    assumptionItems: [],
    assumptionCount: 0,
    reviewPayloadMalformed: false,
    fieldProvenance: {},
    objectProvenance: {},
    staleSourceAcknowledged: false,
    allowance: { scope: "guest", limit: 3, used: 1, remaining: 2, resetAt: null },
    failure: null,
    ...overrides,
  } as AiWorkspaceStateDto;
}

const CUSTOMER_ITEM: AiReviewItemDto = {
  id: "item-customer",
  targetKey: "contract.customerName",
  section: "step_1",
  state: "yellow",
  severity: "yellow",
  reasonCode: "accountant_affirmation_required",
  reason: "Confirm the customer named in the contract.",
  reviewFingerprint: "fp-1",
  guidanceReferenceCount: 0,
  citations: [],
  resolution: null,
};

function renderArea() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AnalysisProvider sample={undefined} guest>
        <Asc606AnalysisArea />
      </AnalysisProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  navigate.mockReset();
  loading = false;
  search = {};
  aiState = workspace();
});

describe("exact review navigation", () => {
  it("reaches the production element that owns the exact target and consumes the intent", async () => {
    aiState = workspace({ reviewItems: [CUSTOMER_ITEM], reviewIssueCount: 1 });
    search = { review: CUSTOMER_ITEM.id };
    const scrolled: Element[] = [];
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
      scrolled.push(this);
    } as never;

    const { container } = renderArea();

    const anchorId = reviewTargetAnchorId(CUSTOMER_ITEM.targetKey);
    const anchor = await waitFor(() => {
      const found = container.querySelector(`#${CSS.escape(anchorId)}`);
      expect(found).not.toBeNull();
      return found!;
    });

    await waitFor(() => expect(scrolled).toContain(anchor));
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(
        expect.objectContaining({
          replace: true,
          search: expect.not.objectContaining({ review: expect.anything() }),
        }),
      ),
    );
  });

  it("waits while the authoritative workspace is still loading", async () => {
    loading = true;
    search = { review: "item-missing" };
    renderArea();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(navigate).not.toHaveBeenCalled();
  });

  it("consumes only the review parameter when the item no longer exists", async () => {
    aiState = workspace({ reviewItems: [] });
    search = { review: "item-gone", contract: "c-1", revision: "r-1" };
    renderArea();
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: "/analysis",
        search: { contract: "c-1", revision: "r-1" },
        replace: true,
      }),
    );
  });

  it("gives a generic additional-topics item a real fallback target and its own count", async () => {
    aiState = workspace({
      reviewItems: [
        {
          ...CUSTOMER_ITEM,
          id: "item-topic",
          targetKey: "draft.additionalTopics",
          section: "additional_topics",
        },
      ],
      reviewIssueCount: 1,
    });
    const { container } = renderArea();
    await waitFor(() => expect(container.querySelector("#additional-topics")).not.toBeNull());
    // The AI count is presented separately from the deterministic issue status.
    await waitFor(() => expect(screen.getByText("1 AI review")).toBeInTheDocument());
  });
});
