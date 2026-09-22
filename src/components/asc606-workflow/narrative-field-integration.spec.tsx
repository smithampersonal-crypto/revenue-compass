// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { createDemoDraft } from "@/lib/demo-scenarios";
import type { WorkflowDraft } from "@/lib/asc606-workflow";

import { Step1Contract } from "./Step1Contract";
import { Step3TransactionPrice } from "./Step3TransactionPrice";

function mount(
  Component: (props: {
    draft: WorkflowDraft;
    onChange: (draft: WorkflowDraft) => void;
  }) => ReactNode,
) {
  const initial = createDemoDraft("horizon");
  const state: { draft: WorkflowDraft } = { draft: initial };
  function Harness() {
    const [draft, setDraft] = useState(initial);
    state.draft = draft;
    return <Component draft={draft} onChange={setDraft} />;
  }
  render(<Harness />);
  return state;
}

describe("workflow narrative fields", () => {
  it("preserves Step 1 rationale target and exact canonical value", () => {
    const state = mount(Step1Contract);
    const target = document.querySelector(
      '[data-ai-review-target="contract.criteria.approval_and_commitment.rationale"]',
    );
    expect(target).not.toBeNull();
    if (!target) return;
    const textarea = within(target as HTMLElement).getByLabelText("Rationale / comment");
    expect(textarea.tagName).toBe("TEXTAREA");
    fireEvent.change(textarea, { target: { value: "  Exact approval rationale.  " } });
    expect(state.draft.contract.criteria.approval_and_commitment.rationale).toBe(
      "  Exact approval rationale.  ",
    );
  });

  it("uses narratives for Step 3 notes while keeping component Description concise", () => {
    const state = mount(Step3TransactionPrice);
    const notesTarget = document.querySelector('[data-ai-review-target="transactionPrice.notes"]');
    expect(notesTarget).not.toBeNull();
    if (!notesTarget) return;
    const notes = within(notesTarget as HTMLElement).getByLabelText("Transaction price notes (optional)");
    expect(notes.tagName).toBe("TEXTAREA");
    fireEvent.change(notes, { target: { value: "Detailed transaction-price support." } });
    expect(state.draft.transactionPriceNotes).toBe("Detailed transaction-price support.");

    const descriptions = screen.queryAllByLabelText("Description");
    for (const description of descriptions) expect(description.tagName).toBe("INPUT");
  });
});