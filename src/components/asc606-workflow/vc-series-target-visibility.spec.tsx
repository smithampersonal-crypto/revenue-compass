// @vitest-environment jsdom
/**
 * The target selector must never render a stored relationship as though none
 * existed. An already-linked obligation that is ineligible (not classified as
 * a series) stays visible and is marked ineligible, alongside the deterministic
 * consistency warning. The stored target is not changed to satisfy the UI.
 */
import { render, screen } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { describe, expect, it } from "vitest";

import type { WorkflowDraft } from "@/lib/asc606-workflow";
import { genomixR3Draft } from "@/lib/asc606-workflow/__tests__/genomix-r3-fixture";

import { Step3TransactionPrice } from "./Step3TransactionPrice";

function mount(initial: WorkflowDraft) {
  const state: { draft: WorkflowDraft } = { draft: initial };
  function Harness() {
    const [draft, setDraft] = useState(initial);
    state.draft = draft;
    const Component = Step3TransactionPrice as unknown as (props: {
      draft: WorkflowDraft;
      onChange: (next: WorkflowDraft) => void;
    }) => ReactElement;
    return <Component draft={draft} onChange={setDraft} />;
  }
  render(<Harness />);
  return state;
}

function inconsistent(): WorkflowDraft {
  const draft = genomixR3Draft();
  return {
    ...draft,
    performanceObligations: draft.performanceObligations.map((po) =>
      po.id === "po-hosted" ? { ...po, classification: "single_distinct" as const } : po,
    ),
  };
}

describe("series-period target visibility", () => {
  it("shows an incompatible existing target instead of hiding the relationship", () => {
    const state = mount(inconsistent());
    const option = screen.getByRole("option", {
      name: /Hosted SaaS platform · 1\/1\/2027–12\/31\/2027 — not classified as a Series \(ineligible\)/,
    }) as HTMLOptionElement;
    expect(option.value).toBe("po-hosted");
    const select = option.closest("select") as HTMLSelectElement;
    expect(select.value).toBe("po-hosted");
    // Rendering never mutates the stored judgment.
    expect(state.draft.variableConsiderationComponents[0]!.targetPoId).toBe("po-hosted");
  });

  it("labels an eligible series target plainly", () => {
    mount(genomixR3Draft());
    expect(
      screen.getByRole("option", { name: "Hosted SaaS platform · 1/1/2027–12/31/2027" }),
    ).toBeDefined();
  });
});
