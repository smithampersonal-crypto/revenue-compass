/**
 * ARC v1 — the Genomix re-analysis condition, end to end through the firewall.
 *
 * This is the real-world case the whole safety gate exists for: a later model
 * run describes the hosted platform and its included throughput allowance as a
 * SINGLE promise, where the accountant's analysis carries two. Nothing about
 * that re-description may reach canonical accounting structure.
 *
 * All companies, customers and amounts are fictional.
 */
import { describe, expect, it } from "vitest";

import { createEmptyDraft } from "@/lib/asc606-workflow";

import { createEmptyAiAnalysisState, mergeAiAnalysis, type AiAnalysisState } from "../merge";
import { assessSafeReanalysis } from "../safe-reanalysis";
import type { AiContractAnalysis } from "../schema";
import { fixtureAAnalysis, guidancePackFixture, RUN_ID } from "./merge-fixtures";

const FINGERPRINT = "sha256:genomix-source-set";
const DOC = "doc-fixture-1";

function quote(page: number, excerpt: string) {
  return [{ documentId: DOC, pageStart: page, pageEnd: page, evidenceMode: "text" as const, excerpt }];
}

const HOSTED = quote(
  2,
  "Provider shall host the sequencing platform for an annual platform fee of $480,000.",
);
const THROUGHPUT = quote(
  2,
  "The platform fee includes an allowance of 12,000 samples per contract year.",
);
const VALIDATION = quote(
  3,
  "Provider shall deliver the validation artifact package for a fixed fee of $95,000.",
);
const SUPPORT = quote(
  5,
  "Bioinformatics engineering support is provided for an annual fee of $210,000.",
);

/**
 * The accountant's analysis: four promises grouped into three obligations,
 * one usage component and one service-credit component.
 */
function genomixAnalysis(): AiContractAnalysis {
  const base = fixtureAAnalysis();
  const promise = base.promises[0]!;
  const po = base.performanceObligations[0]!;
  const proposal = base.recognitionProposals[0]!;
  const ssp = base.sspAndAllocation.items[0]!;

  base.promises = [
    { ...promise, semanticKey: "promise:hosted", description: "Hosted sequencing platform", citations: HOSTED },
    {
      ...promise,
      semanticKey: "promise:throughput",
      description: "Included annual throughput allowance",
      citations: THROUGHPUT,
    },
    {
      ...promise,
      semanticKey: "promise:validation",
      description: "Validation artifact package",
      promiseType: "professional_service",
      citations: VALIDATION,
    },
    {
      ...promise,
      semanticKey: "promise:support",
      description: "Bioinformatics engineering support",
      promiseType: "professional_service",
      citations: SUPPORT,
    },
  ];
  base.performanceObligations = [
    {
      ...po,
      semanticKey: "po:hosted",
      promiseKeys: ["promise:hosted", "promise:throughput"],
      description: "Hosted sequencing platform",
      citations: HOSTED,
    },
    {
      ...po,
      semanticKey: "po:validation",
      promiseKeys: ["promise:validation"],
      description: "Validation artifact package",
      satisfactionPattern: "point_in_time",
      citations: VALIDATION,
    },
    {
      ...po,
      semanticKey: "po:support",
      promiseKeys: ["promise:support"],
      description: "Bioinformatics engineering support",
      citations: SUPPORT,
    },
  ];
  base.recognitionProposals = [
    { ...proposal, performanceObligationKey: "po:hosted" },
    {
      ...proposal,
      performanceObligationKey: "po:validation",
      satisfactionPattern: "point_in_time",
      recognitionMethod: "point_in_time",
      serviceStartDate: null,
      serviceEndDate: null,
    },
    { ...proposal, performanceObligationKey: "po:support" },
  ];
  base.sspAndAllocation.items = [
    { ...ssp, semanticKey: "ssp:hosted", appliesToKey: "po:hosted", observedAmountInput: "480000" },
    {
      ...ssp,
      semanticKey: "ssp:validation",
      appliesToKey: "po:validation",
      observedAmountInput: "95000",
    },
    { ...ssp, semanticKey: "ssp:support", appliesToKey: "po:support", observedAmountInput: "210000" },
  ];
  base.transactionPrice.fixedConsiderationInput = "785000";
  base.transactionPrice.variableConsiderationComponents = [
    {
      semanticKey: "vc:overage",
      description: "Overage fee for samples above the included allowance",
      type: "usage",
      contractualRateOrAmountInput: "1.35",
      unitDescription: "sample",
      billingFrequency: "monthly",
      trigger: "Samples processed above the annual included allowance.",
      estimationMethodProposal: "not_estimable",
      constraintAssessment: "Usage is recognised as incurred.",
      initialEstimateBasis: "not_applicable_usage_as_incurred",
      initialEstimatedAmountInput: null,
      initialIncludedAmountInput: null,
      initialEstimateRationale: "Usage-based fees are allocated to the period of use.",
      allocationTreatmentProposal: "specific_po",
      targetPerformanceObligationKey: "po:hosted",
      relatesSpecifically: "yes",
      consistentWithAllocationObjective: "yes",
      allocationRationale: "The overage relates specifically to hosted platform usage.",
      citations: quote(6, "Samples above the allowance are billed at $1.35 per sample."),
      guidanceIds: [],
      reviewState: "supported",
    },
    {
      semanticKey: "vc:sla-credit",
      description: "Service level credit for availability shortfalls",
      type: "service_credit",
      contractualRateOrAmountInput: "1500",
      unitDescription: "credit",
      billingFrequency: "on_event",
      trigger: "Monthly availability below the committed service level.",
      estimationMethodProposal: "most_likely_amount",
      constraintAssessment: "No credit is currently expected.",
      initialEstimateBasis: "zero_no_expected_trigger",
      initialEstimatedAmountInput: "0",
      initialIncludedAmountInput: "0",
      initialEstimateRationale: "No availability shortfall is expected.",
      allocationTreatmentProposal: "specific_po",
      targetPerformanceObligationKey: "po:hosted",
      relatesSpecifically: "yes",
      consistentWithAllocationObjective: "yes",
      allocationRationale: "The credit relates specifically to the hosted platform.",
      citations: quote(7, "A credit of $1,500 applies to each month below the service level."),
      guidanceIds: [],
      reviewState: "supported",
    },
  ];
  return base;
}

/** The later run that describes hosted platform and throughput as one promise. */
function driftedAnalysis(): AiContractAnalysis {
  const analysis = genomixAnalysis();
  analysis.promises = [
    {
      ...analysis.promises[0]!,
      semanticKey: "promise:hosted-with-throughput",
      description: "Hosted sequencing platform including annual throughput allowance",
      citations: [...HOSTED, ...THROUGHPUT],
    },
    analysis.promises[2]!,
    analysis.promises[3]!,
  ];
  analysis.performanceObligations[0] = {
    ...analysis.performanceObligations[0]!,
    promiseKeys: ["promise:hosted-with-throughput"],
  };
  return analysis;
}

/** Canonical state after the accountant's analysis was safely applied, then edited. */
function accountantState() {
  const merged = mergeAiAnalysis({
    currentDraft: createEmptyDraft(),
    currentAiState: createEmptyAiAnalysisState(),
    analysis: genomixAnalysis(),
    runId: RUN_ID,
    guidancePack: guidancePackFixture(),
    priorContext: null,
  });
  const aiState: AiAnalysisState = {
    ...merged.aiState,
    lastSuccessfulRunId: RUN_ID,
    sourceSetFingerprint: FINGERPRINT,
  };
  // An accountant-owned fact the model must never be allowed to overwrite.
  const draft = {
    ...merged.draft,
    transactionPriceNotes: "Expected hours agreed with the delivery lead: 300.",
  };
  return { draft, aiState };
}

describe("Genomix — a later run that recombines hosted platform and throughput", () => {
  it("is safely declined instead of restructuring the accountant's analysis", () => {
    const { draft, aiState } = accountantState();
    const before = JSON.stringify({ draft, aiState });

    const decision = assessSafeReanalysis({
      analysis: driftedAnalysis(),
      priorAnalysis: genomixAnalysis(),
      priorAnalysisLoad: "loaded",
      currentDraft: draft,
      currentAiState: aiState,
      currentSourceSetFingerprint: FINGERPRINT,
    });

    expect(decision.outcome).toBe("decline");
    // Nothing is created, merged, split, re-parented or removed.
    expect(JSON.stringify({ draft, aiState })).toBe(before);
    expect(draft.promises).toHaveLength(4);
    expect(draft.performanceObligations).toHaveLength(3);
    expect(draft.variableConsiderationComponents).toHaveLength(2);
    expect(draft.transactionPriceNotes).toBe(
      "Expected hours agreed with the delivery lead: 300.",
    );
  });

  it("keeps the canonical obligation membership the accountant relies on", () => {
    const { draft } = accountantState();
    const hosted = draft.performanceObligations[0]!;
    const members = draft.promises.filter(
      (promise) => promise.performanceObligationId === hosted.id,
    );
    expect(members).toHaveLength(2);
  });

  it("still applies when the same run is repeated unchanged", () => {
    const { draft, aiState } = accountantState();
    const decision = assessSafeReanalysis({
      analysis: genomixAnalysis(),
      priorAnalysis: genomixAnalysis(),
      priorAnalysisLoad: "loaded",
      currentDraft: draft,
      currentAiState: aiState,
      currentSourceSetFingerprint: FINGERPRINT,
    });
    expect(decision.outcome).toBe("apply");
  });
});
