// @vitest-environment jsdom
/**
 * Phase 9G — Task 7. The accountant-facing AI review queue.
 *
 * The panel presents server-owned review state and nothing else: it never
 * derives severity, never resolves an item locally, never treats provenance as
 * approval and never offers a bulk or generic dismissal. A malformed persisted
 * payload makes review unavailable rather than looking clean.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AiReviewPanel } from "./AiReviewPanel";
import type { AiWorkspaceController } from "@/hooks/use-ai-workspace-controller";
import type { AiReviewItemDto } from "@/lib/arc/ai/review-dto";
import type { AiWorkspaceStateDto } from "@/lib/arc/ai/workspace.handlers";

const YELLOW: AiReviewItemDto = {
  id: "item-yellow",
  targetKey: "po:po-saas.recognitionMethod",
  section: "step_5",
  state: "yellow",
  severity: "yellow",
  reasonCode: "accountant_affirmation_required",
  reason: "Confirm the recognition pattern for the hosted platform.",
  reviewFingerprint: "fp-yellow",
  citations: [{ pageStart: 4, pageEnd: 4, evidenceMode: "text", excerpt: "Hosted over the term." }],
  resolution: null,
};

const RED: AiReviewItemDto = {
  id: "item-red",
  targetKey: "contract.transactionPriceCents",
  section: "step_3",
  state: "red",
  severity: "red",
  reasonCode: "source_conflict",
  reason: "The transaction price could not be supported by the contract.",
  reviewFingerprint: "fp-red",
  citations: [],
  resolution: null,
};

const RESOLVED: AiReviewItemDto = {
  ...YELLOW,
  id: "item-resolved",
  state: "resolved",
  resolution: { kind: "affirmed", at: "2026-09-17T10:00:00.000Z", method: "individual" },
};

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
  };
}

function controller(state: AiWorkspaceStateDto | null): AiWorkspaceController {
  return {
    workspace: state,
    loadState: state ? "ready" : "loading",
    actionState: "idle",
    active: false,
    progress: null,
    analyzeMode: "reanalyze",
    locks: { analyze: false, finalize: false, sourceDocuments: false },
    message: null,
    analyze: vi.fn(async () => {}),
    affirmReviewItem: vi.fn(async () => {}),
    resolveReviewIssue: vi.fn(async () => {}),
    acknowledgeStaleSources: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
  } as unknown as AiWorkspaceController;
}

describe("AiReviewPanel", () => {
  it("renders nothing when AI was never run", () => {
    const { container } = render(<AiReviewPanel ai={controller(workspace({ hasAnalysis: false }))} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("presents outstanding items with their section, reason and evidence", () => {
    render(
      <AiReviewPanel
        ai={controller(workspace({ reviewItems: [RED, YELLOW], reviewIssueCount: 2 }))}
      />,
    );
    expect(screen.getByRole("region", { name: /ai review/i })).toBeInTheDocument();
    expect(
      screen.getByText("The transaction price could not be supported by the contract."),
    ).toBeInTheDocument();
    expect(screen.getByText(/Hosted over the term\./)).toBeInTheDocument();
    // Severity is conveyed in text, never by colour alone.
    expect(screen.getByText("Needs resolution")).toBeInTheDocument();
    expect(screen.getByText("Needs confirmation")).toBeInTheDocument();
  });

  it("confirms one yellow item with its exact review fingerprint", async () => {
    const ai = controller(workspace({ reviewItems: [YELLOW], reviewIssueCount: 1 }));
    render(<AiReviewPanel ai={ai} />);
    await userEvent.click(screen.getByRole("button", { name: /^Confirm$/ }));
    expect(ai.affirmReviewItem).toHaveBeenCalledWith({
      reviewItemId: "item-yellow",
      expectedReviewFingerprint: "fp-yellow",
      method: "individual",
    });
  });

  it("offers no confirm action for a red item", () => {
    render(<AiReviewPanel ai={controller(workspace({ reviewItems: [RED], reviewIssueCount: 1 }))} />);
    expect(screen.queryByRole("button", { name: /^Confirm$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /dismiss|confirm all|resolve all/i })).toBeNull();
  });

  it("resolves a red item with one accepted reason and an optional note", async () => {
    const ai = controller(workspace({ reviewItems: [RED], reviewIssueCount: 1 }));
    render(<AiReviewPanel ai={ai} />);
    await userEvent.click(screen.getByRole("button", { name: /^Resolve$/ }));
    await userEvent.click(
      await screen.findByRole("radio", { name: /reviewed current treatment/i }),
    );
    await userEvent.type(screen.getByLabelText(/note/i), "Priced per the signed order form.");
    await userEvent.click(screen.getByRole("button", { name: /record resolution/i }));

    await waitFor(() =>
      expect(ai.resolveReviewIssue).toHaveBeenCalledWith({
        reviewItemId: "item-red",
        expectedReviewFingerprint: "fp-red",
        reason: "reviewed_current_treatment",
        note: "Priced per the signed order form.",
      }),
    );
  });

  it("caps the resolution note at the accepted length", async () => {
    render(<AiReviewPanel ai={controller(workspace({ reviewItems: [RED] }))} />);
    await userEvent.click(screen.getByRole("button", { name: /^Resolve$/ }));
    expect(await screen.findByLabelText(/note/i)).toHaveAttribute("maxLength", "2000");
  });

  it("shows resolved items separately with how they were resolved", () => {
    render(<AiReviewPanel ai={controller(workspace({ reviewItems: [RESOLVED] }))} />);
    const resolved = screen.getByRole("group", { name: /resolved/i });
    expect(resolved).toHaveTextContent(/Confirmed/i);
    expect(screen.queryByRole("button", { name: /^Confirm$/ })).not.toBeInTheDocument();
  });

  it("fails closed and offers no action when the persisted review payload is malformed", () => {
    render(
      <AiReviewPanel ai={controller(workspace({ reviewPayloadMalformed: true, reviewItems: [] }))} />,
    );
    expect(screen.getByText(/review state could not be read/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Confirm$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Resolve$/ })).not.toBeInTheDocument();
  });

  it("disables review actions while a run is active", () => {
    const ai = controller(workspace({ reviewItems: [YELLOW] }));
    (ai as { active: boolean }).active = true;
    render(<AiReviewPanel ai={ai} />);
    expect(screen.getByRole("button", { name: /^Confirm$/ })).toBeDisabled();
  });

  it("asks the host to open the persisted target instead of navigating itself", async () => {
    const onOpenTarget = vi.fn();
    render(
      <AiReviewPanel
        ai={controller(workspace({ reviewItems: [YELLOW] }))}
        onOpenTarget={onOpenTarget}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /go to/i }));
    expect(onOpenTarget).toHaveBeenCalledWith(YELLOW.id);
  });
});
