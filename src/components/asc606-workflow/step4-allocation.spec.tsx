// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { createDemoDraft } from "@/lib/demo-scenarios";
import {
  createMaterialRightPoDraft,
  previewAllocation,
  type WorkflowDraft,
} from "@/lib/asc606-workflow";

import { Step4Allocation } from "./Step4Allocation";

function mount(initial: WorkflowDraft) {
  const state: { draft: WorkflowDraft } = { draft: initial };
  function Harness() {
    const [draft, setDraft] = useState(initial);
    state.draft = draft;
    return <Step4Allocation draft={draft} onChange={setDraft} />;
  }
  render(<Harness />);
  return state;
}

describe("Step 4 allocation presentation", () => {
  it("shows one concise heading and preserves standard-PO target bindings", () => {
    const initial = createDemoDraft("horizon");
    const expectedAllocation = previewAllocation(initial).rows?.map((row) => [
      row.poId,
      row.allocatedCents,
    ]);
    const state = mount(initial);

    expect(screen.getByText("Hosted SaaS Access · 7/1/2027–6/30/2028")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Transaction Price Allocation" })).toBeInTheDocument();
    expect(screen.queryByText("Engine allocation (read-only)")).toBeNull();
    expect(screen.queryByLabelText("SSP (USD) — Hosted SaaS Access")).toBeNull();

    const sspTarget = document.querySelector('[data-ai-review-target="po:po-saas.sspInput"]');
    const basisTarget = document.querySelector('[data-ai-review-target="po:po-saas.sspBasis"]');
    expect(sspTarget).not.toBeNull();
    expect(basisTarget).not.toBeNull();
    if (!sspTarget || !basisTarget) return;

    fireEvent.change(within(sspTarget as HTMLElement).getByLabelText("SSP (USD)"), {
      target: { value: "150,000.00" },
    });
    fireEvent.change(
      within(basisTarget as HTMLElement).getByLabelText("SSP Basis / Documentation"),
      { target: { value: "  Exact observable-price evidence.  " } },
    );

    expect(state.draft.performanceObligations[0]?.sspInput).toBe("150,000.00");
    expect(state.draft.performanceObligations[0]?.sspBasis).toBe(
      "  Exact observable-price evidence.  ",
    );
    expect(expectedAllocation).toEqual([
      ["po-saas", 10_800_000],
      ["po-training", 900_000],
      ["po-support", 1_800_000],
    ]);
  });

  it("retains material-right inputs and deterministic estimated SSP without raw SSP editing", () => {
    const initial = createDemoDraft("redwood");
    const right = {
      ...createMaterialRightPoDraft(2, "po-option"),
      name: "Discounted Renewal Option",
      benefitAmountInput: "24,000.00",
      exerciseProbabilityInput: "80",
      sspBasis: "Incremental discount weighted for exercise.",
    };
    mount({
      ...initial,
      performanceObligations: [...initial.performanceObligations, right],
    });

    expect(screen.getByText("Discounted Renewal Option — Material Right")).toBeInTheDocument();
    expect(screen.getByLabelText("Economic benefit of the option (USD)")).toHaveValue("24,000.00");
    expect(screen.getByLabelText("Exercise probability at inception (%)")).toHaveValue("80");
    expect(screen.getAllByLabelText("SSP Basis / Documentation")).toHaveLength(2);
    expect(screen.getByText(/Estimated SSP \(engine\):/)).toBeInTheDocument();
    expect(screen.getByText(/\$19,200\.00/)).toBeInTheDocument();
    expect(screen.getAllByLabelText("SSP (USD)")).toHaveLength(1);
  });
});