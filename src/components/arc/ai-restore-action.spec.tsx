// @vitest-environment jsdom
/**
 * Phase 9G — Task 9C. Explicit whole-run restore, as the accountant meets it.
 *
 * The offer is server-declared, the consequences are stated before anything
 * happens, and one confirmation produces exactly one restore attempt.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AiRestoreAction } from "./AiRestoreAction";
import type { AiWorkspaceController } from "@/hooks/use-ai-workspace-controller";
import type { AiWorkspaceStateDto } from "@/lib/arc/ai/workspace.handlers";

const baseWorkspace: AiWorkspaceStateDto = {
  hasAnalysis: true,
  activeRun: null,
  latestRun: null,
  lastSuccessfulRunId: "run-1",
  sourceState: "current",
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
  restorableRun: { runId: "run-1", completedAt: "2026-09-18T10:00:00.000Z" },
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
    openReviewEvidence: vi.fn(async () => null),
    getReviewGuidance: vi.fn(async () => null),
    restoreAnalysis: vi.fn(async () => undefined),
    pendingEvidence: new Set<string>(),
    restoring: false,
    refresh: vi.fn(async () => undefined),
    ...overrides,
  };
}

const UNDO = { name: /Undo AI analysis from/ };

describe("Task 9C restore action", () => {
  it("offers nothing at all when the server declares no restorable run", () => {
    const { container } = render(
      <AiRestoreAction ai={controller({ ...baseWorkspace, restorableRun: null })} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("offers nothing before the AI workspace has loaded", () => {
    const { container } = render(<AiRestoreAction ai={controller(null)} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("states what is replaced and what is untouched before anything happens", async () => {
    const user = userEvent.setup();
    const ai = controller(baseWorkspace);
    render(<AiRestoreAction ai={ai} />);

    await user.click(screen.getByRole("button", UNDO));
    expect(
      screen.getByText(/entire current analysis will be replaced by the exact version/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Every change you made after that run will be lost/i)).toBeInTheDocument();
    expect(
      screen.getByText(/source documents, your remaining monthly AI analyses and your/i),
    ).toBeInTheDocument();
    // Opening the confirmation is not restoring.
    expect(ai.restoreAnalysis).not.toHaveBeenCalled();
  });

  it("restores exactly the offered run, exactly once, only after confirmation", async () => {
    const user = userEvent.setup();
    const ai = controller(baseWorkspace);
    render(<AiRestoreAction ai={ai} />);

    await user.click(screen.getByRole("button", UNDO));
    await user.click(screen.getByRole("button", { name: "Undo AI analysis" }));

    await waitFor(() => expect(ai.restoreAnalysis).toHaveBeenCalledTimes(1));
    expect(ai.restoreAnalysis).toHaveBeenCalledWith({ expectedRunId: "run-1" });
  });

  it("changes nothing when the accountant keeps the current version", async () => {
    const user = userEvent.setup();
    const ai = controller(baseWorkspace);
    render(<AiRestoreAction ai={ai} />);

    await user.click(screen.getByRole("button", UNDO));
    await user.click(screen.getByRole("button", { name: "Keep current version" }));
    expect(ai.restoreAnalysis).not.toHaveBeenCalled();
  });

  it("cannot be started while an AI run is executing or a restore is in flight", () => {
    const active = controller(baseWorkspace, { active: true });
    const { unmount } = render(<AiRestoreAction ai={active} />);
    expect(screen.getByRole("button", UNDO)).toBeDisabled();
    unmount();

    render(<AiRestoreAction ai={controller(baseWorkspace, { restoring: true })} />);
    const button = screen.getByRole("button", UNDO);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });
});
