// @vitest-environment jsdom
/**
 * Phase 9G — Task 8. Accountant-facing source-freshness presentation.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AiSourceFreshnessNotice } from "./AiSourceFreshnessNotice";
import type { AiWorkspaceController } from "@/hooks/use-ai-workspace-controller";
import type { AiWorkspaceStateDto } from "@/lib/arc/ai/workspace.handlers";

const baseWorkspace: AiWorkspaceStateDto = {
  hasAnalysis: true,
  activeRun: null,
  latestRun: null,
  lastSuccessfulRunId: "run-1",
  sourceState: "stale",
  hasIncludedSources: true,
  sourceSetFingerprint: "fingerprint-abc",
  reviewIssueCount: 0,
  reviewItems: [],
  reviewPayloadMalformed: false,
  fieldProvenance: {},
  objectProvenance: {},
  staleSourceAcknowledged: false,
  allowance: { scope: "authenticated", limit: 10, used: 1, remaining: 9, resetAt: null },
  failure: null,
};

function controller(
  workspace: AiWorkspaceStateDto | null,
  overrides: Partial<AiWorkspaceController> = {},
): AiWorkspaceController {
  return {
    workspace,
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
    refresh: vi.fn(async () => undefined),
    ...overrides,
  };
}

const ACK = { name: "Acknowledge source changes" };

describe("Task 8 source freshness notice", () => {
  it("renders nothing when AI has never successfully run", () => {
    const { container } = render(
      <AiSourceFreshnessNotice
        ai={controller({ ...baseWorkspace, hasAnalysis: false, sourceState: "none" })}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows only a restrained status when the analysis matches the sources", () => {
    render(
      <AiSourceFreshnessNotice ai={controller({ ...baseWorkspace, sourceState: "current" })} />,
    );
    expect(
      screen.getByText("AI analysis matches the currently selected source documents."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", ACK)).not.toBeInTheDocument();
  });

  it("warns, explains and offers acknowledgment when stale", () => {
    render(<AiSourceFreshnessNotice ai={controller(baseWorkspace)} />);
    expect(
      screen.getByText("Source documents changed since the last AI analysis."),
    ).toBeInTheDocument();
    expect(screen.getByText(/may reflect an earlier set of documents/i)).toBeInTheDocument();
    expect(screen.getByText(/does not update the AI analysis/i)).toBeInTheDocument();
    expect(screen.getByRole("button", ACK)).toBeEnabled();
  });

  it("stays visibly stale after acknowledgment and offers no second acknowledgment", () => {
    render(
      <AiSourceFreshnessNotice
        ai={controller({ ...baseWorkspace, staleSourceAcknowledged: true })}
      />,
    );
    expect(screen.getByText("Source changes acknowledged.")).toBeInTheDocument();
    expect(screen.getByText(/still reflects an earlier source set/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", ACK)).not.toBeInTheDocument();
  });

  it("calls only the controller action, never optimistically acknowledging", async () => {
    const released: Array<() => void> = [];
    const acknowledgeStaleSources = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          released.push(resolve);
        }),
    );
    const ai = controller(baseWorkspace, { acknowledgeStaleSources });
    render(<AiSourceFreshnessNotice ai={ai} />);

    await userEvent.click(screen.getByRole("button", ACK));
    const button = screen.getByRole("button", ACK);
    expect(acknowledgeStaleSources).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    // Authoritative state has not changed, so the notice has not either.
    expect(
      screen.getByText("Source documents changed since the last AI analysis."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Source changes acknowledged.")).not.toBeInTheDocument();
    expect(ai.analyze).not.toHaveBeenCalled();

    released.forEach((resolve) => resolve());
    await waitFor(() => expect(screen.getByRole("button", ACK)).toBeEnabled());
  });

  it("issues exactly one request for two rapid clicks", async () => {
    const acknowledgeStaleSources = vi.fn(() => new Promise<void>(() => undefined));
    const ai = controller(baseWorkspace, { acknowledgeStaleSources });
    render(<AiSourceFreshnessNotice ai={ai} />);
    const button = screen.getByRole("button", ACK);
    await Promise.all([userEvent.click(button), userEvent.click(button)]);
    expect(acknowledgeStaleSources).toHaveBeenCalledTimes(1);
  });

  it("keeps the stale state visible but disables acknowledgment during an AI run", async () => {
    const ai = controller(baseWorkspace, {
      active: true,
      locks: { analyze: true, reviewActions: true, sourceDocuments: true, finalize: true },
    });
    render(<AiSourceFreshnessNotice ai={ai} />);
    expect(
      screen.getByText("Source documents changed since the last AI analysis."),
    ).toBeInTheDocument();
    const button = screen.getByRole("button", ACK);
    expect(button).toBeDisabled();
    expect(
      screen.getByText("Source acknowledgment is available after the current analysis finishes."),
    ).toBeInTheDocument();
    await userEvent.click(button, { pointerEventsCheck: 0 });
    expect(ai.acknowledgeStaleSources).not.toHaveBeenCalled();
  });

  it("stays stale with zero included sources and never starts AI", async () => {
    const ai = controller({ ...baseWorkspace, hasIncludedSources: false });
    render(<AiSourceFreshnessNotice ai={ai} />);
    expect(
      screen.getByText("Source documents changed since the last AI analysis."),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", ACK));
    expect(ai.acknowledgeStaleSources).toHaveBeenCalledTimes(1);
    expect(ai.analyze).not.toHaveBeenCalled();
  });

  it("never renders the source-set fingerprint", () => {
    const { container } = render(<AiSourceFreshnessNotice ai={controller(baseWorkspace)} />);
    expect(container.innerHTML).not.toContain("fingerprint-abc");
  });

  it("points at the existing re-analysis action rather than adding one", () => {
    render(<AiSourceFreshnessNotice ai={controller(baseWorkspace)} />);
    expect(screen.queryByRole("button", { name: /Re-analyze/i })).not.toBeInTheDocument();
  });
});
