// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { createDemoDraft } from "@/lib/demo-scenarios";
import type { WorkflowDraft } from "@/lib/asc606-workflow";

import { Step2PerformanceObligations } from "./Step2PerformanceObligations";
import { Step2Promises } from "./Step2Promises";

function mountPromises(initial: WorkflowDraft) {
  const state: { draft: WorkflowDraft } = { draft: initial };
  function Harness() {
    const [draft, setDraft] = useState(initial);
    state.draft = draft;
    return <Step2Promises draft={draft} onChange={setDraft} />;
  }
  render(<Harness />);
  return state;
}

function mountObligations(initial: WorkflowDraft) {
  const state: { draft: WorkflowDraft } = { draft: initial };
  function Harness() {
    const [draft, setDraft] = useState(initial);
    state.draft = draft;
    return <Step2PerformanceObligations draft={draft} onChange={setDraft} />;
  }
  render(<Harness />);
  return state;
}

describe("Step 2 display labels", () => {
  it("edits Name and Description / Interpretation independently", () => {
    const state = mountPromises(createDemoDraft("horizon"));
    const nameTarget = document.querySelector(
      '[data-ai-review-target="promise:promise-saas.displayName"]',
    );
    const descriptionTarget = document.querySelector(
      '[data-ai-review-target="promise:promise-saas.description"]',
    );
    expect(nameTarget).not.toBeNull();
    expect(descriptionTarget).not.toBeNull();
    if (!nameTarget || !descriptionTarget) return;

    expect(
      within(descriptionTarget as HTMLElement).getByLabelText("Description / Interpretation")
        .tagName,
    ).toBe("TEXTAREA");

    fireEvent.change(within(nameTarget as HTMLElement).getByLabelText("Name"), {
      target: { value: "Cloud Access" },
    });
    fireEvent.change(
      within(descriptionTarget as HTMLElement).getByLabelText("Description / Interpretation"),
      { target: { value: "Detailed hosted-service interpretation" } },
    );

    expect(state.draft.promises[0]?.displayName).toBe("Cloud Access");
    expect(state.draft.promises[0]?.description).toBe("Detailed hosted-service interpretation");
    expect(screen.getByText("Cloud Access · 7/1/2027–6/30/2028")).toBeInTheDocument();
  });

  it("uses concise dated labels while retaining canonical assignment IDs", () => {
    const state = mountObligations(createDemoDraft("horizon"));
    expect(screen.getAllByText("Hosted SaaS Access · 7/1/2027–6/30/2028").length).toBeGreaterThan(
      0,
    );
    expect(
      screen.getAllByText("Implementation Training · 7/10/2027–7/11/2027").length,
    ).toBeGreaterThan(0);

    const select = screen.getByLabelText(
      "Performance obligation for Hosted SaaS Access · 7/1/2027–6/30/2028",
    ) as HTMLSelectElement;
    expect(select.value).toBe("po-saas");
    expect(
      within(select).getByRole("option", {
        name: "Implementation Training · 7/10/2027–7/11/2027",
      }),
    ).toHaveValue("po-training");

    fireEvent.change(select, { target: { value: "po-training" } });
    expect(state.draft.promises[0]?.performanceObligationId).toBe("po-training");
  });
});
