// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import {
  analyzeContractBalanceWorkflow,
  analyzeWorkflow,
  createCashCollectionDraft,
  createConsiderationEventDraft,
  createEmptyDraft,
  createModificationDraft,
  type ContractBalanceWorkflowResult,
  type WorkflowDraft,
} from "@/lib/asc606-workflow";
import { createDemoDraft } from "@/lib/demo-scenarios";

import { BillingAndBalances } from "./BillingAndBalances";
import { ContractModifications } from "./ContractModifications";
import { buildFriendlyBalanceLabels, groupBalanceIssues } from "./billing-presentation";

function billingDraft(): WorkflowDraft {
  const base = createDemoDraft("horizon");
  const events = [
    {
      ...createConsiderationEventDraft(8, "ce-private-first"),
      amountInput: "60000",
      unconditionalRightDate: "2027-01-01" as const,
      invoiceDate: "2027-01-01" as const,
    },
    {
      ...createConsiderationEventDraft(3, "ce-private-second"),
      amountInput: "45500",
      unconditionalRightDate: "2027-02-01" as const,
      invoiceDate: "2027-02-01" as const,
    },
  ];
  const cashCollections = [
    {
      ...createCashCollectionDraft(9, "cc-private-first"),
      considerationEventId: "ce-private-first",
      amountInput: "25000",
      collectionDate: "2027-01-15" as const,
    },
    {
      ...createCashCollectionDraft(2, "cc-private-second"),
      considerationEventId: "ce-private-second",
      amountInput: "10000",
      collectionDate: "2027-02-15" as const,
    },
  ];
  return { ...base, contractBalances: { considerationEvents: events, cashCollections } };
}

function mountBilling(
  initial = billingDraft(),
  validation?: ContractBalanceWorkflowResult["validation"],
) {
  const state = { draft: initial };
  function Harness() {
    const [draft, setDraft] = useState(initial);
    state.draft = draft;
    const calculated = analyzeContractBalanceWorkflow(draft);
    return (
      <BillingAndBalances
        draft={draft}
        onChange={setDraft}
        balances={validation ? { ...calculated, validation } : calculated}
        contractGroups={analyzeWorkflow(draft).contractGroups}
      />
    );
  }
  const rendered = render(<Harness />);
  return { ...rendered, state };
}

describe("Package 2C-I contract-modification header", () => {
  it("uses one responsive grid with naturally aligned control rows", () => {
    const base = createEmptyDraft();
    const initial = {
      ...base,
      hasContractModifications: true,
      contractModifications: [createModificationDraft(1)],
    };
    render(<ContractModifications draft={initial} onChange={() => {}} />);

    const header = screen.getByTestId("modification-commercial-header");
    expect(header).toHaveClass("grid", "md:grid-cols-2", "md:items-stretch");
    expect(within(header).getByLabelText("Modification effective date")).toHaveClass("mt-auto");
    expect(within(header).getByLabelText("Change in consideration (USD)").parentElement).toHaveClass(
      "mt-auto",
      "grid",
    );
    expect(header.className).not.toMatch(/h-\[|min-h-\[/);
  });

  it("keeps effective date, amount, and direction on their canonical paths", () => {
    const base = createEmptyDraft();
    const initial = {
      ...base,
      hasContractModifications: true,
      contractModifications: [createModificationDraft(1)],
    };
    const state = { draft: initial };
    function Harness() {
      const [draft, setDraft] = useState(initial);
      state.draft = draft;
      return <ContractModifications draft={draft} onChange={setDraft} />;
    }
    render(<Harness />);

    fireEvent.change(screen.getByLabelText("Modification effective date"), {
      target: { value: "2028-03-01" },
    });
    fireEvent.change(screen.getByLabelText("Change in consideration (USD)"), {
      target: { value: "125000" },
    });
    fireEvent.change(screen.getByLabelText("Change direction"), {
      target: { value: "decrease" },
    });

    expect(state.draft.contractModifications[0]).toMatchObject({
      modificationDate: "2028-03-01",
      considerationMagnitudeInput: "125000",
      considerationEffect: "decrease",
    });
  });
});

describe("Package 2C-I friendly billing presentation", () => {
  it("uses rendered-order aliases while retaining canonical selector values and updates", () => {
    const { container, state } = mountBilling();

    expect(screen.getByText("Billing Event 1")).toBeInTheDocument();
    expect(screen.getByText("Billing Event 2")).toBeInTheDocument();
    expect(screen.getByText("Cash Collection 1")).toBeInTheDocument();
    expect(screen.getByText("Cash Collection 2")).toBeInTheDocument();
    expect(container.textContent).not.toContain("ce-private-");
    expect(container.textContent).not.toContain("cc-private-");

    const selectors = screen.getAllByLabelText("Related billing event") as HTMLSelectElement[];
    const firstSelector = selectors[0];
    if (!firstSelector) throw new Error("Expected the first related-event selector.");
    const firstOption = within(firstSelector).getByRole("option", {
      name: "Billing Event 1 — $60,000.00",
    }) as HTMLOptionElement;
    expect(firstOption.value).toBe("ce-private-first");
    fireEvent.change(firstSelector, { target: { value: "ce-private-second" } });
    expect(state.draft.contractBalances.cashCollections[0]?.considerationEventId).toBe(
      "ce-private-second",
    );
  });

  it("shows restrained orphan copy without reassigning the canonical reference", () => {
    const initial = billingDraft();
    const firstCollection = initial.contractBalances.cashCollections[0];
    if (!firstCollection) throw new Error("Expected the first cash collection fixture.");
    initial.contractBalances.cashCollections[0] = {
      ...firstCollection,
      considerationEventId: "ce-missing-private",
    };
    const { state, container } = mountBilling(initial);
    const selector = screen.getAllByLabelText("Related billing event")[0];
    if (!(selector instanceof HTMLSelectElement)) {
      throw new Error("Expected the first related-event selector.");
    }

    expect(within(selector).getByRole("option", { name: "Unavailable billing event" })).toHaveValue(
      "ce-missing-private",
    );
    expect(selector.value).toBe("ce-missing-private");
    expect(state.draft.contractBalances.cashCollections[0]?.considerationEventId).toBe(
      "ce-missing-private",
    );
    expect(container.textContent).not.toContain("ce-missing-private");
  });

  it("groups exact-prefix findings in row order without dropping issues or changing severity", () => {
    const initial = billingDraft();
    const validation: ContractBalanceWorkflowResult["validation"] = {
      issues: [],
      blocking: [
        { id: "billing.event.amount", severity: "blocking", message: "Billing event ce-private-second: Amount is required." },
        { id: "billing.event.invoice_date", severity: "blocking", message: "Billing event ce-private-second: Billing date is required." },
        { id: "global.block", severity: "blocking", message: "Global blocking finding." },
      ],
      warnings: [
        { id: "cash.warning", severity: "warning", message: "Cash collection cc-private-first: Confirm the collection evidence." },
      ],
    };
    validation.issues = [...validation.blocking, ...validation.warnings];
    const { container } = mountBilling(initial, validation);

    const billingGroup = screen.getByText("Billing Event 2 — resolve these items").parentElement;
    expect(billingGroup).not.toBeNull();
    expect(within(billingGroup as HTMLElement).getAllByRole("listitem")).toHaveLength(2);
    expect(within(billingGroup as HTMLElement).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Amount is required.",
      "Billing date is required.",
    ]);
    expect(screen.getByText("Cash Collection 1 — warnings")).toBeInTheDocument();
    expect(screen.getByText("Global blocking finding.")).toBeInTheDocument();
    expect(container.textContent).not.toContain("ce-private-second");
    expect(container.textContent).not.toContain("cc-private-first");

    const grouped = groupBalanceIssues(validation.issues, buildFriendlyBalanceLabels(
      initial.contractBalances.considerationEvents,
      initial.contractBalances.cashCollections,
    ));
    expect(grouped.billing.get("ce-private-second")?.map((issue) => issue.severity)).toEqual([
      "blocking",
      "blocking",
    ]);
    expect(grouped.cash.get("cc-private-first")?.[0]?.severity).toBe("warning");
  });
});