/**
 * Phase 5B final remediation regressions:
 *
 *  - Step 4 allocation is available from Step 1-4 information alone, without
 *    any Step 5 recognition, billing or journal input;
 *  - the layered allocation (general/base, specific, final) is engine-owned;
 *  - a material right combined with variable consideration flows through
 *    Phase 3 balances and Phase 4 journals and replays exactly.
 *
 * All companies, customers and amounts are fictional.
 */

import { describe, expect, it } from "vitest";

import { analyzeJournalEntries } from "@/lib/asc606-journals";
import { analyzeWorkflow, previewAllocation } from "../analysis";
import { analyzeContractBalanceWorkflow } from "../contract-balances";
import {
  createConsiderationEventDraft,
  createMaterialRightPoDraft,
  createPromiseDraft,
  createVcComponentDraft,
  type VcComponentDraft,
  type WorkflowDraft,
} from "../types";
import { scenarioADraft } from "./fixtures";
import { case7Draft } from "./vc-fixtures";

/** Case 7 with every Step 5 recognition input removed. */
function case7ThroughStep4(): WorkflowDraft {
  const draft = case7Draft();
  return {
    ...draft,
    performanceObligations: draft.performanceObligations.map((po) => ({
      ...po,
      recognitionMethod: "" as PoRecognitionMethod,
      recognitionDate: "",
      serviceStart: "",
      serviceEnd: "",
      recognitionRationale: "",
    })),
  };
}

type PoRecognitionMethod = WorkflowDraft["performanceObligations"][number]["recognitionMethod"];

describe("Step 4 allocation is independent of Step 5", () => {
  const draft = case7ThroughStep4();

  it("does not finalize the contract without recognition information", () => {
    expect(analyzeWorkflow(draft).finalized).toBe(false);
  });

  it("still produces the engine's layered allocation", () => {
    const preview = previewAllocation(draft);
    const variable = preview.variable!;
    expect(variable.issues).toEqual([]);
    expect(variable.initialTransactionPriceCents).toBe(49_000_000);
    expect(variable.generalPoolCents).toBe(46_000_000);
    expect(variable.base!.map((r) => [r.poId, r.allocatedCents])).toEqual([
      ["po-implementation", 5_520_000],
      ["po-saas", 40_480_000],
    ]);
    expect(variable.specific.map((s) => [s.poId, s.amountCents])).toEqual([
      ["po-implementation", 3_000_000],
    ]);
    expect(variable.finalAllocations!.map((r) => [r.poId, r.amountCents])).toEqual([
      ["po-implementation", 8_520_000],
      ["po-saas", 40_480_000],
    ]);
  });
});

/** Case 6 renewal option combined with a general variable bonus, with billing. */
function combinedBilledDraft(): WorkflowDraft {
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
        {
          id: "o1",
          seq: 1,
          description: "Bonus earned",
          amountInput: "12,000.00",
          probabilityInput: "",
          isMostLikely: true,
        },
      ],
    },
  };
  return {
    ...base,
    promises: [...base.promises, promise],
    performanceObligations: [...base.performanceObligations, right],
    hasVariableConsideration: true,
    variableConsiderationComponents: [bonus],
    contractBalances: {
      considerationEvents: [
        {
          ...createConsiderationEventDraft(1, "ce-annual"),
          amountInput: "132,000.00",
          unconditionalRightDate: "2027-01-01",
          invoiceDate: "2027-01-02",
        },
      ],
      cashCollections: [],
    },
  };
}

describe("material right plus variable consideration through Phase 3 and Phase 4", () => {
  const balances = analyzeContractBalanceWorkflow(combinedBilledDraft());

  it("finalizes the contract balances with the locked material-right allocation unscheduled", () => {
    expect(balances.blockedReason).toBeNull();
    expect(balances.finalized).toBe(true);
    expect(balances.engineInput!.transactionPriceCents).toBe(13_200_000);
    expect(balances.engineInput!.unscheduledRevenueCents).toBe(1_820_690);
    expect(balances.analysis!.reconciliation.reconciled).toBe(true);
  });

  it("produces balanced journal entries that replay every Phase 3 balance", () => {
    const journals = analyzeJournalEntries(balances.engineInput!);
    expect(journals.validation.blockingFailures).toEqual([]);
    for (const entry of journals.entries!) {
      const debits = entry.lines.reduce((sum, line) => sum + line.debitCents, 0);
      const credits = entry.lines.reduce((sum, line) => sum + line.creditCents, 0);
      expect(debits).toBe(credits);
    }
    expect(journals.reconciliation.reconciled).toBe(true);
  });
});
