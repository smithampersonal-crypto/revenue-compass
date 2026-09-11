// @vitest-environment jsdom
/**
 * Phase 7D — Step 2 presentation shows the authoritative warnings it is given.
 * For a finalized or superseded revision those are the recorded warnings, so
 * the component must never run the current workflow validation itself.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createEmptyDraft, type WorkflowIssue } from "@/lib/asc606-workflow";

const validateWorkflow = vi.fn();
vi.mock("@/lib/asc606-workflow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/asc606-workflow")>();
  return {
    ...actual,
    validateWorkflow: (draft: unknown) => {
      validateWorkflow(draft);
      return actual.validateWorkflow(draft as never);
    },
  };
});

const { Step2PerformanceObligations } = await import("./Step2PerformanceObligations");

const RECORDED: WorkflowIssue[] = [
  { id: "recorded-2b", step: "2b", severity: "warning", message: "Recorded Step 2B warning" },
];

describe("Step 2 performance obligations warnings", () => {
  it("renders the supplied recorded warnings and never validates the draft itself", () => {
    validateWorkflow.mockClear();
    render(
      <Step2PerformanceObligations
        draft={createEmptyDraft()}
        onChange={() => {}}
        warnings={RECORDED}
      />,
    );
    expect(screen.getByText("Recorded Step 2B warning")).toBeInTheDocument();
    expect(validateWorkflow).not.toHaveBeenCalled();
  });
});
