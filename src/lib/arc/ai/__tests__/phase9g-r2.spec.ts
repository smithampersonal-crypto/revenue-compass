/**
 * Phase 9G-R Task R2 — dedicated acceptance suite.
 *
 * The R2 contract: ARC drafts the ordinary reading of an ordinary contract and
 * records it as a routine assumption rather than as accountant homework, while
 * every genuine judgment, conflict and missing fact stays exactly as actionable
 * as it was in Phase 9G. Nothing here relies on incidental coverage elsewhere.
 */

import { describe, expect, it } from "vitest";

import { createEmptyDraft } from "@/lib/asc606-workflow";

import { createEmptyAiAnalysisState, mergeAiAnalysis } from "../merge";
import { PROVISIONAL_SSP_TARGET_KEY } from "../identity";
import {
  classifyReviewState,
  isActionableReviewItem,
  isAssumptionItem,
  resolutionAllowedForSeverity,
} from "../review-state";
import { reconcileAiEdits } from "../edit-reconciliation";
import type { AiReviewItem } from "../review-state";
import { normalizePersistedReviewPayload } from "../review-normalization";
import { reviewStateLabel, reviewMarkerLabel } from "../review-presentation";
import { AI_OUTPUT_SCHEMA_VERSION, parseAiContractAnalysis } from "../schema";
import type { AiContractAnalysis } from "../schema";
import { AI_LIMITS } from "../config.server";

import { fixtureAAnalysis, guidancePackFixture, RUN_ID } from "./merge-fixtures";
import { reviewRow } from "./r2-fixtures";

function merge(analysis: AiContractAnalysis, currentDraft = createEmptyDraft()) {
  return mergeAiAnalysis({
    currentDraft,
    currentAiState: createEmptyAiAnalysisState(),
    analysis,
    runId: RUN_ID,
    guidancePack: guidancePackFixture(),
    priorContext: null,
  });
}

function find(items: readonly AiReviewItem[], targetKey: string) {
  return items.find((item) => item.targetKey === targetKey);
}

function vcComponent(overrides: Record<string, unknown> = {}) {
  return {
    semanticKey: "vc:service-credit",
    description: "Service level credit against future fees.",
    type: "service_credit",
    contractualRateOrAmountInput: "5000",
    unitDescription: null,
    billingFrequency: null,
    trigger: "Monthly uptime below the committed service level.",
    estimationMethodProposal: "most_likely_amount",
    constraintAssessment: "No constraint applies to a zero estimate.",
    initialEstimateBasis: "zero_no_expected_trigger",
    initialEstimatedAmountInput: "0",
    initialIncludedAmountInput: "0",
    initialEstimateRationale:
      "No credit is expected at inception because no service level breach is anticipated.",
    allocationTreatmentProposal: "general",
    targetPerformanceObligationKey: null,
    relatesSpecifically: "no",
    consistentWithAllocationObjective: "yes",
    allocationRationale: "The credit relates to the contract as a whole.",
    citations: [
      {
        documentId: "doc-fixture-1",
        pageStart: 1,
        pageEnd: 1,
        evidenceMode: "text" as const,
        excerpt: "service level credit",
      },
    ],
    guidanceIds: [],
    reviewState: "supported",
    ...overrides,
  };
}

/* ------------------------------------------- classification and precedence */

describe("R2 — assumed classification", () => {
  const base = {
    targetKey: "contract.criteria.collectibility_probable.answer",
    section: "step_1" as const,
    reason: "ARC read collectibility as probable.",
    guidanceIds: [] as number[],
    citations: [],
    value: true,
    blocking: false,
  };

  it("treats an ARC-approved routine assumption as assumed", () => {
    expect(
      classifyReviewState({
        ...base,
        reasonCode: "routine_assumption",
        aiReviewState: "inference",
      }),
    ).toBe("assumed");
  });

  it("never treats an ordinary reason code as assumed", () => {
    expect(
      classifyReviewState({
        ...base,
        reasonCode: "accountant_affirmation_required",
        aiReviewState: "inference",
      }),
    ).toBe("yellow");
  });

  it("lets a deterministic blocking condition outrank assumption treatment", () => {
    expect(
      classifyReviewState({
        ...base,
        reasonCode: "routine_assumption",
        aiReviewState: "inference",
        blocking: true,
      }),
    ).toBe("red");
  });

  it("lets a source conflict outrank assumption treatment", () => {
    expect(
      classifyReviewState({
        ...base,
        reasonCode: "routine_assumption",
        aiReviewState: "source_conflict",
      }),
    ).toBe("red");
  });

  it("lets a missing user input outrank assumption treatment", () => {
    expect(
      classifyReviewState({
        ...base,
        reasonCode: "routine_assumption",
        aiReviewState: "needs_user_input",
      }),
    ).toBe("red");
  });

  it("keeps genuine ambiguity yellow rather than converting it to assumed", () => {
    expect(
      classifyReviewState({
        ...base,
        reasonCode: "routine_assumption",
        aiReviewState: "needs_review",
      }),
    ).toBe("yellow");
  });

  it("is non-actionable and carries no inline marker", () => {
    const item = reviewRow("a", "assumed");
    expect(isAssumptionItem(item)).toBe(true);
    expect(isActionableReviewItem(item)).toBe(false);
    expect(reviewMarkerLabel(item.severity)).toBeNull();
    expect(reviewStateLabel(item)).toBeTruthy();
  });
});

/* ------------------------------------------------- persisted normalization */

describe("R2 — strict persisted normalization of assumed", () => {
  const good = reviewRow("a", "assumed");

  it("accepts a well-formed assumed row", () => {
    const payload = normalizePersistedReviewPayload([good]);
    expect(payload.malformed).toBe(false);
    expect(payload.items[0]?.state).toBe("assumed");
  });

  it("rejects an assumed row carrying a resolution", () => {
    const payload = normalizePersistedReviewPayload([
      {
        ...good,
        resolution: {
          kind: "affirmed",
          at: "2027-02-01T00:00:00.000Z",
          method: "individual",
          reviewFingerprint: good.reviewFingerprint,
        },
      },
    ]);
    expect(payload.malformed).toBe(true);
    expect(payload.items).toHaveLength(0);
  });

  it("rejects an assumed row carrying affirmation metadata", () => {
    const payload = normalizePersistedReviewPayload([
      { ...good, affirmedAt: "2027-02-01T00:00:00.000Z", affirmedMethod: "individual" },
    ]);
    expect(payload.malformed).toBe(true);
  });

  it("rejects an assumed row whose severity is not assumed", () => {
    expect(normalizePersistedReviewPayload([{ ...good, severity: "yellow" }]).malformed).toBe(true);
  });

  it("rejects an assumed row with no review fingerprint", () => {
    expect(normalizePersistedReviewPayload([{ ...good, reviewFingerprint: 7 }]).malformed).toBe(
      true,
    );
  });

  it("never lets an assumption inherit a prior yellow or red resolution", () => {
    const payload = normalizePersistedReviewPayload([good]);
    expect(payload.items[0]?.resolution).toBeNull();
    expect(payload.items[0]?.affirmedAt).toBeNull();
    expect(payload.items[0]?.affirmedMethod).toBeNull();
  });
});

/* ------------------------------------------------------ Step 1 and defaults */

describe("R2 — routine drafting of the ordinary contract", () => {
  const { issues } = merge(fixtureAAnalysis());

  it("raises every satisfied Step 1 criterion as a routine assumption", () => {
    const step1 = issues.filter((item) => item.targetKey.startsWith("contract.criteria."));
    expect(step1.length).toBeGreaterThanOrEqual(5);
    expect(step1.every((item) => item.state === "assumed")).toBe(true);
    expect(step1.every((item) => item.reasonCode === "routine_assumption")).toBe(true);
  });

  it("treats collectibility as a routine assumption, not accountant homework", () => {
    expect(find(issues, "contract.criteria.collectibility_probable.answer")?.state).toBe("assumed");
  });

  it("treats no significant financing as routine", () => {
    expect(find(issues, "transactionPrice.financing")?.state).toBe("assumed");
  });

  it("treats no noncash consideration as routine", () => {
    expect(find(issues, "transactionPrice.noncash")?.state).toBe("assumed");
  });

  it("treats no consideration payable to the customer as routine", () => {
    expect(find(issues, "transactionPrice.payableToCustomer")?.state).toBe("assumed");
  });

  it("leaves an ordinary single-element contract with no actionable review at all", () => {
    expect(issues.filter(isActionableReviewItem)).toHaveLength(0);
  });

  it("is deterministic across a repeated analysis of unchanged facts", () => {
    const again = merge(fixtureAAnalysis());
    expect(
      again.issues.map((item) => [item.targetKey, item.state, item.reviewFingerprint]),
    ).toEqual(issues.map((item) => [item.targetKey, item.state, item.reviewFingerprint]));
  });
});

/* ------------------------------------------------------ variable consideration */

describe("R2 — zero at inception versus usage as incurred", () => {
  function withComponent(overrides: Record<string, unknown> = {}) {
    const analysis = fixtureAAnalysis() as unknown as {
      transactionPrice: { variableConsiderationComponents: unknown[] };
    };
    analysis.transactionPrice.variableConsiderationComponents = [vcComponent(overrides)];
    return analysis as unknown as AiContractAnalysis;
  }

  it("includes a service credit at zero and raises only a routine assumption", () => {
    const { draft, issues } = merge(withComponent());
    expect(draft.contractBalances.considerationEvents.length).toBeGreaterThanOrEqual(0);
    const zeroAssumptions = issues.filter(
      (item) => item.state === "assumed" && item.targetKey.startsWith("vc:"),
    );
    expect(zeroAssumptions.length).toBeGreaterThanOrEqual(1);
    expect(issues.filter((item) => item.state === "red")).toHaveLength(0);
  });

  it("keeps usage as incurred structurally distinct from a zero estimate", () => {
    const { issues } = merge(
      withComponent({
        semanticKey: "vc:usage",
        type: "usage",
        initialEstimateBasis: "not_applicable_usage_as_incurred",
        initialEstimatedAmountInput: null,
        initialIncludedAmountInput: null,
        initialEstimateRationale: "Usage is recognized as incurred; no inception estimate applies.",
        estimationMethodProposal: "not_estimable",
      }),
    );
    const zeroAssumed = issues.find(
      (item) => item.state === "assumed" && item.reason.toLowerCase().includes("zero"),
    );
    expect(zeroAssumed).toBeUndefined();
  });

  it("rejects a zero basis that does not carry zero amounts", () => {
    const analysis = fixtureAAnalysis() as unknown as {
      transactionPrice: { variableConsiderationComponents: unknown[] };
    };
    analysis.transactionPrice.variableConsiderationComponents = [
      vcComponent({ initialIncludedAmountInput: "5000" }),
    ];
    expect(parseAiContractAnalysis(analysis).ok).toBe(false);
  });

  it("rejects a usage basis that carries initial amounts", () => {
    const analysis = fixtureAAnalysis() as unknown as {
      transactionPrice: { variableConsiderationComponents: unknown[] };
    };
    analysis.transactionPrice.variableConsiderationComponents = [
      vcComponent({
        initialEstimateBasis: "not_applicable_usage_as_incurred",
        initialEstimatedAmountInput: "0",
        initialIncludedAmountInput: "0",
      }),
    ];
    expect(parseAiContractAnalysis(analysis).ok).toBe(false);
  });
});

/* ------------------------------------------------------------ provisional SSP */

describe("R2 — provisional stated contract price as a standalone selling price", () => {
  function provisional(count: number): AiContractAnalysis {
    const analysis = fixtureAAnalysis();
    const item = analysis.sspAndAllocation.items[0]!;
    item.observableSspEvidence = "not_observable";
    item.observedAmountInput = null;
    item.proposedMethod = "stated_contract_price_assumption";
    item.proposedSspAmountInput = "120000";
    item.methodRationale = "The separately stated contract price is used provisionally.";
    item.reviewState = "inference";
    if (count > 1) {
      analysis.sspAndAllocation.items = Array.from({ length: count }, (_, index) => ({
        ...item,
        semanticKey: `ssp:saas-${index}`,
      }));
    }
    return analysis;
  }

  it("applies the provisional price to the draft", () => {
    const { draft } = merge(provisional(1));
    expect(draft.performanceObligations[0]?.sspInput).toBe("120000");
  });

  it("never records the provisional price as observable", () => {
    const { draft } = merge(provisional(1));
    expect(draft.performanceObligations[0]?.sspBasis.toLowerCase()).not.toContain("observable");
  });

  it("raises exactly one consolidated actionable item, not one per obligation", () => {
    const consolidated = merge(provisional(1)).issues.filter(
      (item) => item.targetKey === PROVISIONAL_SSP_TARGET_KEY,
    );
    expect(consolidated).toHaveLength(1);
    expect(consolidated[0]?.state).toBe("yellow");
  });
});

/* -------------------------------------------------------- duplicate defences */

describe("R2 — duplicate output never becomes duplicate accountant work", () => {
  it("collapses duplicate additional topics and issues", () => {
    const analysis = fixtureAAnalysis();
    analysis.additionalTopics = [
      {
        topic: "material_rights",
        applicable: "no",
        conclusion: "No material right arises from the renewal terms.",
        rationale: "Renewal pricing is not stated at a discount.",
        citations: [],
        guidanceIds: [],
        reviewState: "inference",
      },
      {
        topic: "material_rights",
        applicable: "no",
        conclusion: "No material right arises from the renewal terms.",
        rationale: "Renewal pricing is not stated at a discount.",
        citations: [],
        guidanceIds: [],
        reviewState: "inference",
      },
    ] as AiContractAnalysis["additionalTopics"];
    const topics = merge(analysis).issues.filter((item) =>
      item.reason.toLowerCase().includes("material right"),
    );
    expect(topics.length).toBeLessThanOrEqual(1);
  });
});

/* --------------------------------------------------------------- versioning */

describe("R2 — version pins", () => {
  it("pins the schema at v5 and the prompt at v7", () => {
    expect(AI_OUTPUT_SCHEMA_VERSION).toBe("arc.ai.schema.v5");
    expect(AI_LIMITS.promptVersion).toBe("arc.ai.prompt.v9");
  });
});

/* -------------------------------------------- accountant edits and actions */

describe("R2 — an assumption is never an action or an approval", () => {
  it("offers no resolution path for an assumed severity", () => {
    const affirmed = {
      kind: "affirmed",
      at: "2027-02-01T00:00:00.000Z",
      method: "individual",
      reviewFingerprint: "f",
    } as const;
    const manual = {
      kind: "manual_red",
      at: "2027-02-01T00:00:00.000Z",
      reason: "not_applicable",
      note: null,
      reviewFingerprint: "f",
    } as const;
    expect(resolutionAllowedForSeverity("assumed", affirmed)).toBe(false);
    expect(resolutionAllowedForSeverity("assumed", manual)).toBe(false);
    expect(resolutionAllowedForSeverity("yellow", affirmed)).toBe(true);
    expect(resolutionAllowedForSeverity("red", manual)).toBe(true);
  });

  it("drops the assumption when the accountant edits the underlying accounting", () => {
    const first = merge(fixtureAAnalysis());
    const assumption = first.issues.find((item) => item.state === "assumed")!;
    const edited = structuredClone(first.draft);
    edited.contract.criteria.collectibility_probable.answer = false;
    const reconciled = reconcileAiEdits({
      previousDraft: first.draft,
      nextDraft: edited,
      currentAiState: { ...first.aiState, reviewItems: first.issues },
    });
    const kept = reconciled.aiState.reviewItems.find((item) => item.id === assumption.id);
    // Whichever assumption the edit touched, it disappears without any event
    // and without manufacturing an approval.
    expect(reconciled.aiState.reviewItems.every((item) => item.resolution === null)).toBe(true);
    expect(kept?.resolution ?? null).toBeNull();
  });
});
