/**
 * Phase 9G-R Task R2 — synthetic Genomix benchmark.
 *
 * A fictional two-element Genomix platform contract with a service credit, a
 * usage fee, one provisionally priced obligation and one genuinely missing
 * standalone selling price. No model is called: the analysis object is the
 * exact shape a run would produce, so the benchmark measures merge policy only.
 *
 * The benchmark's purpose is to show that R2 removes routine accountant work
 * while every real judgment survives untouched.
 */

import { describe, expect, it } from "vitest";

import { createEmptyDraft } from "@/lib/asc606-workflow";

import { createEmptyAiAnalysisState, mergeAiAnalysis } from "../merge";
import { PROVISIONAL_SSP_TARGET_KEY } from "../identity";
import { isActionableReviewItem, isAssumptionItem } from "../review-state";
import type { AiContractAnalysis } from "../schema";
import { parseAiContractAnalysis } from "../schema";

import { fixtureMultiElementAnalysis, guidancePackFixture, RUN_ID } from "./merge-fixtures";

function genomixAnalysis(): AiContractAnalysis {
  const analysis = fixtureMultiElementAnalysis();
  analysis.analysisSummary = "Genomix platform subscription with premium support.";

  // Full-term fixed consideration (R1 behaviour, unchanged).
  analysis.transactionPrice.fixedConsiderationInput = "150000";
  analysis.billingTerms = [
    {
      ...analysis.billingTerms[0]!,
      amountOrRateInput: "12500",
      frequency: "monthly",
      description: "Monthly platform invoice.",
    },
  ];

  // Two variable components: one reasonably zero at inception, one recognized
  // as incurred. They must not be treated the same way.
  analysis.transactionPrice.variableConsiderationComponents = [
    {
      semanticKey: "vc:service-credit",
      description: "Uptime service level credit.",
      type: "service_credit",
      contractualRateOrAmountInput: "5000",
      unitDescription: null,
      billingFrequency: null,
      trigger: "Monthly uptime below 99.9 percent.",
      estimationMethodProposal: "most_likely_amount",
      constraintAssessment: "No constraint applies to an expected zero outcome.",
      initialEstimateBasis: "zero_no_expected_trigger",
      initialEstimatedAmountInput: "0",
      initialIncludedAmountInput: "0",
      initialEstimateRationale: "No service level breach is expected at contract inception.",
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
    },
    {
      semanticKey: "vc:overage",
      description: "Per-sample sequencing overage fee.",
      type: "usage",
      contractualRateOrAmountInput: "12",
      unitDescription: "sample",
      billingFrequency: "monthly",
      trigger: "Samples processed above the included volume.",
      estimationMethodProposal: "not_estimable",
      constraintAssessment: "Usage is recognized as it is incurred.",
      initialEstimateBasis: "not_applicable_usage_as_incurred",
      initialEstimatedAmountInput: null,
      initialIncludedAmountInput: null,
      initialEstimateRationale: "Usage is recognized as incurred; no inception estimate applies.",
      allocationTreatmentProposal: "specific_po",
      targetPerformanceObligationKey: "po:saas",
      relatesSpecifically: "yes",
      consistentWithAllocationObjective: "yes",
      allocationRationale: "The overage relates to the platform obligation only.",
      citations: [
        {
          documentId: "doc-fixture-1",
          pageStart: 1,
          pageEnd: 1,
          evidenceMode: "text" as const,
          excerpt: "overage",
        },
      ],
      guidanceIds: [],
      reviewState: "supported",
    },
  ] as AiContractAnalysis["transactionPrice"]["variableConsiderationComponents"];

  // Support is priced provisionally from the stated contract price; the
  // platform obligation has a genuinely unknown standalone selling price.
  const [platform, support] = analysis.sspAndAllocation.items as [
    AiContractAnalysis["sspAndAllocation"]["items"][number],
    AiContractAnalysis["sspAndAllocation"]["items"][number],
  ];
  platform.observableSspEvidence = "not_observable";
  platform.observedAmountInput = null;
  platform.proposedMethod = "insufficient_information";
  platform.proposedSspAmountInput = null;
  platform.methodRationale = "No standalone platform pricing is available.";
  platform.missingInformation = "A standalone selling price for the platform is required.";
  platform.reviewState = "needs_user_input";
  support.observableSspEvidence = "not_observable";
  support.observedAmountInput = null;
  support.proposedMethod = "stated_contract_price_assumption";
  support.proposedSspAmountInput = "30000";
  support.methodRationale = "The separately stated support price is used provisionally.";
  support.reviewState = "inference";

  // Duplicate model output must not become duplicate accountant work.
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

  return analysis;
}

function runGenomix() {
  return mergeAiAnalysis({
    currentDraft: createEmptyDraft(),
    currentAiState: createEmptyAiAnalysisState(),
    analysis: genomixAnalysis(),
    runId: RUN_ID,
    guidancePack: guidancePackFixture(),
    priorContext: null,
  });
}

describe("Phase 9G-R Task R2 — synthetic Genomix benchmark", () => {
  it("is a schema-valid v5 analysis", () => {
    expect(parseAiContractAnalysis(genomixAnalysis()).ok).toBe(true);
  });

  it("keeps the full-term fixed consideration deterministic (R1)", () => {
    const { draft } = runGenomix();
    expect(draft.transactionPriceInput).toBe("150000.00");
  });

  it("leaves a small, meaningful actionable queue", () => {
    const actionable = runGenomix().issues.filter(isActionableReviewItem);
    expect(actionable.length).toBeGreaterThanOrEqual(2);
    expect(actionable.length).toBeLessThanOrEqual(6);
  });

  it("moves the routine conclusions out of that queue", () => {
    const { issues } = runGenomix();
    expect(issues.filter(isAssumptionItem).length).toBeGreaterThanOrEqual(6);
  });

  it("still raises the genuinely missing standalone selling price", () => {
    const actionable = runGenomix().issues.filter(isActionableReviewItem);
    expect(actionable.some((item) => item.state === "red")).toBe(true);
  });

  it("keeps the provisional price visibly provisional and consolidated", () => {
    const { draft, issues } = runGenomix();
    const provisional = issues.filter((item) => item.targetKey === PROVISIONAL_SSP_TARGET_KEY);
    expect(provisional).toHaveLength(1);
    expect(
      draft.performanceObligations.some((po) => po.sspBasis.toLowerCase().includes("observable")),
    ).toBe(false);
  });

  it("does not let duplicate model output create duplicate interventions", () => {
    const renewals = runGenomix().issues.filter((item) =>
      item.reason.toLowerCase().includes("material right"),
    );
    expect(renewals.length).toBeLessThanOrEqual(1);
  });

  it("is deterministic across repeated analysis", () => {
    const first = runGenomix().issues.map((item) => [item.targetKey, item.state]);
    const second = runGenomix().issues.map((item) => [item.targetKey, item.state]);
    expect(second).toEqual(first);
  });
});
