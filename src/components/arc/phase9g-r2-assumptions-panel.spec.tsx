// @vitest-environment jsdom
/**
 * Phase 9G-R Task R2 acceptance patch — the accountant-facing routine
 * assumptions group.
 *
 * Assumptions are visible, read-only and navigable. They never offer Confirm
 * or Resolve, never join the actionable queue and never change the outstanding
 * count.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AiReviewPanel } from "./AiReviewPanel";
import type { AiWorkspaceController } from "@/hooks/use-ai-workspace-controller";
import type { AiReviewItemDto } from "@/lib/arc/ai/review-dto";
import type { AiWorkspaceStateDto } from "@/lib/arc/ai/workspace.handlers";
import {
  ASSUMPTIONS_GROUP_DESCRIPTION,
  ASSUMPTIONS_GROUP_LABEL,
} from "@/lib/arc/ai/review-presentation";

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
  id: "item-yellow",
  targetKey: "po:po-saas.recognitionMethod",
  section: "step_5",
  state: "yellow",
  severity: "yellow",
  reasonCode: "accountant_affirmation_required",
  reason: "Confirm the recognition pattern for the hosted platform.",
  reviewFingerprint: "fp-yellow",
  guidanceReferenceCount: 0,
  citations: [],
  resolution: null,
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
    assumptionItems: [],
    assumptionCount: 0,
    reviewPayloadMalformed: false,
    fieldProvenance: {},
    objectProvenance: {},
    staleSourceAcknowledged: false,
    allowance: { scope: "authenticated", limit: 10, used: 1, remaining: 9, resetAt: null },
    failure: null,
    restorableRun: null,
    ...overrides,
  } as AiWorkspaceStateDto;
}

function controller(state: AiWorkspaceStateDto): AiWorkspaceController {
  return {
    workspace: state,
    loadState: "ready",
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
    openReviewEvidence: vi.fn(async () => null),
    getReviewGuidance: vi.fn(async () => null),
    restoreAnalysis: vi.fn(async () => {}),
    pendingEvidence: new Set<string>(),
    restoring: false,
    refresh: vi.fn(async () => {}),
  } as unknown as AiWorkspaceController;
}

describe("R2 — routine assumptions group", () => {
  it("renders the group with its required heading and description", () => {
    render(
      <AiReviewPanel
        ai={controller(workspace({ assumptionItems: [ASSUMPTION], assumptionCount: 1 }))}
      />,
    );
    const group = screen.getByRole("group", { name: ASSUMPTIONS_GROUP_LABEL });
    expect(within(group).getByText(ASSUMPTIONS_GROUP_LABEL)).toBeInTheDocument();
    expect(within(group).getByText(ASSUMPTIONS_GROUP_DESCRIPTION)).toBeInTheDocument();
    expect(within(group).getByText(ASSUMPTION.reason)).toBeInTheDocument();
  });

  it("renders a section-level assumption category once", () => {
    const fallback: AiReviewItemDto = {
      ...ASSUMPTION,
      targetKey: "additionalTopic:principal_agent",
      section: "additional_topics",
    };
    render(
      <AiReviewPanel
        ai={controller(workspace({ assumptionItems: [fallback], assumptionCount: 1 }))}
      />,
    );
    const group = screen.getByRole("group", { name: ASSUMPTIONS_GROUP_LABEL });
    expect(within(group).getByText("Additional Topics Applied")).toBeInTheDocument();
    expect(within(group)).not.toHaveTextContent(
      "Additional Topics Applied · Additional Topics Applied",
    );
  });

  it("renders nothing for the group when there are no assumptions", () => {
    render(<AiReviewPanel ai={controller(workspace({ reviewItems: [YELLOW] }))} />);
    expect(screen.queryByRole("group", { name: ASSUMPTIONS_GROUP_LABEL })).toBeNull();
  });

  it("offers no Confirm and no Resolve action on an assumption", () => {
    render(
      <AiReviewPanel
        ai={controller(workspace({ assumptionItems: [ASSUMPTION], assumptionCount: 1 }))}
      />,
    );
    const group = screen.getByRole("group", { name: ASSUMPTIONS_GROUP_LABEL });
    expect(within(group).queryByRole("button", { name: /confirm/i })).toBeNull();
    expect(within(group).queryByRole("button", { name: /resolve/i })).toBeNull();
  });

  it("keeps assumptions out of the actionable list and the outstanding count", () => {
    render(
      <AiReviewPanel
        ai={controller(
          workspace({
            reviewItems: [YELLOW],
            reviewIssueCount: 1,
            assumptionItems: [ASSUMPTION],
            assumptionCount: 1,
          }),
        )}
      />,
    );
    const group = screen.getByRole("group", { name: ASSUMPTIONS_GROUP_LABEL });
    expect(within(group).queryByText(YELLOW.reason)).toBeNull();
    expect(screen.getByText(YELLOW.reason)).toBeInTheDocument();
    expect(screen.queryByText(/2 (issue|item)/i)).toBeNull();
  });

  it("emits the assumption item id from its Go to control", async () => {
    const onOpenTarget = vi.fn();
    render(
      <AiReviewPanel
        ai={controller(workspace({ assumptionItems: [ASSUMPTION], assumptionCount: 1 }))}
        onOpenTarget={onOpenTarget}
      />,
    );
    const group = screen.getByRole("group", { name: ASSUMPTIONS_GROUP_LABEL });
    await userEvent.click(within(group).getByRole("button", { name: /^Go to / }));
    expect(onOpenTarget).toHaveBeenCalledWith(ASSUMPTION.id);
  });
});
