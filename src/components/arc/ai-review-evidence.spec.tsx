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
    { pageStart: 4, pageEnd: 4, evidenceMode: "text", excerpt: "Hosted over the term." },
    { pageStart: 7, pageEnd: 9, evidenceMode: "visual", excerpt: null },
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
  it("offers one deliberate open action per citation, naming the pages", () => {
    renderPanel(controller(workspace([ITEM])));
    expect(screen.getByRole("button", { name: "Open source — page 4" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open source — pages 7–9" })).toBeInTheDocument();
  });

  it("asks the server for the exact citation, and opens the returned page in a disposable tab", async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    vi.stubGlobal("open", open);
    const ai = controller(workspace([ITEM]));
    renderPanel(ai);

    await user.click(screen.getByRole("button", { name: "Open source — pages 7–9" }));

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

  it("opens nothing when the server declines to mint a link", async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    vi.stubGlobal("open", open);
    const ai = controller(workspace([ITEM]), {
      openReviewEvidence: vi.fn(async () => null),
    });
    renderPanel(ai);

    await user.click(screen.getByRole("button", { name: "Open source — page 4" }));
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
    expect(screen.getByRole("button", { name: "Open source — page 4" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Open source — pages 7–9" })).toBeEnabled();
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

    expect(await screen.findByText("Over-time recognition")).toBeInTheDocument();
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
    expect(screen.queryByText("Guidance consulted")).not.toBeInTheDocument();
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
