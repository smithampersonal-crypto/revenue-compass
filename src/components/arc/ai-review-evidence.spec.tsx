// @vitest-environment jsdom
/**
 * Phase 9G — Task 9A/9B. Review evidence and guidance, as the accountant meets
 * them.
 *
 * Both are deliberate reads. A signed source link is used immediately in a
 * disposable tab and never stored; guidance is offered only when the server
 * says references exist, and never exposes how they were chosen.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AiReviewPanel } from "./AiReviewPanel";
import type { AiWorkspaceController } from "@/hooks/use-ai-workspace-controller";
import type { AiReviewItemDto } from "@/lib/arc/ai/review-dto";
import type { AiWorkspaceStateDto } from "@/lib/arc/ai/workspace.handlers";

const ITEM: AiReviewItemDto = {
  id: "item-yellow",
  targetKey: "po:po-saas.recognitionMethod",
  section: "step_5",
  state: "yellow",
  severity: "yellow",
  reasonCode: "accountant_affirmation_required",
  reason: "Confirm the recognition pattern for the hosted platform.",
  reviewFingerprint: "fp-yellow",
  guidanceReferenceCount: 0,
  citations: [
    {
      pageStart: 4,
      pageEnd: 4,
      citationIndex: 0,
      evidenceModes: ["text"],
      excerpts: ["Hosted over the term."],
    },
    {
      pageStart: 7,
      pageEnd: 9,
      citationIndex: 1,
      evidenceModes: ["visual"],
      excerpts: [],
    },
  ],
  resolution: null,
};

function workspace(items: AiReviewItemDto[]): AiWorkspaceStateDto {
  return {
    hasAnalysis: true,
    activeRun: null,
    latestRun: null,
    lastSuccessfulRunId: "run-1",
    sourceState: "current",
    hasIncludedSources: true,
    sourceSetFingerprint: "fp",
    reviewIssueCount: items.length,
    reviewItems: items,
    assumptionItems: [],
    assumptionCount: 0,
    reviewPayloadMalformed: false,
    fieldProvenance: {},
    objectProvenance: {},
    staleSourceAcknowledged: false,
    allowance: { scope: "authenticated", limit: 10, used: 1, remaining: 9, resetAt: null },
    failure: null,
    restorableRun: null,
  };
}

function controller(
  state: AiWorkspaceStateDto,
  overrides: Partial<AiWorkspaceController> = {},
): AiWorkspaceController {
  return {
    workspace: state,
    loadState: "ready",
    actionState: "idle",
    active: false,
    progress: null,
    analyzeMode: "reanalyze",
    locks: { analyze: false, reviewActions: false, sourceDocuments: false, finalize: false },
    message: null,
    analyze: vi.fn(async () => undefined),
    affirmReviewItem: vi.fn(async () => undefined),
    resolveReviewIssue: vi.fn(async () => undefined),
    acknowledgeStaleSources: vi.fn(async () => undefined),
    openReviewEvidence: vi.fn(async () => ({
      url: "https://signed.example/doc?token=abc",
      expiresInSeconds: 900,
      pageStart: 4,
      pageEnd: 4,
    })),
    getReviewGuidance: vi.fn(async () => ({
      cards: [
        {
          topic: "Over-time recognition",
          subtopic: "Term subscriptions",
          primaryAscReference: "ASC 606-10-25-27",
          relatedAscReferences: "ASC 606-10-55-5",
          ruleSummary: "Recognize over time when the customer consumes as the entity performs.",
          decisionCriteria: "Assess the transfer pattern.",
          factsRequired: "Service term and access terms.",
          importantNuances: "Set-up activities are not a performance obligation.",
          whenRelevant: "SaaS subscriptions.",
          accountantMustApprove: "The recognition pattern conclusion.",
          interpretiveSource: "ARC interpretive note",
          sourceUrls: ["https://asc.fasb.org/606"],
          lastReviewed: "2026-01-31",
        },
      ],
    })),
    restoreAnalysis: vi.fn(async () => undefined),
    pendingEvidence: new Set<string>(),
    restoring: false,
    refresh: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as AiWorkspaceController;
}

function renderPanel(ai: AiWorkspaceController) {
  render(<AiReviewPanel ai={ai} onOpenTarget={vi.fn()} />);
}

describe("Task 9A citation evidence", () => {
  it("offers one deliberate Open PDF action per evidence row", () => {
    renderPanel(controller(workspace([ITEM])));
    const firstLabel = screen.getByText("Source Evidence · Page 4");
    expect(firstLabel).toBeInTheDocument();
    expect(screen.getByText("Source Evidence · Pages 7–9")).toBeInTheDocument();
    const firstAction = screen.getByRole("button", { name: "Open PDF — Page 4" });
    expect(firstAction).toHaveTextContent("Open PDF");
    const evidenceRow = firstLabel.parentElement;
    expect(evidenceRow).toContainElement(firstAction);
    expect(evidenceRow).toHaveClass("flex", "flex-wrap", "gap-x-2");
    expect(evidenceRow).not.toHaveClass("justify-between");
    expect(screen.getByRole("button", { name: "Open PDF — Pages 7–9" })).toHaveTextContent(
      "Open PDF",
    );
    expect(screen.queryByText(/Visual source evidence|Open source/i)).not.toBeInTheDocument();
  });

  it("asks the server for the exact citation, and opens the returned page in a disposable tab", async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    vi.stubGlobal("open", open);
    const ai = controller(workspace([ITEM]));
    renderPanel(ai);

    await user.click(screen.getByRole("button", { name: "Open PDF — Pages 7–9" }));

    await waitFor(() => expect(ai.openReviewEvidence).toHaveBeenCalledTimes(1));
    expect(ai.openReviewEvidence).toHaveBeenCalledWith({
      reviewItemId: "item-yellow",
      expectedReviewFingerprint: "fp-yellow",
      citationIndex: 1,
    });
    await waitFor(() =>
      expect(open).toHaveBeenCalledWith(
        "https://signed.example/doc?token=abc#page=4",
        "_blank",
        "noopener,noreferrer",
      ),
    );
    vi.unstubAllGlobals();
  });

  it("distinguishes same-page source actions and retains each original persisted index", async () => {
    const user = userEvent.setup();
    const grouped: AiReviewItemDto = {
      ...ITEM,
      citations: [
        {
          pageStart: 3,
          pageEnd: 3,
          citationIndex: 0,
          evidenceModes: ["text", "visual"],
          excerpts: ["First excerpt.", "Second excerpt."],
        },
        {
          pageStart: 3,
          pageEnd: 3,
          citationIndex: 3,
          evidenceModes: ["text"],
          excerpts: ["Other document excerpt."],
        },
      ],
    };
    const ai = controller(workspace([grouped]));
    renderPanel(ai);

    expect(screen.getAllByText("Source Evidence · Page 3")).toHaveLength(2);
    expect(screen.getByText("First excerpt.")).toBeInTheDocument();
    expect(screen.getByText("Second excerpt.")).toBeInTheDocument();
    const first = screen.getByRole("button", {
      name: "Open PDF — Source Evidence 1, Page 3",
    });
    const second = screen.getByRole("button", {
      name: "Open PDF — Source Evidence 2, Page 3",
    });
    expect(first).toHaveTextContent("Open PDF");
    expect(second).toHaveTextContent("Open PDF");

    await user.click(second);
    expect(ai.openReviewEvidence).toHaveBeenCalledWith({
      reviewItemId: "item-yellow",
      expectedReviewFingerprint: "fp-yellow",
      citationIndex: 3,
    });
  });

  it("opens nothing when the server declines to mint a link", async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    vi.stubGlobal("open", open);
    const ai = controller(workspace([ITEM]), {
      openReviewEvidence: vi.fn(async () => null),
    });
    renderPanel(ai);

    await user.click(screen.getByRole("button", { name: "Open PDF — Page 4" }));
    await waitFor(() => expect(ai.openReviewEvidence).toHaveBeenCalledTimes(1));
    expect(open).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("blocks only the citation already in flight", () => {
    renderPanel(
      controller(workspace([ITEM]), {
        pendingEvidence: new Set(["evidence:item-yellow:0"]),
      }),
    );
    expect(screen.getByRole("button", { name: "Open PDF — Page 4" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Open PDF — Pages 7–9" })).toBeEnabled();
  });

  it("retains evidence and guidance for a resolved review item without resolution actions", () => {
    const resolved: AiReviewItemDto = {
      ...ITEM,
      state: "resolved",
      guidanceReferenceCount: 1,
      resolution: { kind: "affirmed", at: "2026-09-18T10:00:00.000Z", method: "individual" },
    };
    renderPanel(controller(workspace([resolved])));

    expect(screen.getByText("Source Evidence · Page 4")).toBeInTheDocument();
    expect(screen.getByText("Hosted over the term.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open PDF — Page 4" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View guidance" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Confirm$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Resolve$/ })).not.toBeInTheDocument();
  });
});

describe("Task 9B review guidance", () => {
  const WITH_GUIDANCE: AiReviewItemDto = { ...ITEM, guidanceReferenceCount: 1 };

  it("offers guidance only when the server reports references", () => {
    const { unmount } = render(
      <AiReviewPanel ai={controller(workspace([ITEM]))} onOpenTarget={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: "View guidance" })).not.toBeInTheDocument();
    unmount();

    renderPanel(controller(workspace([WITH_GUIDANCE])));
    expect(screen.getByRole("button", { name: "View guidance" })).toBeInTheDocument();
  });

  it("shows only accountant-facing content, on request, with the exact fingerprint", async () => {
    const user = userEvent.setup();
    const ai = controller(workspace([WITH_GUIDANCE]));
    renderPanel(ai);

    await user.click(screen.getByRole("button", { name: "View guidance" }));
    await waitFor(() => expect(ai.getReviewGuidance).toHaveBeenCalledTimes(1));
    expect(ai.getReviewGuidance).toHaveBeenCalledWith({
      reviewItemId: "item-yellow",
      expectedReviewFingerprint: "fp-yellow",
    });

    expect(await screen.findByRole("heading", { name: "ASC 606 Guidance" })).toBeInTheDocument();
    expect(screen.getByText("Over-time recognition")).toBeInTheDocument();
    expect(screen.getByText("Term subscriptions")).toBeInTheDocument();
    expect(screen.getByText("SaaS subscriptions.")).toBeInTheDocument();
    expect(screen.getByText(/ASC 606-10-25-27 · ASC 606-10-55-5/)).toBeInTheDocument();
    expect(
      screen.getByText(/You remain responsible for the accounting conclusion/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "https://asc.fasb.org/606" })).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    );
  });

  it("opens nothing when guidance cannot be resolved", async () => {
    const user = userEvent.setup();
    const ai = controller(workspace([WITH_GUIDANCE]), {
      getReviewGuidance: vi.fn(async () => null),
    });
    renderPanel(ai);

    await user.click(screen.getByRole("button", { name: "View guidance" }));
    await waitFor(() => expect(ai.getReviewGuidance).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("ASC 606 Guidance")).not.toBeInTheDocument();
  });

  it("blocks a second guidance request while one is in flight", () => {
    renderPanel(
      controller(workspace([WITH_GUIDANCE]), {
        pendingEvidence: new Set(["guidance:item-yellow"]),
      }),
    );
    const button = screen.getByRole("button", { name: "View guidance" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });
});
