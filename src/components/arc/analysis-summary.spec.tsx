// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";

import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { QueryClient } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { buildAnalysisSummary } from "@/lib/arc/analysis-summary";
import { FEATURES } from "@/lib/arc/features";
import { formatCents } from "@/lib/asc606";
import {
  analyzeWorkflow,
  createEmptyDraft,
  createMaterialRightPoDraft,
  type WorkflowDraft,
} from "@/lib/asc606-workflow";
import { case7Draft } from "@/lib/asc606-workflow/__tests__/vc-fixtures";
import { createDemoDraft, getDemoScenario } from "@/lib/demo-scenarios";
import { routeTree } from "@/routeTree.gen";

function summaryFor(draft: WorkflowDraft, origin: "manual" | "sample" = "manual") {
  return buildAnalysisSummary({
    draft,
    result: analyzeWorkflow(draft),
    origin,
    scenario: origin === "sample" ? getDemoScenario("redwood") : null,
  });
}

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

function summaryRegion() {
  return screen.getByRole("region", { name: "Analysis summary" });
}

describe("Analysis summary view model (Phase 4)", () => {
  it("labels a manual analysis Draft Analysis and a sample as a fictional sample", () => {
    expect(summaryFor(createEmptyDraft()).originLabel).toBe("Draft Analysis");
    expect(summaryFor(createDemoDraft("redwood"), "sample").originLabel).toBe(
      "Sample Analysis — Fictional Contract",
    );
  });

  it("never produces a Finalized product state", () => {
    for (const id of ["redwood", "apex", "horizon", "stellar", "meridian"] as const) {
      const summary = summaryFor(createDemoDraft(id), "sample");
      expect(JSON.stringify(summary)).not.toMatch(/finaliz/i);
    }
  });

  it("renders identity when populated and omits it cleanly when blank", () => {
    expect(summaryFor(createEmptyDraft()).identity).toEqual([]);
    const identity = summaryFor(createDemoDraft("redwood"), "sample").identity;
    expect(identity.map((i) => i.label)).toContain("Customer");
    expect(identity.every((i) => i.value.trim() !== "")).toBe(true);
  });

  it("counts performance obligations from the authoritative draft", () => {
    const draft = createDemoDraft("apex");
    const metric = summaryFor(draft, "sample").metrics.find(
      (m) => m.label === "Performance obligations",
    );
    expect(metric?.value).toBe(String(draft.performanceObligations.length));
  });

  it("shows the engine transaction price for an ordinary fixed-price sample", () => {
    const draft = createDemoDraft("redwood");
    const result = analyzeWorkflow(draft);
    const metric = summaryFor(draft, "sample").metrics.find((m) => m.label === "Transaction price");
    expect(metric?.value).toBe(formatCents(result.analysis!.totals.transactionPriceCents));
  });

  it("omits the single transaction-price headline for variable consideration", () => {
    const summary = summaryFor(case7Draft());
    expect(summary.metrics.some((m) => m.label === "Transaction price")).toBe(false);
  });

  it("omits the single transaction-price headline for a material right", () => {
    const base = createDemoDraft("redwood");
    const draft: WorkflowDraft = {
      ...base,
      performanceObligations: [
        ...base.performanceObligations,
        createMaterialRightPoDraft(base.performanceObligations.length + 1, "po-mr"),
      ],
    };
    expect(summaryFor(draft).metrics.some((m) => m.label === "Transaction price")).toBe(false);
  });

  it("presents Meridian modification consideration measures from the engine", () => {
    const draft = createDemoDraft("meridian");
    const result = analyzeWorkflow(draft);
    const totals = result.modification!.totals;
    const summary = summaryFor(draft, "sample");
    const value = (label: string) => summary.metrics.find((m) => m.label === label)?.value;

    expect(value("Original consideration")).toBe(
      formatCents(totals.originalTransactionPriceCents),
    );
    expect(value("Modification consideration")).toBe(formatCents(totals.considerationChangeCents));
    expect(value("Lifecycle consideration")).toBe(
      formatCents(totals.lifecycleConsiderationCents),
    );
    expect(value("Modification treatment")).toBe(result.modification!.classification!.label);
    expect(summary.metrics.some((m) => m.label === "Contract Value")).toBe(false);
    expect(summary.metrics.some((m) => m.label === "Transaction price")).toBe(false);
  });

  it("shows a recognition chip only when every obligation shares one method", () => {
    const draft = createDemoDraft("redwood");
    expect(summaryFor(draft, "sample").recognitionLabel).toBe("Over time");

    const mixed: WorkflowDraft = {
      ...draft,
      performanceObligations: draft.performanceObligations.map((po, index) =>
        index === 0 ? { ...po, recognitionMethod: "point_in_time" as const } : po,
      ),
    };
    const withExtra: WorkflowDraft = {
      ...mixed,
      performanceObligations: [
        ...mixed.performanceObligations,
        { ...draft.performanceObligations[0]!, id: "po-extra", seq: 99 },
      ],
    };
    expect(summaryFor(withExtra).recognitionLabel).toBeNull();

    const incomplete: WorkflowDraft = {
      ...draft,
      performanceObligations: draft.performanceObligations.map((po) => ({
        ...po,
        recognitionMethod: null,
      })),
    };
    expect(summaryFor(incomplete).recognitionLabel).toBeNull();
  });

  it("reports an outstanding-items state for an incomplete analysis", () => {
    const summary = summaryFor(createEmptyDraft());
    expect(summary.statusTone).not.toBe("ok");
    expect(summary.statusLabel).toMatch(/outstanding analysis item|Needs attention/);
    expect(summaryFor(createDemoDraft("redwood"), "sample").statusLabel).toBe("Draft complete");
  });

  it("does not call analyzeWorkflow in production summary code", () => {
    const files = ["src/lib/arc/analysis-summary.ts", "src/components/arc/AnalysisSummary.tsx"];
    for (const file of files) {
      const source = readFileSync(path.join(process.cwd(), file), "utf8");
      expect(source).not.toMatch(/analyzeWorkflow\s*\(/);
    }
  });
});

describe("Analysis summary in the workspace (Phase 4)", () => {
  it("keeps ?sample= when navigating to Review & Finalize from the summary", async () => {
    const user = userEvent.setup();
    const router = await renderAt("/analysis?sample=redwood");

    await user.click(within(summaryRegion()).getByRole("link", { name: /Review & Finalize/ }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/analysis/review");
    });
    expect(router.state.location.search).toEqual({ sample: "redwood" });
  });

  it("shows the Source Documents action according to its feature flag", async () => {
    await renderAt("/analysis");
    const action = within(summaryRegion()).queryByRole("link", { name: "Source Documents" });
    expect(Boolean(action)).toBe(FEATURES.SOURCE_DOCUMENTS);
  });

  it("restores canonical sample values on Reset Sample and keeps the sample URL", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const router = await renderAt("/analysis?sample=redwood");
    const canonical = createDemoDraft("redwood").contract.customerName;

    const customer = screen.getByLabelText(/customer/i) as HTMLInputElement;
    await user.clear(customer);
    await user.type(customer, "Edited Customer LLC");
    expect(customer).toHaveValue("Edited Customer LLC");

    await user.click(within(summaryRegion()).getByRole("button", { name: "Reset Sample" }));
    await waitFor(() => {
      expect(screen.getByLabelText(/customer/i)).toHaveValue(canonical);
    });
    expect(router.state.location.search).toEqual({ sample: "redwood" });
    expect(within(summaryRegion()).getByText("Sample Analysis — Fictional Contract")).toBeInTheDocument();
    confirm.mockRestore();
  });

  it("returns to an empty draft on manual Reset Analysis", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await renderAt("/analysis");

    const customer = screen.getByLabelText(/customer/i) as HTMLInputElement;
    await user.type(customer, "Typed Customer");
    await user.click(within(summaryRegion()).getByRole("button", { name: "Reset Analysis" }));

    await waitFor(() => {
      expect(screen.getByLabelText(/customer/i)).toHaveValue("");
    });
    confirm.mockRestore();
  });

  it("no longer renders the old Source: line or a bottom reset duplicate", async () => {
    await renderAt("/analysis?sample=redwood");
    expect(screen.queryByText(/^Source: /)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Reset (Analysis|Sample)$/ })).toHaveLength(1);
  });
});
