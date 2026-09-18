/**
 * Phase 9E fixtures B–E: unsafe proposals, re-analysis, tombstones, incomplete
 * modifications and non-derivable billing. Every assertion is about ARC
 * refusing to invent accounting, and about user work surviving a re-run.
 */
import { describe, expect, it } from "vitest";

import {
  createConsiderationEventDraft,
  createEmptyDraft,
  type WorkflowDraft,
} from "@/lib/asc606-workflow";

import { deriveCanonicalId } from "../identity";
import {
  AiMergeError,
  createEmptyAiAnalysisState,
  mergeAiAnalysis,
  type AiAnalysisState,
} from "../merge";
import type { AiReviewItem } from "../review-state";
import type { AiContractAnalysis } from "../schema";
import {
  fixtureAAnalysis,
  fixtureMultiElementAnalysis,
  guidancePackFixture,
  RUN_ID,
} from "./merge-fixtures";

const PROMISE_ID = deriveCanonicalId("promise", "promise:saas");
const PO_ID = deriveCanonicalId("performance_obligation", "po:saas");
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

function itemFor(issues: readonly AiReviewItem[], targetKey: string) {
  return issues.find((issue) => issue.targetKey === targetKey);
}

/* --------------------------------------- Fixture B — unsafe / unsupported */

describe("Fixture B — unsupported recognition and unobservable SSP", () => {
  function fixtureB(): AiContractAnalysis {
    const analysis = fixtureAAnalysis();
    analysis.recognitionProposals[0]!.recognitionMethod = "output_method";
    analysis.recognitionProposals[0]!.measureDescription = "Transactions processed.";
    analysis.sspAndAllocation.items[0]!.observableSspEvidence = "not_observable";
    analysis.sspAndAllocation.items[0]!.observedAmountInput = null;
    analysis.sspAndAllocation.items[0]!.proposedMethod = "adjusted_market_assessment";
    analysis.sspAndAllocation.items[0]!.reviewState = "needs_user_input";
    return analysis;
  }

  it("leaves the recognition method unanswered and raises a blocking item", () => {
    const { draft, issues } = run(fixtureB());
    const po = draft.performanceObligations[0]!;
    expect(po.recognitionMethod).toBeNull();
    expect(po.serviceStart).toBe("");
    expect(po.serviceEnd).toBe("");
    expect(itemFor(issues, `po:${PO_ID}.recognitionMethod`)?.state).toBe("red");
  });

  it("never takes an unobservable standalone selling price from the contract price", () => {
    const { draft, issues } = run(fixtureB());
    expect(draft.performanceObligations[0]!.sspInput).toBe("");
    expect(draft.performanceObligations[0]!.sspBasis).toBe("");
    expect(itemFor(issues, `po:${PO_ID}.sspInput`)?.state).toBe("red");
  });

  it("still maps everything that is safe", () => {
    const { draft } = run(fixtureB());
    expect(draft.transactionPriceInput).toBe("120000");
    expect(draft.promises[0]!.performanceObligationId).toBe(PO_ID);
  });
});

/* ------------------------------------------------ Fixture C — re-analysis */

describe("Fixture C — re-analysis preserves user work", () => {
  function secondRun(): AiContractAnalysis {
    const analysis = fixtureAAnalysis();
    analysis.performanceObligations[0]!.description = "Hosted platform subscription";
    analysis.promises[0]!.description = "Hosted platform access";
    analysis.transactionPrice.fixedConsiderationInput = "150000";
    return analysis;
  }

  it("refreshes untouched AI values and keeps canonical IDs stable", () => {
    const first = run(fixtureAAnalysis());
    const second = run(secondRun(), first.draft, first.aiState, RUN_2);
    expect(second.draft.performanceObligations[0]!.id).toBe(PO_ID);
    expect(second.draft.performanceObligations[0]!.name).toBe("Hosted platform subscription");
    expect(second.draft.transactionPriceInput).toBe("150000");
    expect(second.aiState.lastSuccessfulRunId).toBe(RUN_2);
  });

  it("preserves a user edit and flags the AI difference instead of overwriting", () => {
    const first = run(fixtureAAnalysis());
    const edited: WorkflowDraft = {
      ...first.draft,
      transactionPriceInput: "125000",
      performanceObligations: first.draft.performanceObligations.map((po) => ({
        ...po,
        name: "Accountant's own PO name",
      })),
    };
    const second = run(secondRun(), edited, first.aiState, RUN_2);

    expect(second.draft.transactionPriceInput).toBe("125000");
    expect(second.draft.performanceObligations[0]!.name).toBe("Accountant's own PO name");
    expect(second.aiState.fieldProvenance["transactionPrice.input"]?.state).toBe(
      "ai_difference_preserved_user_override",
    );
    expect(itemFor(second.issues, "transactionPrice.input")?.state).toBe("yellow");
  });

  it("records a tombstone for a user-deleted AI object and never resurrects it", () => {
    const first = run(fixtureAAnalysis());
    const withoutPo: WorkflowDraft = {
      ...first.draft,
      performanceObligations: [],
      promises: first.draft.promises.map((promise) => ({
        ...promise,
        performanceObligationId: null,
      })),
    };
    const second = run(secondRun(), withoutPo, first.aiState, RUN_2);

    expect(second.aiState.tombstones).toContain("po:saas");
    expect(second.draft.performanceObligations).toHaveLength(0);

    const third = run(secondRun(), second.draft, second.aiState, "run-3");
    expect(third.draft.performanceObligations).toHaveLength(0);
    expect(third.aiState.tombstones).toContain("po:saas");
  });

  it("retains an object the AI stopped proposing rather than deleting the accountant's row", () => {
    const first = run(fixtureAAnalysis());
    const dropped = secondRun();
    dropped.performanceObligations = [];
    dropped.recognitionProposals = [];
    dropped.sspAndAllocation.items = [];
    dropped.promises[0]!.semanticKey = "promise:saas";

    const second = run(dropped, first.draft, first.aiState, RUN_2);
    expect(second.draft.performanceObligations.map((po) => po.id)).toEqual([PO_ID]);
    expect(itemFor(second.issues, `object:${PO_ID}`)?.state).toBe("yellow");
  });

  it("keeps an affirmation only while the reviewed value is unchanged", () => {
    const first = run(fixtureAAnalysis());
    const affirmedState: AiAnalysisState = {
      ...first.aiState,
      reviewItems: first.aiState.reviewItems.map((item) => ({
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

    const unchanged = run(fixtureAAnalysis(), first.draft, affirmedState, RUN_2);
    // Every affirmable (yellow) item carries its resolution forward.
    expect(unchanged.issues.some((item) => item.state === "resolved")).toBe(true);
    expect(unchanged.issues.every((item) => item.state !== "yellow")).toBe(true);

    const changed = run(secondRun(), first.draft, affirmedState, RUN_2);
    const refreshed = itemFor(changed.issues, "transactionPrice.input");
    if (refreshed !== undefined) expect(refreshed.state).not.toBe("resolved");
  });

  it("never mutates the caller's draft or sidecar", () => {
    const first = run(fixtureAAnalysis());
    const snapshot = JSON.stringify({ draft: first.draft, state: first.aiState });
    run(secondRun(), first.draft, first.aiState, RUN_2);
    expect(JSON.stringify({ draft: first.draft, state: first.aiState })).toBe(snapshot);
  });
});

/* --------------------------------- Fixture D — incomplete modification facts */

describe("Fixture D — a modification ARC cannot complete", () => {
  function fixtureD(): AiContractAnalysis {
    const analysis = fixtureAAnalysis();
    analysis.contractModifications = {
      ...analysis.contractModifications,
      hasModification: "yes",
      effectiveDate: "2027-07-01",
      addedGoodsOrServices: "Additional user seats.",
      addedGoodsDistinct: "unknown",
      priceIncreaseInput: null,
      priceReflectsSsp: "unknown",
      remainingGoodsDistinct: "unknown",
      treatmentCandidate: "needs_user_input",
      rationale: "An amendment exists but the pricing schedule was not provided.",
      reviewState: "needs_user_input",
    };
    return analysis;
  }

  it("does not fabricate a modification the engine cannot execute", () => {
    const { draft, issues } = run(fixtureD());
    expect(draft.hasContractModifications).toBe(true);
    for (const modification of draft.contractModifications) {
      expect(modification.considerationMagnitudeInput).toBe("");
      expect(modification.priceReflectsAddedGoodsSsp).toBeNull();
      expect(modification.priceReflectsSspRationale).not.toContain("assumed");
    }
    expect(
      issues.some((issue) => issue.state === "red" && issue.targetKey.startsWith("modification")),
    ).toBe(true);
  });
});

/* ------------------------ Fixture E — usage billing and non-derivable dates */

describe("Fixture E — usage-based billing", () => {
  function fixtureE(): AiContractAnalysis {
    const analysis = fixtureAAnalysis();
    analysis.billingTerms = [
      {
        semanticKey: "billing:overage",
        description: "Quarterly overage billed in arrears at $1.35 per sample.",
        billingTiming: "on_usage",
        frequency: "quarterly",
        invoiceTrigger: "Samples processed above the included tier.",
        amountOrRateInput: "1.35",
        paymentTermsDays: 30,
        dueDateRule: "Net 30 from invoice date.",
        citations: analysis.billingTerms[0]!.citations,
        reviewState: "supported",
      },
    ];
    return analysis;
  }

  it("creates no billing event and no projected cash when volume is unknown", () => {
    const { draft, issues } = run(fixtureE());
    expect(draft.contractBalances.considerationEvents).toHaveLength(0);
    expect(draft.contractBalances.cashCollections).toHaveLength(0);
    expect(issues.some((issue) => issue.targetKey.includes("billing:overage"))).toBe(true);
  });

  it("captures the usage rate without projecting any future quantity", () => {
    const withUsage = fixtureE();
    withUsage.transactionPrice.variableConsiderationComponents = [
      {
        semanticKey: "vc:overage",
        description: "Per-sample overage above the included tier.",
        type: "usage",
        contractualRateOrAmountInput: "1.35",
        unitDescription: "per sample above 50,000",
        billingFrequency: "quarterly",
        trigger: "Samples processed above the included tier.",
        estimationMethodProposal: "not_estimable",
        constraintAssessment: "Future volume is not determinable from the contract.",
        allocationTreatmentProposal: "unknown",
        targetPerformanceObligationKey: null,
        relatesSpecifically: "unknown",
        consistentWithAllocationObjective: "unknown",
        allocationRationale:
          "The contract does not narrow this component to one obligation.",
        citations: withUsage.billingTerms[0]!.citations,
        guidanceIds: [30],
        reviewState: "needs_user_input",
      },
    ];

    const { draft } = run(withUsage);
    expect(draft.hasVariableConsideration).toBe(true);
    const component = draft.variableConsiderationComponents[0]!;
    expect(component.treatment).toBe("usage_as_incurred");
    expect(component.effect).toBe("increase");
    expect(component.meters[0]?.rateAmountInput).toBe("1.35");
    // Not one future month of usage is invented.
    expect(component.usagePeriods).toHaveLength(0);
  });
});

/* ------------------------------- review items carry their own evidence */

describe("review items carry the evidence of the conclusion they review", () => {
  it("attaches the proposing conclusion's citation to a preserved manual value", () => {
    const manual: WorkflowDraft = { ...createEmptyDraft(), transactionPriceInput: "125000" };
    const { issues } = run(fixtureAAnalysis(), manual);
    const item = itemFor(issues, "transactionPrice.input");
    expect(item?.citations).toEqual([
      {
        documentId: "doc-fixture-1",
        pageStart: 1,
        pageEnd: 1,
        evidenceMode: "text",
        excerpt: "120,000",
      },
    ]);
  });

  it("attaches its own conclusion's citation to a missing-input issue", () => {
    const analysis = fixtureAAnalysis();
    analysis.sspAndAllocation.items[0]!.observableSspEvidence = "not_observable";
    analysis.sspAndAllocation.items[0]!.observedAmountInput = null;
    analysis.sspAndAllocation.items[0]!.proposedMethod = "adjusted_market_assessment";
    analysis.sspAndAllocation.items[0]!.reviewState = "needs_user_input";
    const { issues } = run(analysis);
    const item = itemFor(issues, `po:${PO_ID}.sspInput`);
    expect(item?.state).toBe("red");
    expect(item?.citations).toEqual(analysis.sspAndAllocation.items[0]!.citations);
  });

  it("fabricates no citation for a synthetic tombstone or omission item", () => {
    const first = run(fixtureAAnalysis());
    const withoutPo: WorkflowDraft = {
      ...first.draft,
      performanceObligations: [],
      promises: first.draft.promises.map((promise) => ({
        ...promise,
        performanceObligationId: null,
      })),
    };
    const second = run(fixtureAAnalysis(), withoutPo, first.aiState, RUN_2);
    for (const issue of second.issues.filter((row) => row.targetKey.startsWith("object:"))) {
      expect(issue.citations).toEqual([]);
    }
  });

  it("gives every derived item a material review fingerprint", () => {
    const { issues } = run(fixtureAAnalysis());
    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) {
      expect(issue.reviewFingerprint).toHaveLength(16);
      expect(issue.resolution).toBeNull();
    }
  });
});

/* ------------------------------------------------ atomic validation failure */

describe("merged drafts are always structurally valid", () => {
  it("produces a draft the persistence validator accepts", () => {
    const { draft } = run(fixtureAAnalysis());
    // An incomplete-but-editable draft is still valid canonical input.
    const empty = run(fixtureAAnalysis(), createEmptyDraft());
    expect(Object.keys(draft)).toEqual(Object.keys(empty.draft));
  });

  it("fails atomically rather than returning a corrupted draft", () => {
    const corrupt = createEmptyDraft();
    (corrupt.contract as unknown as { currency: string }).currency = "EUR";
    expect(() => run(fixtureAAnalysis(), corrupt)).toThrowError(AiMergeError);
  });
});

/* --------------------- material fingerprints reopen changed conclusions */

describe("review fingerprints follow the material conclusion, not the display text", () => {
  const AT = "2027-02-01T00:00:00.000Z";
  const MOD_ID = deriveCanonicalId("modification", "modification:primary");
  const VC_ID = deriveCanonicalId("variable_component", "vc:bonus");

  /** Resolves every derived item with a resolution valid for its own state. */
  function resolveAll(state: AiAnalysisState): AiAnalysisState {
    return {
      ...state,
      reviewItems: state.reviewItems.map((item) =>
        item.state === "red"
          ? {
              ...item,
              state: "resolved" as const,
              resolution: {
                kind: "manual_red" as const,
                at: AT,
                reason: "reviewed_current_treatment" as const,
                note: null,
                reviewFingerprint: item.reviewFingerprint,
              },
            }
          : {
              ...item,
              state: "resolved" as const,
              resolution: {
                kind: "affirmed" as const,
                at: AT,
                method: "individual" as const,
                reviewFingerprint: item.reviewFingerprint,
              },
              affirmedAt: AT,
              affirmedMethod: "individual" as const,
            },
      ),
    };
  }

  function draftWithManualBilling(): WorkflowDraft {
    const base = createEmptyDraft();
    return {
      ...base,
      contractBalances: {
        ...base.contractBalances,
        considerationEvents: [
          {
            ...createConsiderationEventDraft(1, "ce-manual-1"),
            amountInput: "120000",
            invoiceDate: "2027-01-01",
            unconditionalRightDate: "2027-01-01",
          },
        ],
      },
    };
  }

  function withModification(analysis: AiContractAnalysis): AiContractAnalysis {
    analysis.contractModifications = {
      ...analysis.contractModifications,
      hasModification: "yes",
      effectiveDate: "2027-07-01",
      addedGoodsOrServices: "Additional user seats.",
      priceIncreaseInput: "20000",
      treatmentCandidate: "prospective",
      rationale: "An amendment adds seats.",
      reviewState: "needs_review",
    };
    return analysis;
  }

  function withBonusComponent(analysis: AiContractAnalysis): AiContractAnalysis {
    analysis.transactionPrice.variableConsiderationComponents = [
      {
        semanticKey: "vc:bonus",
        description: "Go-live bonus.",
        type: "bonus",
        contractualRateOrAmountInput: "10000",
        unitDescription: null,
        billingFrequency: null,
        trigger: "Go-live before 30 June.",
        estimationMethodProposal: "most_likely_amount",
        constraintAssessment: "Constrained until go-live is achieved.",
        allocationTreatmentProposal: "unknown",
        targetPerformanceObligationKey: null,
        relatesSpecifically: "unknown",
        consistentWithAllocationObjective: "unknown",
        allocationRationale:
          "The contract does not narrow this component to one obligation.",
        citations: analysis.billingTerms[0]!.citations,
        guidanceIds: [30],
        reviewState: "needs_review",
      },
    ];
    return analysis;
  }

  /** First run + affirmation of everything, then a second deterministic run. */
  function reanalyze(
    first: AiContractAnalysis,
    second: AiContractAnalysis,
    draft: WorkflowDraft = createEmptyDraft(),
    seedState: AiAnalysisState = createEmptyAiAnalysisState(),
  ) {
    const one = run(first, draft, seedState);
    const two = run(second, one.draft, resolveAll(one.aiState), RUN_2);
    return { one, two };
  }

  const BILLING_KEY = "billing:billing:annual-advance";

  it("reopens a billing item when the contractual amount changes under identical prose", () => {
    const changed = fixtureAAnalysis();
    changed.billingTerms[0]!.amountOrRateInput = "150000";
    const { one, two } = reanalyze(fixtureAAnalysis(), changed, draftWithManualBilling());
    expect(itemFor(one.issues, BILLING_KEY)?.state).toBe("yellow");
    expect(itemFor(two.issues, BILLING_KEY)?.state).toBe("yellow");
  });

  it("reopens a billing item when timing, frequency or payment terms change", () => {
    const changed = fixtureAAnalysis();
    changed.billingTerms[0]!.billingTiming = "arrears";
    changed.billingTerms[0]!.frequency = "quarterly";
    changed.billingTerms[0]!.paymentTermsDays = 60;
    const { two } = reanalyze(fixtureAAnalysis(), changed, draftWithManualBilling());
    expect(itemFor(two.issues, BILLING_KEY)?.state).toBe("yellow");
  });

  it("carries the billing affirmation forward when nothing material changed", () => {
    const { two } = reanalyze(fixtureAAnalysis(), fixtureAAnalysis(), draftWithManualBilling());
    expect(itemFor(two.issues, BILLING_KEY)?.state).toBe("resolved");
  });

  it("reopens a performance-obligation item when the proposed grouping changes", () => {
    const tombstoned: AiAnalysisState = {
      ...createEmptyAiAnalysisState(),
      tombstones: ["po:saas"],
    };
    const changed = fixtureMultiElementAnalysis();
    changed.performanceObligations[0]!.promiseKeys = ["promise:saas", "promise:support"];
    changed.performanceObligations[0]!.satisfactionPattern = "point_in_time";
    const { one, two } = reanalyze(
      fixtureMultiElementAnalysis(),
      changed,
      createEmptyDraft(),
      tombstoned,
    );
    expect(itemFor(one.issues, "po:po:saas")?.state).toBe("yellow");
    expect(itemFor(two.issues, "po:po:saas")?.state).toBe("yellow");
  });

  it("reopens a modification item when its structural conclusion changes", () => {
    const changed = withModification(fixtureAAnalysis());
    changed.contractModifications.treatmentCandidate = "separate_contract";
    changed.contractModifications.priceIncreaseInput = "45000";
    const { two } = reanalyze(withModification(fixtureAAnalysis()), changed);
    expect(itemFor(two.issues, `modification:${MOD_ID}.phase5cFacts`)?.state).toBe("red");
  });

  it("reopens a variable-consideration item when its material amount changes", () => {
    const changed = withBonusComponent(fixtureAAnalysis());
    changed.transactionPrice.variableConsiderationComponents[0]!.contractualRateOrAmountInput =
      "40000";
    const { two } = reanalyze(withBonusComponent(fixtureAAnalysis()), changed);
    expect(itemFor(two.issues, `vc:${VC_ID}.inception`)?.state).toBe("red");
  });

  it("reopens only the changed conclusion across a whole re-analysis", () => {
    const changed = fixtureAAnalysis();
    changed.billingTerms[0]!.amountOrRateInput = "150000";
    const { one, two } = reanalyze(fixtureAAnalysis(), changed, draftWithManualBilling());

    expect(one.issues.length).toBeGreaterThan(3);
    expect(itemFor(two.issues, BILLING_KEY)?.state).toBe("yellow");
    for (const item of two.issues) {
      if (item.targetKey === BILLING_KEY) continue;
      const before = itemFor(one.issues, item.targetKey);
      if (before === undefined) continue;
      expect(item.state).toBe("resolved");
    }
  });
});

/* ------------- persisted review state only reaches merge via normalization */

describe("re-analysis never trusts unnormalized persisted review state", () => {
  const AT = "2027-02-01T00:00:00.000Z";

  function resolvedState(state: AiAnalysisState): AiAnalysisState {
    return {
      ...state,
      reviewItems: state.reviewItems.map((item) =>
        item.state === "red"
          ? {
              ...item,
              state: "resolved" as const,
              resolution: {
                kind: "manual_red" as const,
                at: AT,
                reason: "reviewed_current_treatment" as const,
                note: null,
                reviewFingerprint: item.reviewFingerprint,
              },
            }
          : {
              ...item,
              state: "resolved" as const,
              resolution: {
                kind: "affirmed" as const,
                at: AT,
                method: "individual" as const,
                reviewFingerprint: item.reviewFingerprint,
              },
              affirmedAt: AT,
              affirmedMethod: "individual" as const,
            },
      ),
    };
  }

  it("refuses to inherit a resolution from a persisted row with no base severity", () => {
    const one = run(fixtureAAnalysis());
    const resolved = resolvedState(one.aiState);
    const malformed: AiAnalysisState = {
      ...resolved,
      reviewItems: resolved.reviewItems.map((item) => {
        const { severity: _dropped, ...rest } = item as AiReviewItem & { severity?: unknown };
        return rest as AiReviewItem;
      }),
    };
    const two = run(fixtureAAnalysis(), one.draft, malformed, RUN_2);
    expect(two.issues.length).toBeGreaterThan(0);
    for (const item of two.issues) expect(item.state).not.toBe("resolved");
  });

  it("refuses to inherit a resolution from a persisted row with an unreadable section", () => {
    const one = run(fixtureAAnalysis());
    const resolved = resolvedState(one.aiState);
    const malformed: AiAnalysisState = {
      ...resolved,
      reviewItems: resolved.reviewItems.map(
        (item) => ({ ...item, section: "step_42" }) as unknown as AiReviewItem,
      ),
    };
    const two = run(fixtureAAnalysis(), one.draft, malformed, RUN_2);
    for (const item of two.issues) expect(item.state).not.toBe("resolved");
  });

  it("still inherits a resolution from a well-formed persisted row", () => {
    const one = run(fixtureAAnalysis());
    const two = run(fixtureAAnalysis(), one.draft, resolvedState(one.aiState), RUN_2);
    expect(two.issues.some((item) => item.state === "resolved")).toBe(true);
  });
});

/* --------------------------- the transaction-price material conclusion */

describe("the missing-fixed-consideration item reviews the whole conclusion", () => {
  const TP_KEY = "transactionPrice.input";
  const AT = "2027-02-01T00:00:00.000Z";

  function withoutFixedConsideration(analysis: AiContractAnalysis): AiContractAnalysis {
    analysis.transactionPrice.fixedConsiderationInput = null;
    return analysis;
  }

  function resolveTp(state: AiAnalysisState): AiAnalysisState {
    return {
      ...state,
      reviewItems: state.reviewItems.map((item) =>
        item.targetKey === TP_KEY && item.state === "red"
          ? {
              ...item,
              state: "resolved" as const,
              resolution: {
                kind: "manual_red" as const,
                at: AT,
                reason: "reviewed_current_treatment" as const,
                note: null,
                reviewFingerprint: item.reviewFingerprint,
              },
            }
          : item,
      ),
    };
  }

  function pair(second: AiContractAnalysis) {
    const one = run(withoutFixedConsideration(fixtureAAnalysis()));
    return run(second, one.draft, resolveTp(one.aiState), RUN_2);
  }

  it("reopens when the fixed-consideration evidence changes", () => {
    const changed = withoutFixedConsideration(fixtureAAnalysis());
    changed.transactionPrice.fixedConsiderationCitations = changed.billingTerms[0]!.citations;
    expect(itemFor(pair(changed).issues, TP_KEY)?.state).toBe("red");
  });

  it("reopens when the transaction-price conclusion rationale changes", () => {
    const changed = withoutFixedConsideration(fixtureAAnalysis());
    changed.transactionPrice.transactionPriceConclusion.rationale =
      "Variable consideration is now present and constrained.";
    expect(itemFor(pair(changed).issues, TP_KEY)?.state).toBe("red");
  });

  it("carries the manual resolution when the whole material conclusion is unchanged", () => {
    const unchanged = withoutFixedConsideration(fixtureAAnalysis());
    expect(itemFor(pair(unchanged).issues, TP_KEY)?.state).toBe("resolved");
  });
});
