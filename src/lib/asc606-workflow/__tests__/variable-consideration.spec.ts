/**
 * Phase 5B workflow acceptance: the accountant's draft must reach the pure
 * variable-consideration engine with exact, unmodified amounts, and every
 * fixed-only path must keep behaving exactly as before.
 */

import { describe, expect, it } from "vitest";

import { analyzeWorkflow } from "../analysis";
import { buildVariableConsiderationInput } from "../vc-adapter";
import { case7Draft, case7ResolvedDraft, cloudAiDraft } from "./vc-fixtures";
import { scenarioADraft, scenarioBDraft } from "./fixtures";

const allocated = (result: ReturnType<typeof analyzeWorkflow>, poId: string) =>
  result.variableConsideration!.allocation!.currentFinal.find((r) => r.poId === poId)!.amountCents;

describe("Case 7 — AtlasData / TitanEnergy variable bonus", () => {
  it("allocates the specific bonus entirely to the implementation obligation", () => {
    const result = analyzeWorkflow(case7Draft());
    expect(result.adapterErrors).toEqual([]);
    expect(result.finalized).toBe(true);

    const layers = result.variableConsideration!.allocation!;
    expect(layers.base.find((r) => r.poId === "po-implementation")!.allocatedCents).toBe(5_520_000);
    expect(layers.base.find((r) => r.poId === "po-saas")!.allocatedCents).toBe(40_480_000);
    expect(allocated(result, "po-implementation")).toBe(8_520_000); // $85,200.00
    expect(allocated(result, "po-saas")).toBe(40_480_000); // $404,800.00
  });

  it("reports the initial transaction price including the constrained bonus", () => {
    const totals = analyzeWorkflow(case7Draft()).variableConsideration!.totals;
    expect(totals.fixedConsiderationCents).toBe(46_000_000);
    expect(totals.initialTransactionPriceCents).toBe(49_000_000);
    expect(totals.currentEstimatedConsiderationCents).toBe(49_000_000);
    expect(totals.lifecycleConsiderationCents).toBe(49_000_000);
  });

  it("recognizes the implementation obligation on the go-live date and reconciles", () => {
    const result = analyzeWorkflow(case7Draft());
    const schedule = result.revenueSchedule!;
    expect(schedule.byMonth[0]!.month).toBe("2027-03");
    expect(schedule.byMonth[0]!.perPo["po-implementation"]).toBe(8_520_000);
    expect(schedule.totalCents).toBe(49_000_000);
    expect(result.variableConsideration!.reconciliation.reconciled).toBe(true);
  });

  it("produces no change and no catch-up when the bonus resolves at the estimated amount", () => {
    const result = analyzeWorkflow(case7ResolvedDraft());
    expect(result.finalized).toBe(true);
    const events = result.variableConsideration!.changeEvents;
    const resolution = events.find((e) => e.isResolution)!;
    expect(resolution.transactionPriceChangeCents).toBe(0);
    expect(resolution.catchUpCents).toBe(0);
    expect(allocated(result, "po-implementation")).toBe(8_520_000);
    expect(result.variableConsideration!.reconciliation.reconciled).toBe(true);
  });
});

describe("CloudAI — usage as incurred", () => {
  it("prices January usage exactly and adds it to the fixed January revenue", () => {
    const result = analyzeWorkflow(cloudAiDraft());
    expect(result.adapterErrors).toEqual([]);
    expect(result.finalized).toBe(true);

    const january = result.variableConsideration!.usagePeriods.find((p) => p.month === "2027-01")!;
    expect(january.meters.map((m) => m.amountCents)).toEqual([3_200, 4_000]);
    expect(january.totalCents).toBe(7_200); // $72.00

    const row = result.revenueSchedule!.byMonth.find((r) => r.month === "2027-01")!;
    expect(row.totalCents).toBe(1_026_378); // $10,263.78
  });

  it("adds usage consideration to the lifecycle consideration total", () => {
    const totals = analyzeWorkflow(cloudAiDraft()).variableConsideration!.totals;
    expect(totals.fixedConsiderationCents).toBe(12_000_000);
    expect(totals.usageConsiderationCents).toBe(7_200);
    expect(totals.lifecycleConsiderationCents).toBe(12_007_200);
  });

  it("blocks when a usage quantity is left blank rather than entered as zero", () => {
    const draft = cloudAiDraft();
    const component = draft.variableConsiderationComponents[0]!;
    const blanked = {
      ...draft,
      variableConsiderationComponents: [
        {
          ...component,
          usagePeriods: [
            {
              ...component.usagePeriods[0]!,
              quantities: { ...component.usagePeriods[0]!.quantities, "meter-output": "" },
            },
          ],
        },
      ],
    };
    const result = analyzeWorkflow(blanked);
    expect(result.finalized).toBe(false);
    expect(result.revenueSchedule).toBeNull();
  });
});

describe("fixed-only contracts are unaffected", () => {
  it("keeps Scenario A and Scenario B on the approved fixed path", () => {
    for (const draft of [scenarioADraft(), scenarioBDraft()]) {
      const result = analyzeWorkflow(draft);
      expect(result.finalized).toBe(true);
      expect(result.variableConsideration).toBeNull();
      expect(result.analysis).not.toBeNull();
    }
  });

  it("blocks an enabled flag with no components instead of falling back to fixed-only", () => {
    const result = analyzeWorkflow({ ...scenarioADraft(), hasVariableConsideration: true });
    expect(result.variableConsideration).toBeNull();
    expect(result.finalized).toBe(false);
    expect(
      result.workflowValidation.blocking.some(
        (i) => i.id === "contract.variable_consideration.components_present",
      ),
    ).toBe(true);
  });
});

describe("variable-consideration adapter", () => {
  it("reports missing judgments instead of defaulting them", () => {
    const draft = case7Draft();
    const built = buildVariableConsiderationInput({
      ...draft,
      variableConsiderationComponents: draft.variableConsiderationComponents.map((c) => ({
        ...c,
        relatesSpecifically: null,
        consistentWithAllocationObjective: null,
      })),
    });
    expect(built.ok).toBe(false);
    if (!built.ok) {
      expect(built.errors.some((e) => e.includes("allocation-exception judgments"))).toBe(true);
    }
  });
});
