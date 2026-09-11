// @vitest-environment jsdom
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { QueryClient } from "@tanstack/react-query";
import { buildWorkpaper } from "@/lib/arc/persistence/snapshot";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ContractBalancesView } from "@/components/arc/ContractBalancesView";
import { RevenueScheduleView } from "@/components/arc/RevenueScheduleView";
import { ReviewFinalizeView } from "@/components/arc/ReviewFinalizeView";
import { formatCents } from "@/lib/asc606";
import {
  analyzeContractBalanceWorkflow,
  analyzeWorkflow,
  createEmptyDraft,
  createMaterialRightPoDraft,
  createPoDraft,
  createPromiseDraft,
  type PoDraft,
  type WorkflowDraft,
} from "@/lib/asc606-workflow";
import { answerAllStep1 } from "@/lib/asc606-workflow/__tests__/fixtures";
import { case7Draft } from "@/lib/asc606-workflow/__tests__/vc-fixtures";
import { createDemoDraft } from "@/lib/demo-scenarios";
import { routeTree } from "@/routeTree.gen";

async function renderAt(initialPath: string) {
  const router = createRouter({
    routeTree,
    context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
  render(<RouterProvider router={router} />);
  await screen.findByRole("navigation", { name: "Analysis areas" });
  return router;
}

/** Case 6 material-right facts, reproduced locally for presentation tests. */
function materialRightDraft(): WorkflowDraft {
  const base = answerAllStep1(createEmptyDraft());
  const saasPo: PoDraft = {
    ...createPoDraft(1, "po-saas"),
    name: "Annual SaaS subscription",
    classification: "single_distinct",
    classificationRationale: "Single distinct hosted service.",
    sspInput: "120,000.00",
    sspBasis: "Observable standalone renewal pricing.",
    recognitionMethod: "over_time_ratable",
    serviceStart: "2027-01-01",
    serviceEnd: "2027-12-31",
    recognitionRationale: "Customer simultaneously receives and consumes the hosted service.",
  };
  const rightPo: PoDraft = {
    ...createMaterialRightPoDraft(2, "po-option"),
    name: "Customer renewal option",
    underlyingGoodOrServiceName: "Renewal SaaS",
    benefitAmountInput: "24,000.00",
    exerciseProbabilityInput: "80",
    sspBasis: "Incremental discount versus standalone renewal pricing.",
  };
  return {
    ...base,
    contract: { ...base.contract, customerName: "Redwood Retail", contractNumber: "MR-1" },
    transactionPriceInput: "144,000.00",
    promises: [
      {
        ...createPromiseDraft(1, "pr-saas"),
        description: "Annual hosted SaaS service",
        capableOfBeingDistinct: true,
        distinctWithinContractContext: true,
        distinctRationale: "Benefit available on its own.",
        performanceObligationId: saasPo.id,
      },
      {
        ...createPromiseDraft(2, "pr-option"),
        kind: "customer_option" as const,
        description: "Option to renew for a second year",
        conveysMaterialRight: true,
        materialRightRationale: "The discount is incremental to discounts typically offered.",
        performanceObligationId: rightPo.id,
      },
    ],
    performanceObligations: [saasPo, rightPo],
  };
}

describe("Phase 3 — Revenue Schedule", () => {
  it("shows the authoritative engine total for a standard sample", async () => {
    const result = analyzeWorkflow(createDemoDraft("apex"));
    expect(result.revenueSchedule).not.toBeNull();
    await renderAt("/analysis/schedule?sample=apex");
    expect(await screen.findByText("Revenue schedule (engine output)")).toBeInTheDocument();
    expect(
      screen.getAllByText(formatCents(result.revenueSchedule!.totalCents)).length,
    ).toBeGreaterThan(0);
  });

  it("labels revenue-source columns from engine-supplied identities", () => {
    const draft = createDemoDraft("apex");
    const result = analyzeWorkflow(draft);
    render(<RevenueScheduleView draft={draft} result={result} />);
    for (const source of result.revenueSources) {
      expect(screen.getAllByText(source.name).length).toBeGreaterThan(0);
    }
  });

  it("shows draft-oriented wording and no table when the analysis is blocked", () => {
    const draft = createEmptyDraft();
    const result = analyzeWorkflow(draft);
    const { container } = render(<RevenueScheduleView draft={draft} result={result} />);
    expect(
      screen.getByText(
        /No revenue schedule is available until the outstanding analysis items are resolved./,
      ),
    ).toBeInTheDocument();
    expect(container.querySelectorAll("table")).toHaveLength(0);
  });

  it("contains neither balance nor journal tables", async () => {
    await renderAt("/analysis/schedule?sample=horizon");
    expect(screen.queryByText(/Billing schedule \(engine output\)/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Journal entries \(engine output\)/i)).not.toBeInTheDocument();
  });

  it("keeps the Meridian modification figures available", async () => {
    const result = analyzeWorkflow(createDemoDraft("meridian"));
    expect(result.modification?.historicalCutoffDate).toBe("2027-06-30");
    expect(result.modification?.totals.historicalRevenueCents).toBe(5_942_544);
    expect(result.modification?.totals.lifecycleConsiderationCents).toBe(33_000_000);
    expect(result.modification?.totals.futureRevenueCents).toBe(27_057_456);
  });
});

describe("Phase 3 — supporting engine output", () => {
  it("retains variable-consideration output on the Revenue Schedule", () => {
    const draft = case7Draft();
    const result = analyzeWorkflow(draft);
    expect(result.variableConsideration).not.toBeNull();
    render(<RevenueScheduleView draft={draft} result={result} />);
    expect(screen.getByText("Variable consideration (engine output)")).toBeInTheDocument();
    // Reconciliation is centralized in Review & Finalize.
    expect(
      screen.queryByText("Variable-consideration reconciliation (engine output)"),
    ).not.toBeInTheDocument();
  });

  it("keeps variable-consideration reconciliation in Review & Finalize", () => {
    const draft = case7Draft();
    const wp = buildWorkpaper(draft);
    render(
      <ReviewFinalizeView result={wp.workflow} balances={wp.balances} journals={wp.journals} />,
    );
    expect(
      screen.getByText("Variable-consideration reconciliation (engine output)"),
    ).toBeInTheDocument();
  });

  it("retains the material-right lifecycle output on the Revenue Schedule", () => {
    const draft = materialRightDraft();
    const result = analyzeWorkflow(draft);
    expect(result.lifecycle).not.toBeNull();
    render(<RevenueScheduleView draft={draft} result={result} />);
    expect(screen.getByText("Material rights (engine output)")).toBeInTheDocument();
    expect(screen.getByText("Customer renewal option")).toBeInTheDocument();
    expect(screen.getByText("80.00%")).toBeInTheDocument();
  });
});

describe("Phase 3 — Contract Modification detail", () => {
  it("renders the detailed modification output exactly once, inside Additional Topics", async () => {
    await renderAt("/analysis?sample=meridian");
    const headings = screen.getAllByText("Contract modification results (engine output)");
    expect(headings).toHaveLength(1);
    const topic = document.getElementById("topic-modifications");
    expect(topic).not.toBeNull();
    for (const heading of headings) {
      expect(topic!.contains(heading)).toBe(true);
    }
  });
});

describe("Phase 3 — Contract Balances", () => {
  it("renders ordinary engine balance output", async () => {
    await renderAt("/analysis/balances?sample=horizon");
    expect(await screen.findByText("Billing schedule (engine output)")).toBeInTheDocument();
    expect(screen.getByText("Contract-balance reconciliation (engine output)")).toBeInTheDocument();
  });

  it("shows separate group balances plus a gross combined presentation", async () => {
    await renderAt("/analysis/balances?sample=meridian");
    const combined = await screen.findByText("Combined contract balances — gross presentation");
    expect(combined).toBeInTheDocument();
    expect(screen.getByText(/Contract asset \(gross\)/)).toBeInTheDocument();
    expect(screen.getByText(/Contract liability \(gross\)/)).toBeInTheDocument();
    expect(
      screen.getAllByText(/Billing, receivables and contract balances — /).length,
    ).toBeGreaterThan(1);
  });

  it("does not present journal entries", async () => {
    await renderAt("/analysis/balances?sample=horizon");
    expect(screen.queryByText(/Journal entries \(engine output\)/i)).not.toBeInTheDocument();
  });

  it("renders exactly one billing schedule for an ordinary contract", async () => {
    const draft = createDemoDraft("horizon");
    render(
      <ContractBalancesView
        draft={draft}
        result={analyzeWorkflow(draft)}
        balances={analyzeContractBalanceWorkflow(draft)}
        onChange={() => {}}
      />,
    );
    expect(screen.getAllByText("Billing schedule (engine output)")).toHaveLength(1);
  });

  it("renders one billing schedule per engine group for Meridian", async () => {
    const draft = createDemoDraft("meridian");
    const balances = analyzeContractBalanceWorkflow(draft);
    expect(balances.grouped).not.toBeNull();
    render(
      <ContractBalancesView
        draft={draft}
        result={analyzeWorkflow(draft)}
        balances={analyzeContractBalanceWorkflow(draft)}
        onChange={() => {}}
      />,
    );
    expect(screen.getAllByText("Billing schedule (engine output)")).toHaveLength(
      balances.grouped!.groups.length,
    );
  });

  it("renders each balance blocking issue exactly once when blocked", () => {
    const draft = createDemoDraft("horizon");
    const blocked = {
      ...draft,
      contractBalances: { ...draft.contractBalances, considerationEvents: [], cashCollections: [] },
    };
    const balances = analyzeContractBalanceWorkflow(blocked);
    const issue = balances.validation.blocking[0];
    expect(issue).toBeDefined();
    render(
      <ContractBalancesView
        draft={blocked}
        result={analyzeWorkflow(blocked)}
        balances={balances}
        onChange={() => {}}
      />,
    );
    expect(screen.getAllByText(issue!.message)).toHaveLength(1);
  });

  it("exposes no finalization terminology when the workpaper is blocked", () => {
    const draft = createEmptyDraft();
    const { container } = render(
      <ContractBalancesView
        draft={draft}
        result={analyzeWorkflow(draft)}
        balances={analyzeContractBalanceWorkflow(draft)}
        onChange={() => {}}
      />,
    );
    expect(container.textContent ?? "").not.toMatch(/finalized/i);
  });
});

describe("Phase 3 — Journal Entries", () => {
  it("renders ordinary journal output", async () => {
    await renderAt("/analysis/journals?sample=horizon");
    expect((await screen.findAllByText(/Journal Entries/)).length).toBeGreaterThan(1);
    expect(screen.getAllByText("Debit").length).toBeGreaterThan(0);
  });

  it("renders one journal table per group and a combined reconciliation only", async () => {
    await renderAt("/analysis/journals?sample=meridian");
    const grouped = await screen.findAllByText(/Journal Entries — /);
    expect(grouped.length).toBeGreaterThan(1);
    const reconciliation = screen.getByText("Combined journal reconciliation");
    expect(reconciliation).toBeInTheDocument();
    expect(screen.getByText("Overall grouped reconciliation")).toBeInTheDocument();
  });

  it("contains no billing edit controls", async () => {
    const { container } = render(<div />);
    void container;
    await renderAt("/analysis/journals?sample=horizon");
    const main = document.querySelector("main") ?? document.body;
    expect(within(main).queryByText(/Billing and cash inputs/i)).not.toBeInTheDocument();
    expect(within(main).queryByRole("button", { name: /add consideration event/i })).toBeNull();
  });
});

describe("Phase 3 — Review & Finalize", () => {
  it("shows validation and reconciliation status in one place", async () => {
    await renderAt("/analysis/review?sample=horizon");
    expect(await screen.findByText("Engine validation")).toBeInTheDocument();
    expect(screen.getAllByText(/reconciliation/i).length).toBeGreaterThan(0);
    expect(screen.getByText("Billing and contract-balance workpaper")).toBeInTheDocument();
  });

  it("never exposes legacy finalized-analysis wording for a blocked draft", () => {
    const draft = createEmptyDraft();
    const wp = buildWorkpaper(draft);
    const { container } = render(
      <ReviewFinalizeView result={wp.workflow} balances={wp.balances} journals={wp.journals} />,
    );
    expect(container.textContent ?? "").not.toMatch(/finalized/i);
  });
});
