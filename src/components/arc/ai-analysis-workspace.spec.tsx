// @vitest-environment jsdom
import { readFileSync } from "node:fs";

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
  assumptionItems: [],
  assumptionCount: 0,
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
    ["preparing", 1, "Preparing documents", "Preparing Documents · Step 1 of 4", 0, 0, 12],
    ["analyzing", 2, "Analyzing contract", "Analyzing Contract · Step 2 of 4", 12, 12, 82],
    ["validating", 3, "Validating analysis", "Validating Analysis · Step 3 of 4", 82, 82, 92],
    ["applying", 4, "Updating workspace", "Updating Workspace · Step 4 of 4", 92, 92, 100],
  ] as const)(
    "renders %s with authoritative checkpoint metadata",
    (phase, step, label, headline, confirmedEnd, activityStart, activityEnd) => {
      const { container } = render(<AiAnalysisProgress progress={{ phase, step, label }} />);
      const status = screen.getByRole("status", { name: "AI analysis progress" });
      const track = screen.getByTestId("ai-progress-track");
      expect(status).toHaveTextContent(headline);
      expect(status).toHaveAttribute("data-phase", phase);
      expect(status).toHaveAttribute("data-step", String(step));
      expect(track).toHaveAttribute("data-step", String(step));
      expect(track).toHaveAttribute("data-confirmed-end", String(confirmedEnd));
      expect(track).toHaveAttribute("data-activity-start", String(activityStart));
      expect(track).toHaveAttribute("data-activity-end", String(activityEnd));
      expect(screen.getAllByTestId("ai-progress-track")).toHaveLength(1);
      expect(screen.getAllByTestId("ai-progress-confirmed")).toHaveLength(1);
      expect(screen.getAllByTestId("ai-progress-activity")).toHaveLength(1);
      expect(container.querySelector("ol")).not.toBeInTheDocument();
      expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    },
  );

  it("keeps the confirmed Step 2 boundary fixed when time passes", () => {
    vi.useFakeTimers();
    render(
      <AiAnalysisProgress
        progress={{ phase: "analyzing", step: 2, label: "Analyzing contract" }}
      />,
    );
    const track = screen.getByTestId("ai-progress-track");
    expect(track).toHaveAttribute("data-confirmed-end", "12");
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(track).toHaveAttribute("data-confirmed-end", "12");
    vi.useRealTimers();
  });

  it("shows no user-facing percentage or time estimate", () => {
    render(
      <AiAnalysisProgress
        progress={{ phase: "validating", step: 3, label: "Validating analysis" }}
      />,
    );
    const status = screen.getByRole("status", { name: "AI analysis progress" });
    expect(status).not.toHaveTextContent(/\d+%/);
    expect(status).not.toHaveTextContent(/(?:seconds?|minutes?) remaining|ETA/i);
  });

  it("uses only CSS motion for a separate localized front and disables all motion when reduced", () => {
    const componentSource = readFileSync(
      `${process.cwd()}/src/components/arc/AiAnalysisProgress.tsx`,
      "utf8",
    );
    const styles = readFileSync(`${process.cwd()}/src/styles.css`, "utf8");

    expect(componentSource).not.toMatch(/setInterval|setTimeout|requestAnimationFrame/);
    expect(componentSource).toContain("arc-ai-progress-confirmed");
    expect(componentSource).toContain("arc-ai-progress-activity");
    expect(styles).toContain(".arc-ai-progress-activity::after");
    expect(styles).toContain("animation: arc-ai-progress-activity-sweep");
    expect(styles).toMatch(/94%,[\s\S]*?100%[\s\S]*?opacity: 0/);
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.arc-ai-progress-confirmed[\s\S]*?transition: none[\s\S]*?\.arc-ai-progress-activity::after[\s\S]*?animation: none/,
    );
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
