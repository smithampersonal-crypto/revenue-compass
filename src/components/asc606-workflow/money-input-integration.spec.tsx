// @vitest-environment jsdom
/**
 * Package 2C-G. Eligible cent-denominated USD fields read professionally.
 *
 * These tests drive the shipped components the way an accountant does. They
 * prove three things: blur-time grouping is presentation only (the canonical
 * draft, its provenance and the deterministic accounting results are all
 * untouched), real typing still flows through the existing state paths, and
 * per-unit rate fields are deliberately excluded from this tranche.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { AiReviewTargetProvider } from "@/components/arc/AiReviewTarget";
import { createDemoDraft } from "@/lib/demo-scenarios";
import {
  analyzeContractBalanceWorkflow,
  analyzeWorkflow,
  createEmptyDraft,
  createModificationDraft,
  type WorkflowDraft,
} from "@/lib/asc606-workflow";
import { genomixBenchmarkDraft } from "@/lib/asc606-workflow/__tests__/genomix-k-fixture";

import { BillingAndBalances } from "./BillingAndBalances";
import { ContractModifications } from "./ContractModifications";
import { Step3TransactionPrice } from "./Step3TransactionPrice";
import { Step4Allocation } from "./Step4Allocation";

function mountStep(
  Component: (props: {
    draft: WorkflowDraft;
    onChange: (draft: WorkflowDraft) => void;
  }) => React.ReactElement,
  initial: WorkflowDraft,
  wrap: (node: React.ReactElement) => React.ReactElement = (node) => node,
) {
  const state = { draft: initial };
  function Harness() {
    const [draft, setDraft] = useState(initial);
    state.draft = draft;
    return wrap(<Component draft={draft} onChange={setDraft} />);
  }
  render(<Harness />);
  return state;
}

/* ------------------------------------------- provenance is never fabricated */

describe("formatting-only blur is not an accountant edit", () => {
  const aiWorkspace = {
    reviewItems: [],
    fieldProvenance: {
      "transactionPrice.input": { state: "ai_generated_untouched" as const },
    },
    objectProvenance: {},
  };

  it("keeps AI provenance, the canonical value and the accounting results intact", () => {
    const initial: WorkflowDraft = {
      ...createDemoDraft("horizon"),
      transactionPriceInput: "505001.96",
    };
    const before = analyzeWorkflow(initial);
    const state = mountStep(Step3TransactionPrice, initial, (node) => (
      <AiReviewTargetProvider workspace={aiWorkspace}>{node}</AiReviewTargetProvider>
    ));

    const target = document.querySelector(
      '[data-ai-review-target="transactionPrice.input"]',
    ) as HTMLElement;
    expect(within(target).getByLabelText("AI drafted")).toBeInTheDocument();
    expect(within(target).queryByLabelText("AI drafted · edited")).toBeNull();

    const input = within(target).getByLabelText(/Fixed consideration \(USD\)/) as HTMLInputElement;
    expect(input.value).toBe("505,001.96");

    fireEvent.focus(input);
    expect(input.value).toBe("505001.96");
    fireEvent.blur(input);
    expect(input.value).toBe("505,001.96");

    expect(state.draft).toBe(initial);
    expect(state.draft.transactionPriceInput).toBe("505001.96");
    expect(within(target).getByLabelText("AI drafted")).toBeInTheDocument();
    expect(within(target).queryByLabelText("AI drafted · edited")).toBeNull();
    expect(analyzeWorkflow(state.draft)).toEqual(before);
  });

  it("still records a real accountant edit through the ordinary state path", () => {
    const initial: WorkflowDraft = {
      ...createDemoDraft("horizon"),
      transactionPriceInput: "505001.96",
    };
    const state = mountStep(Step3TransactionPrice, initial, (node) => (
      <AiReviewTargetProvider workspace={aiWorkspace}>{node}</AiReviewTargetProvider>
    ));
    const input = screen.getByLabelText(/Fixed consideration \(USD\)/) as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "600000" } });
    expect(input.value).toBe("600000");
    expect(state.draft.transactionPriceInput).toBe("600000");
    fireEvent.blur(input);
    expect(input.value).toBe("600,000.00");
    expect(state.draft.transactionPriceInput).toBe("600000");
  });
});

/* --------------------------------------------- representative call sites */

describe("eligible USD fields format on blur without changing their state paths", () => {
  it("Step 4 SSP", () => {
    const state = mountStep(Step4Allocation, createDemoDraft("horizon"));
    const target = document.querySelector(
      '[data-ai-review-target="po:po-saas.sspInput"]',
    ) as HTMLElement;
    const input = within(target).getByLabelText("SSP (USD)") as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "150000.5" } });
    expect(state.draft.performanceObligations[0]?.sspInput).toBe("150000.5");
    fireEvent.blur(input);
    expect(input.value).toBe("150,000.50");
    expect(state.draft.performanceObligations[0]?.sspInput).toBe("150000.5");
  });

  it("billing and cash amounts", () => {
    const base = createDemoDraft("horizon");
    const initial: WorkflowDraft = {
      ...base,
      contractBalances: {
        ...base.contractBalances,
        cashCollections: [
          ...base.contractBalances.cashCollections,
          {
            ...base.contractBalances.cashCollections[0]!,
            id: "cash-2cg",
            amountInput: "120000",
          },
        ],
      },
    };
    const state = { draft: initial };
    function Harness() {
      const [draft, setDraft] = useState(initial);
      state.draft = draft;
      return (
        <BillingAndBalances
          draft={draft}
          onChange={setDraft}
          balances={analyzeContractBalanceWorkflow(draft)}
          contractGroups={analyzeWorkflow(draft).contractGroups}
        />
      );
    }
    render(<Harness />);

    const target = document.querySelector(
      '[data-ai-review-target="cash:cash-2cg.amountInput"]',
    ) as HTMLElement;
    const input = within(target).getByLabelText("Amount (USD)") as HTMLInputElement;
    expect(input.value).toBe("120,000.00");
    fireEvent.focus(input);
    expect(input.value).toBe("120000");
    fireEvent.change(input, { target: { value: "35100.5" } });
    fireEvent.blur(input);
    expect(input.value).toBe("35,100.50");
    expect(
      state.draft.contractBalances.cashCollections.find((row) => row.id === "cash-2cg")
        ?.amountInput,
    ).toBe("35100.5");
  });

  it("contract-modification change in consideration", () => {
    const base = createEmptyDraft();
    const initial: WorkflowDraft = {
      ...base,
      hasContractModifications: true,
      contractModifications: [
        { ...createModificationDraft(1), considerationMagnitudeInput: "505001.96" },
      ],
    };
    const state = mountStep(ContractModifications, initial);
    const input = screen.getByLabelText(/Change in consideration \(USD\)/) as HTMLInputElement;
    expect(input.value).toBe("505,001.96");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "1.005" } });
    fireEvent.blur(input);
    expect(input.value).toBe("1.005");
    expect(state.draft.contractModifications[0]?.considerationMagnitudeInput).toBe("1.005");
  });
});

/* ------------------------------------------------------- explicit exclusion */

describe("per-unit rate amounts are excluded from 2C-G formatting", () => {
  it("leaves the usage meter rate exactly as entered after blur", () => {
    const state = mountStep(Step3TransactionPrice, genomixBenchmarkDraft());
    const rate = screen.getAllByLabelText("Rate amount (USD)")[0] as HTMLInputElement;

    fireEvent.focus(rate);
    fireEvent.change(rate, { target: { value: "1250.5" } });
    fireEvent.blur(rate);
    expect(rate.value).toBe("1250.5");
    const meterValues = state.draft.variableConsiderationComponents.flatMap((component) =>
      component.meters.map((meter) => meter.rateAmountInput),
    );
    expect(meterValues).toContain("1250.5");
    expect(meterValues).not.toContain("1,250.50");
  });
});
