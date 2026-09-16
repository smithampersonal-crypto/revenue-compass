// @vitest-environment jsdom
/**
 * Phase 9E — Task 9B. Projected contractual collections must never be
 * presented as observed cash, in the editable workpaper, in the contract
 * balances, or in the deterministic journal entries — including after
 * finalization, when the presentation is driven by the recorded snapshot.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { buildWorkpaper } from "@/lib/arc/persistence/snapshot";
import { createCashCollectionDraft, type WorkflowDraft } from "@/lib/asc606-workflow";
import { scenarioADraft } from "@/lib/asc606-workflow/__tests__/fixtures";

import { ContractBalancesView } from "./ContractBalancesView";
import { JournalEntriesView } from "./JournalEntriesView";

function draftWith(basis: "actual" | "projected_contract_due_date"): WorkflowDraft {
  const base = scenarioADraft();
  return {
    ...base,
    contractBalances: {
      considerationEvents: [
        {
          id: "ce-1",
          seq: 1,
          amountInput: "120,000.00",
          unconditionalRightDate: "2027-01-01",
          invoiceDate: "2027-01-01",
          amountSource: "manual",
          sourceComponentId: null,
          sourceMonth: "",
        },
      ],
      cashCollections: [
        {
          ...createCashCollectionDraft(1, "cc-1"),
          considerationEventId: "ce-1",
          amountInput: "120,000.00",
          collectionDate: "2027-01-31",
          basis,
        },
      ],
    },
  };
}

describe("projected collection presentation", () => {
  it("labels a projected cash row and discloses it in the contract balances", () => {
    const draft = draftWith("projected_contract_due_date");
    const paper = buildWorkpaper(draft);
    render(
      <ContractBalancesView
        draft={draft}
        result={paper.workflow}
        balances={paper.balances}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId("cash-basis-cc-1")).toHaveTextContent(
      "Projected — contractual due date",
    );
    expect(screen.getByText(/not evidence that cash was received/i)).toBeInTheDocument();
    expect(
      screen.getByText(/includes projected contractual collections/i),
    ).toBeInTheDocument();
  });

  it("labels an actual cash row as actual and adds no projection disclosure", () => {
    const draft = draftWith("actual");
    const paper = buildWorkpaper(draft);
    render(
      <ContractBalancesView
        draft={draft}
        result={paper.workflow}
        balances={paper.balances}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId("cash-basis-cc-1")).toHaveTextContent("Actual cash");
    expect(screen.getByTestId("cash-basis-cc-1")).not.toHaveTextContent("Projected");
    expect(screen.queryByText(/includes projected contractual collections/i)).toBeNull();
  });

  it("marks the projected cash journal entry as illustrative", () => {
    const draft = draftWith("projected_contract_due_date");
    const paper = buildWorkpaper(draft);
    render(
      <JournalEntriesView draft={draft} result={paper.workflow} journals={paper.journals} />,
    );
    expect(screen.getByText("Projected Cash Collection — Illustrative")).toBeInTheDocument();
    expect(screen.queryByText(/^Cash Collection$/)).toBeNull();
  });

  it("keeps an actual cash journal entry labelled as an ordinary cash collection", () => {
    const draft = draftWith("actual");
    const paper = buildWorkpaper(draft);
    render(
      <JournalEntriesView draft={draft} result={paper.workflow} journals={paper.journals} />,
    );
    expect(screen.getByText("Cash Collection")).toBeInTheDocument();
    expect(screen.queryByText(/Illustrative/)).toBeNull();
  });

  it("preserves the projected basis for a finalized/read-only recorded revision", () => {
    // A finalized revision renders from the recorded snapshot. The basis still
    // comes from the recorded canonical input — a past date on a finalized
    // revision is never re-interpreted as actual cash.
    const draft = draftWith("projected_contract_due_date");
    const recorded = buildWorkpaper(draft);
    render(
      <JournalEntriesView draft={draft} result={recorded.workflow} journals={recorded.journals} />,
    );
    expect(screen.getByText("Projected Cash Collection — Illustrative")).toBeInTheDocument();
  });
});
