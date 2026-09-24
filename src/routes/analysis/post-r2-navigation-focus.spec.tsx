// @vitest-environment jsdom
/**
 * Post-R2 live regression patch — defect 1.
 *
 * Review navigation must land the accountant ON the item: the section is
 * expanded first, the exact anchor is scrolled to, tidying the URL suppresses
 * router scroll reset, and a short-lived marker shows where they landed.
 * Routine assumptions never gain an actionable marker.
 *
 * JSDOM cannot reproduce the router's own scroll restoration; the real-browser
 * verification for that is recorded in roadmap.md.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { render, waitFor } from "@testing-library/react";
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

const YELLOW: AiReviewItemDto = {
  id: "item-yellow",
  targetKey: "contract.customerName",
  section: "step_1",
  state: "yellow",
  severity: "yellow",
  reasonCode: "accountant_affirmation_required",
  reason: "Confirm the customer named in the contract.",
  reviewFingerprint: "fp-yellow",
  guidanceReferenceCount: 0,
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

const ASSUMPTION: AiReviewItemDto = {
  ...YELLOW,
  id: "item-assumed",
  state: "assumed",
  severity: "assumed",
  reasonCode: "routine_assumption",
  reason: "ARC read the parties as approving the contract in writing.",
  reviewFingerprint: "fp-assumed",
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

async function anchorFor(container: HTMLElement, item: AiReviewItemDto) {
  return await waitFor(() => {
    const found = container.querySelector(`#${CSS.escape(reviewTargetAnchorId(item.targetKey))}`);
    expect(found).not.toBeNull();
    return found as HTMLElement;
  });
}

beforeEach(() => {
  navigate.mockReset();
  search = {};
  aiState = workspace();
  Element.prototype.scrollIntoView = function scrollIntoView() {} as never;
});

describe("post-R2 — review navigation lands on the item", () => {
  it("keeps a static amber treatment and disables only its flourish for reduced motion", () => {
    const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
    expect(css).toContain("@keyframes arc-review-focus-arrival");
    expect(css).toMatch(/\.arc-review-focus\s*\{[^}]*background-color:[^}]*warning/s);
    expect(css).toMatch(
      /\.arc-review-focus\s*\{[^}]*animation: arc-review-focus-arrival 900ms ease-out 1/s,
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.arc-review-focus\s*\{[^}]*animation: none/s,
    );
  });
  it("suppresses router scroll reset when it removes the one-shot parameter", async () => {
    aiState = workspace({ reviewItems: [YELLOW], reviewIssueCount: 1 });
    search = { review: YELLOW.id, contract: "c-1" };
    renderArea();
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: "/analysis",
        search: { contract: "c-1" },
        replace: true,
        resetScroll: false,
      }),
    );
  });

  it("marks a yellow destination with a Review this item treatment that clears itself", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      aiState = workspace({ reviewItems: [YELLOW], reviewIssueCount: 1 });
      search = { review: YELLOW.id };
      const { container } = renderArea();
      const anchor = await anchorFor(container, YELLOW);
      await waitFor(() => expect(anchor.classList.contains("arc-review-focus")).toBe(true));
      expect(anchor.getAttribute("data-arc-focus-label")).toBe("Review this item");

      vi.advanceTimersByTime(5_000);
      expect(anchor.classList.contains("arc-review-focus")).toBe(false);
      expect(anchor.getAttribute("data-arc-focus-label")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks a red destination with a Resolve this item treatment", async () => {
    aiState = workspace({ reviewItems: [RED], reviewIssueCount: 1 });
    search = { review: RED.id };
    const { container } = renderArea();
    const anchor = await anchorFor(container, RED);
    await waitFor(() =>
      expect(anchor.getAttribute("data-arc-focus-label")).toBe("Resolve this item"),
    );
  });

  it("highlights an assumption target without giving it an actionable label", async () => {
    aiState = workspace({ assumptionItems: [ASSUMPTION], assumptionCount: 1 });
    search = { review: ASSUMPTION.id };
    const { container } = renderArea();
    const anchor = await anchorFor(container, ASSUMPTION);
    await waitFor(() => expect(anchor.classList.contains("arc-review-focus")).toBe(true));
    expect(anchor.getAttribute("data-arc-focus-label")).toBeNull();
  });
});
