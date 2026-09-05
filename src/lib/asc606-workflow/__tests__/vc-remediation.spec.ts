/**
 * Phase 5B remediation regressions at the workflow level.
 * All companies, customers and amounts are fictional.
 */

import { describe, expect, it } from "vitest";

import { analyzeWorkflow, previewAllocation } from "../analysis";
import { validateWorkflow } from "../validation";
import { createMaterialRightPoDraft, createPromiseDraft, createVcComponentDraft, type VcComponentDraft, type WorkflowDraft } from "../types";
import { scenarioADraft } from "./fixtures";
import { case7Draft, cloudAiDraft, payAsYouGoDraft } from "./vc-fixtures";

describe("zero fixed consideration", () => {
  it("is valid for a pay-as-you-go contract and recognizes only the usage", () => {
    const result = analyzeWorkflow(payAsYouGoDraft());
    expect(result.adapterErrors).toEqual([]);
    expect(result.finalized).toBe(true);
    expect(result.variableConsideration!.totals.fixedConsiderationCents).toBe(0);
    expect(result.variableConsideration!.totals.usageConsiderationCents).toBe(7_200);
    expect(result.revenueSchedule!.totalCents).toBe(7_200);
    expect(result.revenueSchedule!.byMonth.find((r) => r.month === "2027-01")!.totalCents).toBe(7_200);
    expect(result.variableConsideration!.reconciliation.reconciled).toBe(true);
  });

  it("still requires a positive transaction price on an ordinary fixed contract", () => {
    const issues = validateWorkflow({ ...scenarioADraft(), transactionPriceInput: "0.00" }).blocking;
    expect(issues.some((i) => i.id === "contract.transaction_price.valid")).toBe(true);
  });

  it("still rejects a negative amount", () => {
    const draft = { ...payAsYouGoDraft(), transactionPriceInput: "-1.00" };
    expect(
      validateWorkflow(draft).blocking.some((i) => i.id === "contract.transaction_price.valid"),
    ).toBe(true);
  });
});

describe("usage completeness at the workflow level", () => {
  it("blocks when a month of the service period has no row at all", () => {
    const draft = cloudAiDraft();
    const component = draft.variableConsiderationComponents[0]!;
    const result = analyzeWorkflow({
      ...draft,
      variableConsiderationComponents: [
        { ...component, usagePeriods: component.usagePeriods.filter((p) => p.month !== "2027-05") },
      ],
    });
    expect(result.finalized).toBe(false);
    expect(result.revenueSchedule).toBeNull();
  });
});

describe("Step 4 shows the engine allocation for a variable contract", () => {
  it("returns the engine's relative-SSP layer rather than a separate preview", () => {
    const preview = previewAllocation(case7Draft());
    expect(preview.rows?.map((r) => [r.poId, r.allocatedCents])).toEqual([
      ["po-implementation", 5_520_000],
      ["po-saas", 40_480_000],
    ]);
    expect(preview.totalAllocatedCents).toBe(46_000_000);
  });

  it("reports an issue rather than a stale fixed allocation when the inputs are incomplete", () => {
    const draft = case7Draft();
    const preview = previewAllocation({
      ...draft,
      variableConsiderationComponents: draft.variableConsiderationComponents.map((c) => ({
        ...c,
        allocationRationale: "",
      })),
    });
    expect(preview.rows).toBeNull();
    expect(preview.issues.length).toBeGreaterThan(0);
  });
});

/** Case 6 renewal option combined with a general variable bonus. */
function combinedDraft(): WorkflowDraft {
  const base = scenarioADraft();
  const right = {
    ...createMaterialRightPoDraft(2, "po-option"),
    name: "Discounted renewal option",
    underlyingGoodOrServiceName: "Renewal subscription year 2",
    benefitAmountInput: "24,000.00",
    exerciseProbabilityInput: "80",
    sspBasis: "Incremental discount versus standalone renewal pricing, weighted for exercise.",
  };
  const promise = {
    ...createPromiseDraft(2, "pr-option"),
    kind: "customer_option" as const,
    description: "Option to renew year 2 at a 20% discount",
    conveysMaterialRight: true,
    materialRightRationale: "The discount is incremental to discounts typically offered.",
    performanceObligationId: right.id,
  };
  const bonusBase = createVcComponentDraft(1, "vc-bonus", "estimated");
  const bonus: VcComponentDraft = {
    ...bonusBase,
    description: "Annual satisfaction bonus",
    effect: "increase",
    estimationMethod: "most_likely_amount",
    allocationTreatment: "general",
    allocationRationale: "The bonus relates to the contract as a whole.",
    inception: {
      ...bonusBase.inception,
      effectiveDate: "2027-01-01",
      includedInput: "12,000.00",
      constraintRationale: "A significant revenue reversal is not probable.",
      outcomes: [
        { id: "o1", seq: 1, description: "Bonus earned", amountInput: "12,000.00", probabilityInput: "", isMostLikely: true },
        { id: "o2", seq: 2, description: "Bonus not earned", amountInput: "0.00", probabilityInput: "", isMostLikely: false },
      ],
    },
  };
  return {
    ...base,
    promises: [...base.promises, promise],
    performanceObligations: [...base.performanceObligations, right],
    hasVariableConsideration: true,
    variableConsiderationComponents: [bonus],
  };
}

describe("material right combined with variable consideration", () => {
  const result = analyzeWorkflow(combinedDraft());

  it("finalizes through the variable-consideration engine", () => {
    expect(result.adapterErrors).toEqual([]);
    expect(result.finalized).toBe(true);
    expect(result.variableConsideration).not.toBeNull();
  });

  it("measures the material right at benefit x probability and allocates the whole pool", () => {
    const layers = result.variableConsideration!.allocation!;
    const right = layers.base.find((r) => r.poId === "po-option")!;
    expect(right.sspCents).toBe(1_920_000);
    expect(right.allocatedCents).toBe(1_820_690);
    expect(layers.base.find((r) => r.poId === "po-saas")!.allocatedCents).toBe(11_379_310);
  });

  it("keeps the material-right allocation locked and carries it as unscheduled consideration", () => {
    const layers = result.variableConsideration!.allocation!;
    expect(layers.inceptionFinal.find((r) => r.poId === "po-option")!.amountCents).toBe(
      layers.currentFinal.find((r) => r.poId === "po-option")!.amountCents,
    );
    expect(result.unscheduledRevenueCents).toBe(1_820_690);
    expect(result.lifecycleConsiderationCents).toBe(13_200_000);
    expect(result.variableConsideration!.reconciliation.reconciled).toBe(true);
  });
});
