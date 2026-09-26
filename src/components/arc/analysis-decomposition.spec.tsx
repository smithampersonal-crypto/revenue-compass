// @vitest-environment jsdom
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { QueryClient } from "@tanstack/react-query";
import { buildWorkpaper } from "@/lib/arc/persistence/snapshot";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ContractBalancesView } from "@/components/arc/ContractBalancesView";
import { RevenueScheduleView } from "@/components/arc/RevenueScheduleView";
import { ReviewFinalizeView } from "@/components/arc/ReviewFinalizeView";
import { JournalEntryOutputs } from "@/components/asc606-workflow/JournalEntryOutputs";
import { formatCents } from "@/lib/asc606";
import {
  analyzeContractBalanceWorkflow,
  analyzeWorkflow,
  createEmptyDraft,
  createMaterialRightPoDraft,
  createPoDraft,
  createPromiseDraft,
  performanceObligationDisplayLabel,
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
    expect(await screen.findByRole("heading", { name: "Revenue Schedule" })).toBeInTheDocument();
    expect(screen.queryByText(/Revenue schedule \(engine output\)/i)).toBeNull();
    expect(
      screen.getAllByText(formatCents(result.revenueSchedule!.totalCents)).length,
    ).toBeGreaterThan(0);
  });

  it("labels revenue-source columns from canonical presentation metadata", () => {
    const draft = createDemoDraft("apex");
    const result = analyzeWorkflow(draft);
    render(<RevenueScheduleView draft={draft} result={result} />);
    for (const po of draft.performanceObligations) {
      expect(screen.getAllByText(performanceObligationDisplayLabel(po)).length).toBeGreaterThan(0);
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
    expect(screen.getByText("Variable Consideration")).toBeInTheDocument();
    expect(screen.getByText("Allocation Layers")).toBeInTheDocument();
    expect(screen.queryByText(/\(engine output\)/i)).toBeNull();
    // Reconciliation is centralized in Review & Finalize.
    expect(screen.queryByText("Variable-Consideration Reconciliation")).not.toBeInTheDocument();
  });

  it("keeps variable-consideration reconciliation in Review & Finalize", () => {
    const draft = case7Draft();
    const wp = buildWorkpaper(draft);
    render(
      <ReviewFinalizeView result={wp.workflow} balances={wp.balances} journals={wp.journals} />,
    );
    expect(screen.getByText("Variable-Consideration Reconciliation")).toBeInTheDocument();
  });

  it("retains the material-right lifecycle output on the Revenue Schedule", () => {
    const draft = materialRightDraft();
    const result = analyzeWorkflow(draft);
    expect(result.lifecycle).not.toBeNull();
    render(<RevenueScheduleView draft={draft} result={result} />);
    expect(screen.getByText("Material Rights")).toBeInTheDocument();
    expect(screen.queryByText(/Material rights \(engine output\)/i)).toBeNull();
    expect(screen.getByText("Customer renewal option")).toBeInTheDocument();
    expect(screen.getByText("80.00%")).toBeInTheDocument();
  });
});

describe("Phase 3 — Contract Modification detail", () => {
  it("renders the detailed modification output exactly once, inside Additional Topics", async () => {
    await renderAt("/analysis?sample=meridian");
    const headings = screen.getAllByText("Contract Modification Results");
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
    expect((await screen.findAllByText("Billing Schedule")).length).toBeGreaterThan(1);
    expect(screen.getByText("Contract-Balance Reconciliation")).toBeInTheDocument();
    expect(screen.queryByText(/\(engine output\)/i)).toBeNull();
  });

  it("shows separate group balances plus a gross combined presentation", async () => {
    await renderAt("/analysis/balances?sample=meridian");
    const combined = await screen.findByText("Combined Contract Balances — Gross Presentation");
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

  it("renders one editable billing schedule plus one ordinary engine schedule", async () => {
    const draft = createDemoDraft("horizon");
    render(
      <ContractBalancesView
        draft={draft}
        result={analyzeWorkflow(draft)}
        balances={analyzeContractBalanceWorkflow(draft)}
        onChange={() => {}}
      />,
    );
    expect(screen.getAllByText("Billing Schedule")).toHaveLength(2);
  });

  it("renders one editable billing schedule plus one engine schedule per Meridian group", async () => {
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
    const grouped = balances.grouped;
    if (!grouped) throw new Error("Expected grouped Meridian balances.");
    expect(screen.getAllByText("Billing Schedule")).toHaveLength(grouped.groups.length + 1);
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
    const reconciliation = screen.getByText("Combined Journal Reconciliation");
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
    expect(await screen.findByText("Validation Checks")).toBeInTheDocument();
    expect(screen.getByText("All validation checks passed")).toBeInTheDocument();
    expect(screen.getByText("No blocking issues were identified.")).toBeInTheDocument();
    const passedDisclosure = screen.getByText("Show passed checks").closest("details");
    expect(passedDisclosure).not.toBeNull();
    expect(passedDisclosure).not.toHaveAttribute("open");
    expect(
      screen.getByText("Show technical validation details").closest("details"),
    ).not.toHaveAttribute("open");
    expect(screen.queryByText(/Engine validation/i)).toBeNull();
    expect(screen.getAllByText(/reconciliation/i).length).toBeGreaterThan(0);
    expect(screen.getByText("Billing and Contract-Balance Workpaper")).toBeInTheDocument();
  });

  it("groups supplied validation severities without changing their order or semantics", async () => {
    const user = userEvent.setup();
    const draft = createDemoDraft("horizon");
    const wp = buildWorkpaper(draft);
    const checks = [
      {
        id: "warning.first",
        category: "contract" as const,
        severity: "warning" as const,
        passed: false,
        message: "First warning fixture.",
      },
      {
        id: "pass.first",
        category: "allocation" as const,
        severity: "blocking" as const,
        passed: true,
        message: "First passed fixture.",
      },
      {
        id: "po.exists",
        category: "performance_obligations" as const,
        severity: "blocking" as const,
        passed: true,
        message: "Performance obligation fixture.",
      },
      {
        id: "accounting_horizon.supported_range",
        category: "revenue" as const,
        severity: "blocking" as const,
        passed: true,
        message: "Accounting horizon fixture.",
      },
      {
        id: "blocking.first",
        category: "contract" as const,
        severity: "blocking" as const,
        passed: false,
        message: "First blocking fixture.",
      },
      {
        id: "warning.second",
        category: "revenue" as const,
        severity: "warning" as const,
        passed: false,
        message: "Second warning fixture.",
      },
      {
        id: "blocking.second",
        category: "performance_obligations" as const,
        severity: "blocking" as const,
        passed: false,
        message: "Second blocking fixture.",
      },
    ];
    const originalChecks = structuredClone(checks);
    render(
      <ReviewFinalizeView
        result={{
          ...wp.workflow,
          engineValidation: {
            status: "attention",
            results: checks,
            blockingFailures: checks.filter(
              (check) => !check.passed && check.severity === "blocking",
            ),
          },
        }}
        balances={wp.balances}
        journals={wp.journals}
      />,
    );
    const blocking = screen.getByRole("heading", { name: "Blocking issues" }).parentElement;
    const warnings = screen.getByRole("heading", { name: "Warnings" }).parentElement;
    expect(blocking).not.toBeNull();
    expect(warnings).not.toBeNull();
    expect(
      within(blocking as HTMLElement)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["First blocking fixture.", "Second blocking fixture."]);
    expect(
      within(warnings as HTMLElement)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["First warning fixture.", "Second warning fixture."]);
    expect(
      (blocking as HTMLElement).compareDocumentPosition(warnings as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const disclosureLabel = screen.getByText("Show passed checks");
    const disclosure = disclosureLabel.closest("details");
    expect(disclosure).not.toHaveAttribute("open");
    expect(screen.queryByText("warning.first", { exact: false })).not.toBeInTheDocument();
    expect(screen.queryByText("blocking.first", { exact: false })).not.toBeInTheDocument();
    await user.click(disclosureLabel);
    expect(disclosure).toHaveAttribute("open");
    expect(screen.getByRole("heading", { name: "Other validation checks" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Performance obligations" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Accounting period" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Contract setup" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Standalone selling prices" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/PASS —/)).not.toBeInTheDocument();
    const technicalLabel = screen.getByText("Show technical validation details");
    const technicalDisclosure = technicalLabel.closest("details");
    expect(technicalDisclosure).not.toHaveAttribute("open");
    await user.click(technicalLabel);
    const technicalItems = within(technicalDisclosure as HTMLElement).getAllByRole("listitem");
    expect(technicalItems.map((item) => item.textContent)).toEqual([
      "pass.first: First passed fixture.",
      "po.exists: Performance obligation fixture.",
      "accounting_horizon.supported_range: Accounting horizon fixture.",
    ]);
    expect(checks).toEqual(originalChecks);
  });

  it("omits the passed-check disclosure when no passed result exists", () => {
    const draft = createDemoDraft("horizon");
    const wp = buildWorkpaper(draft);
    const failed = {
      id: "blocking.only",
      category: "contract" as const,
      severity: "blocking" as const,
      passed: false,
      message: "Blocking fixture.",
    };
    render(
      <ReviewFinalizeView
        result={{
          ...wp.workflow,
          engineValidation: {
            status: "attention",
            results: [failed],
            blockingFailures: [failed],
          },
        }}
        balances={wp.balances}
        journals={wp.journals}
      />,
    );
    expect(screen.queryByText("Show passed checks")).not.toBeInTheDocument();
  });

  it("uses recruiter-facing copy when analysis inputs cannot be assembled", () => {
    const draft = createDemoDraft("horizon");
    const wp = buildWorkpaper(draft);
    render(
      <ReviewFinalizeView
        result={{
          ...wp.workflow,
          adapterErrors: ["Synthetic adapter fixture."],
        }}
        balances={wp.balances}
        journals={wp.journals}
      />,
    );
    expect(screen.getByText("Analysis Inputs Could Not Be Assembled")).toBeInTheDocument();
    expect(screen.queryByText("Engine Input Could Not Be Assembled")).toBeNull();
  });

  it("uses Journal Validation Checks for blocked journal output", () => {
    render(
      <JournalEntryOutputs
        analysis={{
          validation: {
            status: "attention",
            results: [
              {
                id: "journal.fixture",
                category: "phase3",
                severity: "blocking",
                message: "Synthetic journal validation fixture.",
                passed: false,
              },
            ],
            blockingFailures: [],
          },
          entries: null,
          ledgerByMonth: null,
          reconciliation: {
            allEntriesBalanced: null,
            monthlyBalancesTie: null,
            revenueByPoTies: null,
            sourceEventsComplete: null,
            reconciled: null,
          },
        }}
        poNames={new Map()}
      />,
    );
    expect(screen.getByText("Journal Validation Checks")).toBeInTheDocument();
    expect(screen.queryByText("Journal engine validation")).toBeNull();
    // 3D-P: the reconciliation tile is replaced by the summary bar, which is
    // not fabricated for blocked output.
    expect(screen.queryByRole("heading", { name: "Journal Entries — Reconciliation" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Journal Entries summary" })).toBeNull();
    expect(screen.queryByText("Journal Entries — reconciliation")).toBeNull();
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
