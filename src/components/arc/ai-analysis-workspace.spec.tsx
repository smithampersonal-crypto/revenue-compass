// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AiAnalysisAction } from "./AiAnalysisAction";
import { AiAnalysisProgress } from "./AiAnalysisProgress";
import type { AiWorkspaceController } from "@/hooks/use-ai-workspace-controller";
import type { AiWorkspaceStateDto } from "@/lib/arc/ai/workspace.handlers";

const baseWorkspace: AiWorkspaceStateDto = {
  hasAnalysis: false,
  activeRun: null,
  latestRun: null,
  lastSuccessfulRunId: null,
  sourceState: "current",
  hasIncludedSources: true,
  sourceSetFingerprint: "source-fingerprint",
  reviewIssueCount: 0,
  reviewItems: [],
  reviewPayloadMalformed: false,
  fieldProvenance: {},
  objectProvenance: {},
  staleSourceAcknowledged: false,
  allowance: { scope: "authenticated", limit: 10, used: 7, remaining: 3, resetAt: null },
  failure: null,
  restorableRun: null,
};

function controller(overrides: Partial<AiWorkspaceController> = {}): AiWorkspaceController {
  return {
    workspace: baseWorkspace,
    loadState: "ready",
    actionState: "idle",
    active: false,
    progress: null,
    analyzeMode: "analyze",
    locks: { analyze: false, reviewActions: false, sourceDocuments: false, finalize: false },
    message: null,
    analyze: vi.fn(async () => undefined),
    affirmReviewItem: vi.fn(async () => undefined),
    resolveReviewIssue: vi.fn(async () => undefined),
    acknowledgeStaleSources: vi.fn(async () => undefined),
    openReviewEvidence: vi.fn(async () => null),
    getReviewGuidance: vi.fn(async () => null),
    restoreAnalysis: vi.fn(async () => undefined),
    pendingEvidence: new Set<string>(),
    restoring: false,
    refresh: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("Task 6 AI analysis action", () => {
  it("uses the authoritative mode and invokes only the controller action once", async () => {
    const ai = controller();
    render(<AiAnalysisAction ai={ai} />);
    const button = screen.getByRole("button", { name: "Analyze Contract" });
    expect(screen.getByText("3 of 10 analyses remaining")).toBeInTheDocument();
    await userEvent.click(button);
    expect(ai.analyze).toHaveBeenCalledTimes(1);
  });

  it("renders Re-analyze only when the controller says so", () => {
    render(<AiAnalysisAction ai={controller({ analyzeMode: "reanalyze" })} />);
    expect(screen.getByRole("button", { name: "Re-analyze Contract" })).toBeEnabled();
  });

  it("uses settled requesting copy and disables the action", () => {
    render(
      <AiAnalysisAction
        ai={controller({
          actionState: "requesting",
          locks: { analyze: true, reviewActions: true, sourceDocuments: true, finalize: true },
        })}
      />,
    );
    expect(screen.getByRole("button", { name: "Preparing analysis…" })).toBeDisabled();
  });

  it("does not flicker an Analyze label while loading", () => {
    render(<AiAnalysisAction ai={controller({ workspace: null, loadState: "loading" })} />);
    expect(screen.getByRole("button", { name: "Loading AI analysis…" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Analyze Contract" })).not.toBeInTheDocument();
  });

  it("shows safe load failure copy and refreshes without reloading the page", async () => {
    const refresh = vi.fn(async () => undefined);
    render(
      <AiAnalysisAction
        ai={controller({
          workspace: null,
          loadState: "error",
          message: "AI analysis is unavailable right now. Reload the analysis and try again.",
          refresh,
        })}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("AI analysis is unavailable right now");
    await userEvent.click(screen.getByRole("button", { name: "Retry AI status" }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("disables at zero authoritative allowance and never calls analyze", async () => {
    const analyze = vi.fn(async () => undefined);
    render(
      <AiAnalysisAction
        ai={controller({
          analyze,
          workspace: {
            ...baseWorkspace,
            allowance: { ...baseWorkspace.allowance, used: 10, remaining: 0 },
          },
        })}
      />,
    );
    expect(screen.getByRole("button", { name: "Analyze Contract" })).toBeDisabled();
    expect(screen.getByText("AI analysis limit reached.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Analyze Contract" }));
    expect(analyze).not.toHaveBeenCalled();
  });

  it("renders only settled failure copy and keeps the unlocked action available", () => {
    const hostile = "service_role failed SQLSTATE 40001 gpt-5.6-terra prompt-v4";
    render(
      <AiAnalysisAction
        ai={controller({
          workspace: {
            ...baseWorkspace,
            hasAnalysis: true,
            failure: {
              category: "workspace_conflict",
              headline: "Re-analysis failed · Previous analysis preserved",
              whatHappened: "The workspace changed before ARC could safely apply the analysis.",
              impact: "Your previous AI analysis and your current workspace were preserved.",
              whatYouCanDo:
                "Review the current changes and run the analysis again if you still want an updated AI analysis.",
              allowance: "This attempt used one AI analysis from your allowance.",
            },
          },
          analyzeMode: "reanalyze",
        })}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("current workspace were preserved");
    expect(alert).toHaveTextContent("run the analysis again");
    expect(screen.queryByText(hostile)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Re-analyze Contract" })).toBeEnabled();
  });
});

describe("Task 6 active progress", () => {
  it.each([
    ["preparing", 1, "Preparing documents"],
    ["analyzing", 2, "Analyzing contract"],
    ["validating", 3, "Validating analysis"],
    ["applying", 4, "Updating workspace"],
  ] as const)("renders %s as the current phase", (phase, step, label) => {
    render(<AiAnalysisProgress progress={{ phase, step, label }} />);
    const status = screen.getByRole("status", { name: "AI analysis progress" });
    expect(status).toHaveTextContent(`Step ${step} of 4: ${label}`);
    expect(screen.getByText(label).closest("li")).toHaveAttribute("aria-current", "step");
    const items = screen.getAllByRole("listitem");
    items.slice(0, step - 1).forEach((item) => expect(item).toHaveTextContent("Complete"));
    items.slice(step).forEach((item) => expect(item).toHaveTextContent("Pending"));
  });
});

/**
 * Phase 9G — Task 6 source prerequisite. `sourceState` describes AI/source
 * freshness, never whether a contract PDF is included. The authoritative
 * presence fact is `hasIncludedSources`, derived server-side from the actual
 * selected source associations.
 */
describe("Task 6 source prerequisite", () => {
  it("allows the first analysis when a contract is included but no AI run exists", async () => {
    const analyze = vi.fn(async () => undefined);
    const onAddSources = vi.fn();
    render(
      <AiAnalysisAction
        ai={controller({
          analyze,
          workspace: { ...baseWorkspace, sourceState: "none", hasIncludedSources: true },
        })}
        onAddSources={onAddSources}
      />,
    );
    const button = screen.getByRole("button", { name: "Analyze Contract" });
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(onAddSources).not.toHaveBeenCalled();
  });

  it("routes a brand-new analysis with no contract into the upload experience", async () => {
    const analyze = vi.fn(async () => undefined);
    const onAddSources = vi.fn();
    render(
      <AiAnalysisAction
        ai={controller({
          analyze,
          workspace: { ...baseWorkspace, sourceState: "none", hasIncludedSources: false },
        })}
        onAddSources={onAddSources}
      />,
    );
    const button = screen.getByRole("button", { name: "Analyze Contract" });
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(onAddSources).toHaveBeenCalledTimes(1);
    expect(analyze).not.toHaveBeenCalled();
  });

  it("routes a stale prior analysis whose sources were all removed to the upload experience", async () => {
    const analyze = vi.fn(async () => undefined);
    const onAddSources = vi.fn();
    render(
      <AiAnalysisAction
        ai={controller({
          analyze,
          analyzeMode: "reanalyze",
          workspace: {
            ...baseWorkspace,
            hasAnalysis: true,
            sourceState: "stale",
            hasIncludedSources: false,
          },
        })}
        onAddSources={onAddSources}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Re-analyze Contract" }));
    expect(onAddSources).toHaveBeenCalledTimes(1);
    expect(analyze).not.toHaveBeenCalled();
  });

  it("re-analyzes normally when stale sources are still included", async () => {
    const analyze = vi.fn(async () => undefined);
    const onAddSources = vi.fn();
    render(
      <AiAnalysisAction
        ai={controller({
          analyze,
          analyzeMode: "reanalyze",
          workspace: {
            ...baseWorkspace,
            hasAnalysis: true,
            sourceState: "stale",
            hasIncludedSources: true,
          },
        })}
        onAddSources={onAddSources}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Re-analyze Contract" }));
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(onAddSources).not.toHaveBeenCalled();
  });
});
