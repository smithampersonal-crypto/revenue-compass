import { describe, expect, it } from "vitest";

import { analyzeWorkflow } from "../analysis";
import { analyzeContractBalanceWorkflow } from "../contract-balances";
import { parsePercentToBps } from "../money-input";
import {
  createMaterialRightPoDraft,
  createPromiseDraft,
  draftHasMaterialRights,
  type WorkflowDraft,
} from "../types";
import { scenarioADraft } from "./fixtures";

/** Case 6 — Redwood Retail with a discounted renewal option. Fictional. */
function case6Draft(overrides: Partial<ReturnType<typeof createMaterialRightPoDraft>> = {}): WorkflowDraft {
  const base = scenarioADraft();
  const right = {
    ...createMaterialRightPoDraft(2, "po-option"),
    name: "Discounted renewal option",
    underlyingGoodOrServiceName: "Renewal subscription year 2",
    benefitAmountInput: "24,000.00",
    exerciseProbabilityInput: "80",
    sspBasis: "Incremental discount versus standalone renewal pricing, weighted for exercise.",
    ...overrides,
  };
  const promise = {
    ...createPromiseDraft(2, "pr-option"),
    kind: "customer_option" as const,
    description: "Option to renew year 2 at a 20% discount",
    conveysMaterialRight: true,
    materialRightRationale: "The discount is incremental to discounts typically offered.",
    performanceObligationId: right.id,
  };
  return {
    ...base,
    contract: { ...base.contract, contractNumber: "CASE-6" },
    promises: [...base.promises, promise],
    performanceObligations: [...base.performanceObligations, right],
  };
}

const SUBSCRIPTION_ALLOCATION = 10_344_828;
const RIGHT_ALLOCATION = 1_655_172;

describe("percentage input", () => {
  it("parses exactly into basis points", () => {
    expect(parsePercentToBps("80")).toEqual({ ok: true, bps: 8_000 });
    expect(parsePercentToBps("62.50%")).toEqual({ ok: true, bps: 6_250 });
    expect(parsePercentToBps("100.01").ok).toBe(false);
    expect(parsePercentToBps("0").ok).toBe(false);
    expect(parsePercentToBps("12.345").ok).toBe(false);
  });
});

describe("Case 6 workflow — outstanding option", () => {
  const draft = case6Draft();
  const result = analyzeWorkflow(draft);

  it("routes the contract through the material-right lifecycle engine", () => {
    expect(draftHasMaterialRights(draft)).toBe(true);
    expect(result.finalized).toBe(true);
    expect(result.analysis).toBeNull();
    expect(result.lifecycle).not.toBeNull();
  });

  it("allocates the original price to the subscription and the material right", () => {
    expect(result.allocation?.map((row) => [row.poId, row.allocatedCents])).toEqual([
      ["po-saas", SUBSCRIPTION_ALLOCATION],
      ["po-option", RIGHT_ALLOCATION],
    ]);
  });

  it("carries the outstanding option as unscheduled consideration", () => {
    expect(result.unscheduledRevenueCents).toBe(RIGHT_ALLOCATION);
    expect(result.revenueSchedule?.totalCents).toBe(SUBSCRIPTION_ALLOCATION);
    expect(result.lifecycleConsiderationCents).toBe(12_000_000);
    expect(result.lifecycle?.reconciliation.reconciled).toBe(true);
  });
});

describe("Case 6 workflow — exercised option keeps the original allocation locked", () => {
  const result = analyzeWorkflow(
    case6Draft({
      materialRightStatus: "exercised",
      exerciseDate: "2027-12-01",
      exerciseConsiderationInput: "24,000.00",
      recognitionMethod: "over_time_ratable",
      serviceStart: "2028-01-01",
      serviceEnd: "2028-12-31",
      recognitionRationale: "Hosted service consumed as delivered in year 2.",
    }),
  );

  it("does not re-allocate the original transaction price", () => {
    expect(result.allocation?.map((row) => row.allocatedCents)).toEqual([
      SUBSCRIPTION_ALLOCATION,
      RIGHT_ALLOCATION,
    ]);
  });

  it("recognizes the carried amount with the new consideration", () => {
    expect(result.unscheduledRevenueCents).toBe(0);
    expect(result.revenueSchedule?.totalCents).toBe(14_400_000);
    expect(result.lifecycleConsiderationCents).toBe(14_400_000);
    expect(result.revenueSources.map((s) => s.sourceType)).toEqual([
      "original_po",
      "material_right_exercise",
    ]);
  });
});

describe("Case 6 workflow — expired option", () => {
  const result = analyzeWorkflow(
    case6Draft({ materialRightStatus: "expired", expirationDate: "2027-12-31" }),
  );

  it("recognizes the allocated amount on expiration", () => {
    expect(result.unscheduledRevenueCents).toBe(0);
    expect(result.revenueSchedule?.totalCents).toBe(12_000_000);
    const december = result.revenueSchedule?.byMonth.find((m) => m.month === "2027-12");
    expect(december?.perPo["po-option::expiration"]).toBe(RIGHT_ALLOCATION);
  });
});

describe("Case 6 workflow — incomplete material-right judgments block finalization", () => {
  it("blocks when the exercise probability is missing", () => {
    const result = analyzeWorkflow(case6Draft({ exerciseProbabilityInput: "" }));
    expect(result.finalized).toBe(false);
    expect(result.revenueSchedule).toBeNull();
    expect(result.allocation).toBeNull();
  });

  it("blocks when an exercised option has no recognition dates", () => {
    const result = analyzeWorkflow(
      case6Draft({
        materialRightStatus: "exercised",
        exerciseDate: "2027-12-01",
        exerciseConsiderationInput: "24,000.00",
      }),
    );
    expect(result.finalized).toBe(false);
    expect(result.revenueSchedule).toBeNull();
  });
});

describe("Case 6 contract balances with an outstanding material right", () => {
  const draft = case6Draft();
  const billed: WorkflowDraft = {
    ...draft,
    contractBalances: {
      considerationEvents: [
        {
          id: "ce-1",
          seq: 1,
          amountInput: "120,000.00",
          unconditionalRightDate: "2027-01-01",
          invoiceDate: "2027-01-01",
        },
      ],
      cashCollections: [
        {
          id: "cash-1",
          seq: 1,
          considerationEventId: "ce-1",
          amountInput: "120,000.00",
          collectionDate: "2027-01-31",
        },
      ],
    },
  };
  const result = analyzeContractBalanceWorkflow(billed);

  it("reconciles scheduled revenue plus the unscheduled material right to the price", () => {
    expect(result.finalized).toBe(true);
    expect(result.analysis?.reconciliation.unscheduledRevenueCents).toBe(RIGHT_ALLOCATION);
    expect(result.analysis?.reconciliation.totalRevenueCents).toBe(SUBSCRIPTION_ALLOCATION);
    expect(result.analysis?.reconciliation.reconciled).toBe(true);
  });

  it("leaves the unexercised option in the contract liability at the end of the term", () => {
    const last = result.analysis!.monthly!.at(-1)!;
    expect(last.contractLiabilityCents).toBe(RIGHT_ALLOCATION);
    expect(last.contractAssetCents).toBe(0);
  });
});
