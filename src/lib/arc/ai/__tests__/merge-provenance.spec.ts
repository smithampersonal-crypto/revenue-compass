/**
 * Phase 9E acceptance patch. Provenance, review escalation, manual-structure
 * preservation, multi-element billing periods, AI-owned refresh and paired
 * rationale integrity. Every assertion runs through the real merge.
 */
import { describe, expect, it } from "vitest";

import {
  createConsiderationEventDraft,
  createEmptyDraft,
  createModificationDraft,
  createPoDraft,
  createPromiseDraft,
  createVcComponentDraft,
  type WorkflowDraft,
} from "@/lib/asc606-workflow";

import { deriveCanonicalId } from "../identity";
import {
  aiObjectFingerprint,
  createEmptyAiAnalysisState,
  mergeAiAnalysis,
  type AiAnalysisState,
} from "../merge";
import type { AiContractAnalysis } from "../schema";
import {
  fixtureAAnalysis,
  fixtureMultiElementAnalysis,
  guidancePackFixture,
  RUN_ID,
} from "./merge-fixtures";

const PROMISE_ID = deriveCanonicalId("promise", "promise:saas");
const PO_ID = deriveCanonicalId("performance_obligation", "po:saas");
const VC_ID = deriveCanonicalId("variable_component", "vc:overage");
const METER_ID = `${VC_ID}-m1`;
const RUN_2 = "run-00000000-0000-4000-8000-000000000002";

function run(
  analysis: AiContractAnalysis,
  currentDraft: WorkflowDraft = createEmptyDraft(),
  currentAiState: AiAnalysisState = createEmptyAiAnalysisState(),
  runId: string = RUN_ID,
) {
  return mergeAiAnalysis({
    currentDraft,
    currentAiState,
    analysis,
    runId,
    guidancePack: guidancePackFixture(),
    priorContext: null,
  });
}

function usageAnalysis(rate: string): AiContractAnalysis {
  const analysis = fixtureAAnalysis();
  analysis.transactionPrice.variableConsiderationComponents = [
    {
      semanticKey: "vc:overage",
      description: "Per-sample overage above the included tier.",
      type: "usage",
      contractualRateOrAmountInput: rate,
      unitDescription: "per sample above 50,000",
      billingFrequency: "quarterly",
      trigger: "Samples processed above the included tier.",
      estimationMethodProposal: "not_estimable",
      initialEstimateBasis: "not_applicable_usage_as_incurred",
      initialEstimatedAmountInput: null,
      initialIncludedAmountInput: null,
      initialEstimateRationale: "Basis recorded for the initial estimate at inception.",
      constraintAssessment: "Future volume is not determinable from the contract.",
      allocationTreatmentProposal: "unknown",
      targetPerformanceObligationKey: null,
      relatesSpecifically: "unknown",
      consistentWithAllocationObjective: "unknown",
      allocationRationale: "The contract does not narrow this component to one obligation.",
      citations: analysis.billingTerms[0]!.citations,
      guidanceIds: [30],
      reviewState: "needs_user_input",
    },
  ];
  return analysis;
}

/* ------------------------------------------------------- Finding 1 — objects */

describe("object provenance is measured against the pre-merge draft", () => {
  it("fingerprints a promise only after its performance obligation is assigned", () => {
    const { draft, aiState } = run(fixtureAAnalysis());
    expect(draft.promises[0]!.performanceObligationId).toBe(PO_ID);
    expect(aiState.objectProvenance["promise:saas"]!.valueFingerprint).toBe(
      aiObjectFingerprint(draft, PROMISE_ID),
    );
  });

  it("fingerprints a performance obligation only after recognition and SSP", () => {
    const { draft, aiState } = run(fixtureAAnalysis());
    const po = draft.performanceObligations[0]!;
    expect(po.recognitionMethod).toBe("over_time_ratable");
    expect(po.sspInput).toBe("120000");
    expect(aiState.objectProvenance["po:saas"]!.valueFingerprint).toBe(
      aiObjectFingerprint(draft, PO_ID),
    );
  });

  it("treats an identical second run as untouched for every AI object", () => {
    const first = run(usageAnalysis("1.35"));
    const second = run(usageAnalysis("1.35"), first.draft, first.aiState, RUN_2);
    for (const key of Object.keys(second.aiState.objectProvenance)) {
      const provenance = second.aiState.objectProvenance[key]!;
      expect({ key, userModified: provenance.userModified }).toEqual({ key, userModified: false });
      expect(provenance.state).toBe("ai_generated_untouched");
      expect(provenance.lastAiRunId).toBe(RUN_2);
    }
    // Promise, PO, VC component, billing event and projected collection.
    expect(Object.keys(second.aiState.objectProvenance).sort()).toEqual([
      "billing:annual-advance#1",
      "billing:annual-advance#1#collection",
      "po:saas",
      "promise:saas",
      "vc:overage",
    ]);
  });

  it("keeps an object untouched when only the AI value changed", () => {
    const first = run(fixtureAAnalysis());
    const renamed = fixtureAAnalysis();
    renamed.performanceObligations[0]!.description = "Hosted platform subscription";
    renamed.performanceObligations[0]!.accountingLabel = "Hosted platform subscription";
    const second = run(renamed, first.draft, first.aiState, RUN_2);

    const po = second.draft.performanceObligations[0]!;
    expect(po.id).toBe(PO_ID);
    expect(po.name).toBe("Hosted platform subscription");
    const provenance = second.aiState.objectProvenance["po:saas"]!;
    expect(provenance.userModified).toBe(false);
    expect(provenance.valueFingerprint).toBe(aiObjectFingerprint(second.draft, PO_ID));
  });

  it("marks a genuinely edited object as user-owned and stops overwriting it", () => {
    const first = run(fixtureAAnalysis());
    const edited: WorkflowDraft = {
      ...first.draft,
      performanceObligations: first.draft.performanceObligations.map((po) => ({
        ...po,
        name: "Accountant's own PO name",
      })),
    };
    const renamed = fixtureAAnalysis();
    renamed.performanceObligations[0]!.description = "Hosted platform subscription";
    renamed.performanceObligations[0]!.accountingLabel = "Hosted platform subscription";
    const second = run(renamed, edited, first.aiState, RUN_2);

    expect(second.draft.performanceObligations[0]!.name).toBe("Accountant's own PO name");
    expect(second.aiState.objectProvenance["po:saas"]!.userModified).toBe(true);
    // Only that object becomes user-owned.
    expect(second.aiState.objectProvenance["promise:saas"]!.userModified).toBe(false);
  });

  it("keeps user ownership sticky across later runs", () => {
    const first = run(fixtureAAnalysis());
    const edited: WorkflowDraft = {
      ...first.draft,
      promises: first.draft.promises.map((promise) => ({
        ...promise,
        description: "My own promise wording",
      })),
    };
    const second = run(fixtureAAnalysis(), edited, first.aiState, RUN_2);
    const third = run(fixtureAAnalysis(), second.draft, second.aiState, "run-3");
    expect(third.draft.promises[0]!.description).toBe("My own promise wording");
    expect(third.aiState.objectProvenance["promise:saas"]!.userModified).toBe(true);
  });
});

/* --------------------------------------------- Finding 2/3/8 — review policy */

describe("a historical affirmation can never clear a blocking issue", () => {
  function affirmAll(state: AiAnalysisState): AiAnalysisState {
    return {
      ...state,
      reviewItems: state.reviewItems.map((item) => ({
        ...item,
        state: "resolved" as const,
        resolution: {
          kind: "affirmed" as const,
          at: "2027-02-01T00:00:00.000Z",
          method: "individual" as const,
          reviewFingerprint: item.reviewFingerprint,
        },
        affirmedAt: "2027-02-01T00:00:00.000Z",
        affirmedMethod: "individual" as const,
      })),
    };
  }

  it("re-raises an affirmed judgment as red once the evidence conflicts", () => {
    const first = run(fixtureAAnalysis());
    const affirmed = affirmAll(first.aiState);

    const conflicted = fixtureAAnalysis();
    conflicted.contractAssessment.collectibility.reviewState = "source_conflict";
    const second = run(conflicted, first.draft, affirmed, RUN_2);

    const item = second.issues.find(
      (row) => row.targetKey === "contract.criteria.collectibility_probable.answer",
    )!;
    expect(item.state).toBe("red");
    expect(item.affirmedAt).toBeNull();
    expect(item.affirmedMethod).toBeNull();
  });

  it("re-raises an affirmed judgment as red once the model needs user input", () => {
    const first = run(fixtureAAnalysis());
    const affirmed = affirmAll(first.aiState);
    const needsInput = fixtureAAnalysis();
    needsInput.contractAssessment.commercialSubstance.reviewState = "needs_user_input";
    const second = run(needsInput, first.draft, affirmed, RUN_2);
    expect(
      second.issues.find(
        (row) => row.targetKey === "contract.criteria.commercial_substance.answer",
      )!.state,
    ).toBe("red");
  });

  it("invalidates a preserved-value affirmation when the AI proposal changes", () => {
    const manual: WorkflowDraft = { ...createEmptyDraft(), transactionPriceInput: "125000" };
    const proposeAmount = (amount: string) => {
      const analysis = fixtureAAnalysis();
      // ARC's deterministic total is authoritative, so the model's amount only
      // matters when the contract's own billing schedule says the same thing.
      analysis.transactionPrice.fixedConsiderationInput = amount;
      analysis.billingTerms[0]!.amountOrRateInput = amount;
      return analysis;
    };

    const first = run(proposeAmount("150000"), manual);
    expect(first.draft.transactionPriceInput).toBe("125000");
    const affirmed = affirmAll(first.aiState);

    const same = run(proposeAmount("150000"), first.draft, affirmed, RUN_2);
    expect(same.issues.find((row) => row.targetKey === "transactionPrice.input")!.state).toBe(
      "resolved",
    );

    const moved = run(proposeAmount("180000"), first.draft, affirmed, RUN_2);
    const item = moved.issues.find((row) => row.targetKey === "transactionPrice.input")!;
    expect(item.state).toBe("yellow");
    expect(item.affirmedAt).toBeNull();
  });
});

/* ------------------------------------------- Finding 4 — manual structures */

describe("manual structures are never duplicated by an AI proposal", () => {
  function manualPromiseAndPo(): WorkflowDraft {
    const base = createEmptyDraft();
    return {
      ...base,
      promises: [
        {
          ...createPromiseDraft(1, "manual-promise-1"),
          description: "Annual hosted SaaS service",
          capableOfBeingDistinct: true,
          distinctWithinContractContext: true,
          performanceObligationId: "manual-po-1",
        },
      ],
      performanceObligations: [
        { ...createPoDraft(1, "manual-po-1"), name: "Manual SaaS obligation" },
      ],
    };
  }

  it("keeps the manual promise, the manual PO and the manual link", () => {
    const { draft, issues } = run(fixtureAAnalysis(), manualPromiseAndPo());
    expect(draft.promises.map((row) => row.id)).toEqual(["manual-promise-1"]);
    expect(draft.performanceObligations.map((row) => row.id)).toEqual(["manual-po-1"]);
    expect(draft.promises[0]!.performanceObligationId).toBe("manual-po-1");
    expect(draft.performanceObligations[0]!.name).toBe("Manual SaaS obligation");
    expect(issues.some((item) => item.targetKey === "promise:manual-promise-1")).toBe(true);
    expect(issues.some((item) => item.targetKey === "po:manual-po-1")).toBe(true);
  });

  it("claims no AI ownership over the preserved manual objects", () => {
    const { aiState } = run(fixtureAAnalysis(), manualPromiseAndPo());
    expect(aiState.objectProvenance["po:saas"]).toBeUndefined();
    expect(aiState.objectProvenance["promise:saas"]).toBeUndefined();
  });

  it("refuses to regroup promises the accountant assigned to different POs", () => {
    const base = manualPromiseAndPo();
    const conflicting: WorkflowDraft = {
      ...base,
      promises: [
        base.promises[0]!,
        {
          ...createPromiseDraft(2, "manual-promise-2"),
          description: "Premium support services",
          performanceObligationId: "manual-po-2",
        },
      ],
      performanceObligations: [
        base.performanceObligations[0]!,
        { ...createPoDraft(2, "manual-po-2"), name: "Manual support obligation" },
      ],
    };
    const analysis = fixtureMultiElementAnalysis();
    analysis.performanceObligations = [
      {
        ...analysis.performanceObligations[0]!,
        promiseKeys: ["promise:saas", "promise:support"],
      },
    ];
    analysis.recognitionProposals = [analysis.recognitionProposals[0]!];
    analysis.sspAndAllocation.items = [analysis.sspAndAllocation.items[0]!];

    const { draft, issues } = run(analysis, conflicting);
    expect(draft.performanceObligations).toHaveLength(2);
    expect(issues.find((item) => item.targetKey === "po:po:saas")!.state).toBe("red");
  });

  it("does not add a second variable-consideration component", () => {
    const base = createEmptyDraft();
    const manual: WorkflowDraft = {
      ...base,
      hasVariableConsideration: true,
      variableConsiderationComponents: [
        {
          ...createVcComponentDraft(1, "manual-vc-1", "usage_as_incurred"),
          description: "Per-sample overage above the included tier.",
        },
      ],
    };
    const { draft, issues } = run(usageAnalysis("1.35"), manual);
    expect(draft.variableConsiderationComponents.map((row) => row.id)).toEqual(["manual-vc-1"]);
    expect(issues.some((item) => item.targetKey === "vc:manual-vc-1")).toBe(true);
  });

  it("does not add a second contract modification shell", () => {
    const base = createEmptyDraft();
    const manual: WorkflowDraft = {
      ...base,
      hasContractModifications: true,
      contractModifications: [{ ...createModificationDraft(1), id: "manual-mod-1" }],
    };
    const analysis = fixtureAAnalysis();
    analysis.contractModifications = {
      ...analysis.contractModifications,
      hasModification: "yes",
      effectiveDate: "2027-07-01",
      addedGoodsOrServices: "Additional user seats.",
      rationale: "An amendment adds seats.",
      reviewState: "needs_review",
    };
    const { draft, issues } = run(analysis, manual);
    expect(draft.contractModifications.map((row) => row.id)).toEqual(["manual-mod-1"]);
    expect(issues.some((item) => item.targetKey === "modification:manual")).toBe(true);
  });

  it("does not layer a derived invoice schedule over manual billing events", () => {
    const base = createEmptyDraft();
    const manual: WorkflowDraft = {
      ...base,
      contractBalances: {
        ...base.contractBalances,
        considerationEvents: [
          {
            ...createConsiderationEventDraft(1, "manual-ce-1"),
            amountInput: "120000",
            invoiceDate: "2027-01-01",
            unconditionalRightDate: "2027-01-01",
          },
        ],
      },
    };
    const { draft, issues } = run(fixtureAAnalysis(), manual);
    expect(draft.contractBalances.considerationEvents.map((row) => row.id)).toEqual([
      "manual-ce-1",
    ]);
    expect(draft.contractBalances.cashCollections).toHaveLength(0);
    expect(issues.some((item) => item.targetKey === "billing:billing:annual-advance")).toBe(true);
  });
});

/* -------------------------------------- Finding 5 — multi-element billing */

describe("recurring billing needs one unambiguous service period", () => {
  it("derives a schedule when both performance obligations share a period", () => {
    const { draft } = run(fixtureMultiElementAnalysis());
    expect(draft.performanceObligations).toHaveLength(2);
    expect(draft.contractBalances.considerationEvents).toHaveLength(1);
    expect(draft.contractBalances.considerationEvents[0]!.invoiceDate).toBe("2027-01-01");
    expect(draft.contractBalances.cashCollections[0]!.basis).toBe("projected_contract_due_date");
  });

  it("refuses to span two disjoint service periods into one schedule", () => {
    const { draft, issues } = run(
      fixtureMultiElementAnalysis({ start: "2027-07-01", end: "2027-09-30" }),
    );
    expect(draft.contractBalances.considerationEvents).toHaveLength(0);
    expect(draft.contractBalances.cashCollections).toHaveLength(0);
    expect(issues.find((item) => item.targetKey === "billing:billing:annual-advance")!.state).toBe(
      "red",
    );
  });

  it("refuses a partially overlapping second period too", () => {
    const { draft } = run(fixtureMultiElementAnalysis({ start: "2027-04-01", end: "2027-12-31" }));
    expect(draft.contractBalances.considerationEvents).toHaveLength(0);
  });
});

/* ------------------------------------------ Finding 6 — AI-owned refreshes */

describe("AI-owned creation-time values refresh safely", () => {
  it("refreshes an untouched usage meter rate on re-analysis", () => {
    const first = run(usageAnalysis("1.35"));
    expect(first.draft.variableConsiderationComponents[0]!.meters[0]!.rateAmountInput).toBe("1.35");

    const second = run(usageAnalysis("1.50"), first.draft, first.aiState, RUN_2);
    const component = second.draft.variableConsiderationComponents[0]!;
    expect(component.id).toBe(VC_ID);
    expect(component.meters[0]!.id).toBe(METER_ID);
    expect(component.meters[0]!.rateAmountInput).toBe("1.50");
    expect(component.usagePeriods).toHaveLength(0);
  });

  it("never overwrites a rate the accountant edited", () => {
    const first = run(usageAnalysis("1.35"));
    const edited: WorkflowDraft = {
      ...first.draft,
      variableConsiderationComponents: first.draft.variableConsiderationComponents.map((row) => ({
        ...row,
        meters: row.meters.map((meter) => ({ ...meter, rateAmountInput: "2.00" })),
      })),
    };
    const second = run(usageAnalysis("1.50"), edited, first.aiState, RUN_2);
    expect(second.draft.variableConsiderationComponents[0]!.meters[0]!.rateAmountInput).toBe(
      "2.00",
    );
    expect(
      second.issues.some((item) => item.targetKey === `vc:${VC_ID}.meter.rateAmountInput`),
    ).toBe(true);
  });

  it("refuses to repurpose a component into a different treatment family", () => {
    const first = run(usageAnalysis("1.35"));
    const estimated = usageAnalysis("1.35");
    estimated.transactionPrice.variableConsiderationComponents[0]!.type = "bonus";
    estimated.transactionPrice.variableConsiderationComponents[0]!.estimationMethodProposal =
      "most_likely_amount";
    const second = run(estimated, first.draft, first.aiState, RUN_2);

    const component = second.draft.variableConsiderationComponents[0]!;
    expect(component.treatment).toBe("usage_as_incurred");
    expect(second.issues.find((item) => item.targetKey === `vc:${VC_ID}.treatment`)!.state).toBe(
      "red",
    );
  });

  it("refreshes an untouched promise kind rather than ignoring the change", () => {
    const first = run(fixtureAAnalysis());
    const asOption = fixtureAAnalysis();
    asOption.promises[0]!.promiseType = "option";
    const second = run(asOption, first.draft, first.aiState, RUN_2);
    expect(second.draft.promises[0]!.kind).toBe("customer_option");
    expect(
      second.issues.find((item) => item.targetKey === `promise:${PROMISE_ID}.conveysMaterialRight`)!
        .state,
    ).toBe("red");
  });
});

/* -------------------------------------- Finding 7 — paired explanatory text */

describe("an AI explanation is never attached to a preserved manual value", () => {
  it("leaves transaction price notes alone when the amount is the accountant's", () => {
    const manual: WorkflowDraft = { ...createEmptyDraft(), transactionPriceInput: "125000" };
    const { draft, issues } = run(fixtureAAnalysis(), manual);
    expect(draft.transactionPriceInput).toBe("125000");
    expect(draft.transactionPriceNotes).toBe("");
    expect(issues.some((item) => item.targetKey === "transactionPrice.input")).toBe(true);
  });

  it("does not explain a manual recognition method with the AI rationale", () => {
    const first = run(fixtureAAnalysis());
    const edited: WorkflowDraft = {
      ...first.draft,
      performanceObligations: first.draft.performanceObligations.map((po) => ({
        ...po,
        recognitionMethod: "point_in_time" as const,
        recognitionRationale: "",
        recognitionDate: "2027-01-01",
      })),
    };
    const second = run(fixtureAAnalysis(), edited, first.aiState, RUN_2);
    const po = second.draft.performanceObligations[0]!;
    expect(po.recognitionMethod).toBe("point_in_time");
    expect(po.recognitionRationale).toBe("");
  });

  it("does not attach the AI basis to a manual standalone selling price", () => {
    const first = run(fixtureAAnalysis());
    const edited: WorkflowDraft = {
      ...first.draft,
      performanceObligations: first.draft.performanceObligations.map((po) => ({
        ...po,
        sspInput: "99000",
        sspBasis: "",
      })),
    };
    const second = run(fixtureAAnalysis(), edited, first.aiState, RUN_2);
    expect(second.draft.performanceObligations[0]!.sspInput).toBe("99000");
    expect(second.draft.performanceObligations[0]!.sspBasis).toBe("");
  });

  it("does not attach the AI grouping rationale to a manual classification", () => {
    const first = run(fixtureAAnalysis());
    const edited: WorkflowDraft = {
      ...first.draft,
      performanceObligations: first.draft.performanceObligations.map((po) => ({
        ...po,
        classification: "series" as const,
        classificationRationale: "",
      })),
    };
    const second = run(fixtureAAnalysis(), edited, first.aiState, RUN_2);
    expect(second.draft.performanceObligations[0]!.classification).toBe("series");
    expect(second.draft.performanceObligations[0]!.classificationRationale).toBe("");
  });
});
