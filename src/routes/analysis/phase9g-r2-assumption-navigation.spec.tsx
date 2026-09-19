// @vitest-environment jsdom
/**
 * Phase 9G-R Task R2 acceptance patch — assumption-target navigation.
 *
 * An explicit one-shot review intent may name a routine assumption. It opens
 * the right section, scrolls to the exact anchor when the production control
 * owns one, and consumes only the review parameter. Assumptions still never
 * add an actionable "AI review" count to an accordion.
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

const ASSUMPTION: AiReviewItemDto = {
  id: "item-assumed",
  targetKey: "contract.customerName",
  section: "step_1",
  state: "assumed",
  severity: "assumed",
  reasonCode: "routine_assumption",
  reason: "ARC read the parties as approving the contract in writing.",
  reviewFingerprint: "fp-assumed",
  guidanceReferenceCount: 0,
  citations: [],
  resolution: null,
};

const YELLOW: AiReviewItemDto = {
  ...ASSUMPTION,
  id: "item-yellow",
  state: "yellow",
  severity: "yellow",
  reasonCode: "accountant_affirmation_required",
  reason: "Confirm the customer named in the contract.",
  reviewFingerprint: "fp-yellow",
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
  search = {};
  aiState = workspace();
});

describe("R2 — assumption target navigation", () => {
  it("resolves an assumption id, scrolls to its exact anchor and consumes only the review parameter", async () => {
    aiState = workspace({ assumptionItems: [ASSUMPTION], assumptionCount: 1 });
    search = { review: ASSUMPTION.id, contract: "c-1" };
    const scrolled: Element[] = [];
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
      scrolled.push(this);
    } as never;

    const { container } = renderArea();

    const anchorId = reviewTargetAnchorId(ASSUMPTION.targetKey);
    const anchor = await waitFor(() => {
      const found = container.querySelector(`#${CSS.escape(anchorId)}`);
      expect(found).not.toBeNull();
      return found!;
    });

    await waitFor(() => expect(scrolled).toContain(anchor));
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: "/analysis",
        search: { contract: "c-1" },
        replace: true,
      }),
    );
  });

  it("does not give the section an actionable AI review count merely because an assumption exists", async () => {
    aiState = workspace({ assumptionItems: [ASSUMPTION], assumptionCount: 1 });
    search = { review: ASSUMPTION.id };
    renderArea();
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(screen.queryByText(/AI review$/)).toBeNull();
  });

  it("leaves ordinary actionable review navigation unchanged", async () => {
    aiState = workspace({ reviewItems: [YELLOW], reviewIssueCount: 1 });
    search = { review: YELLOW.id };
    const scrolled: Element[] = [];
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
      scrolled.push(this);
    } as never;

    const { container } = renderArea();
    const anchor = await waitFor(() => {
      const found = container.querySelector(
        `#${CSS.escape(reviewTargetAnchorId(YELLOW.targetKey))}`,
      );
      expect(found).not.toBeNull();
      return found!;
    });
    await waitFor(() => expect(scrolled).toContain(anchor));
    await waitFor(() => expect(screen.getByText("1 AI review")).toBeInTheDocument());
  });

  it("still consumes a stale intent that names no known item", async () => {
    aiState = workspace({ assumptionItems: [ASSUMPTION], assumptionCount: 1 });
    search = { review: "item-gone", revision: "r-1" };
    renderArea();
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: "/analysis",
        search: { revision: "r-1" },
        replace: true,
      }),
    );
  });
});
