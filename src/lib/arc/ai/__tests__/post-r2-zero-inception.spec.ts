/**
 * Post-R2 live regression patch — defect 2.
 *
 * A zero-at-inception routine assumption must be COMPLETE: ARC's own draft has
 * to pass the deterministic variable-consideration validation with no manual
 * probability or date repair. When no defensible canonical date exists, the
 * assumption fails closed on the missing date instead of inventing one.
 */
import { describe, expect, it } from "vitest";

import { createEmptyAiAnalysisState, mergeAiAnalysis } from "../merge";
import type { AiContractAnalysis } from "@/lib/arc/ai/schema";
import { createEmptyDraft } from "@/lib/asc606-workflow";
import { buildVariableConsiderationInput } from "@/lib/asc606-workflow/vc-adapter";

import { fixtureAAnalysis, guidancePackFixture, RUN_ID } from "./merge-fixtures";

function vcComponent(overrides: Record<string, unknown> = {}) {
  return {
    semanticKey: "vc:service-credit",
    description: "Service level credit against future fees.",
    type: "service_credit",
    contractualRateOrAmountInput: "5000",
    unitDescription: null,
    billingFrequency: null,
    trigger: "Monthly uptime below the committed service level.",
    estimationMethodProposal: "expected_value",
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

function analysisWithZeroComponent(): AiContractAnalysis {
  const analysis = fixtureAAnalysis() as unknown as {
    transactionPrice: { variableConsiderationComponents: unknown[] };
  };
  analysis.transactionPrice.variableConsiderationComponents = [vcComponent()];
  return analysis as unknown as AiContractAnalysis;
}

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

describe("post-R2 — zero-at-inception assumptions are deterministically complete", () => {
  it("produces an inception assessment the deterministic VC engine accepts", () => {
    const { draft } = merge(analysisWithZeroComponent());
    const component = draft.variableConsiderationComponents[0]!;

    expect(component.estimationMethod).toBe("most_likely_amount");
    expect(component.inception.effectiveDate).not.toBe("");
    expect(component.inception.includedInput).toBe("0");
    const mostLikely = component.inception.outcomes.filter((outcome) => outcome.isMostLikely);
    expect(mostLikely).toHaveLength(1);
    expect(mostLikely[0]!.amountInput).toBe("0");
    // A most-likely-amount zero needs no probabilities at all.
    expect(mostLikely[0]!.probabilityInput).toBe("");
    expect(component.inception.constraintRationale).not.toBe("");

    const built = buildVariableConsiderationInput(draft);
    const vcErrors = built.ok
      ? []
      : built.errors.filter((message) => message.includes("Service level credit"));
    expect(vcErrors).toEqual([]);
  });

  it("stays a routine assumption rather than a yellow or red item", () => {
    const { issues } = merge(analysisWithZeroComponent());
    const vcItems = issues.filter((item) => item.targetKey.startsWith("vc:"));
    expect(vcItems.some((item) => item.state === "assumed")).toBe(true);
    expect(vcItems.some((item) => item.state === "red")).toBe(false);
  });

  it("fails closed on the missing date when no canonical date exists", () => {
    const analysis = analysisWithZeroComponent() as unknown as {
      contractAssessment: { contractEffectiveDate: { value: string | null } };
      logicalDocuments: { effectiveDate: string | null }[];
      recognitionProposals: { serviceStartDate: string | null; serviceEndDate: string | null }[];
    };
    analysis.contractAssessment.contractEffectiveDate.value = null;
    for (const document of analysis.logicalDocuments) document.effectiveDate = null;
    for (const proposal of analysis.recognitionProposals) {
      proposal.serviceStartDate = null;
      proposal.serviceEndDate = null;
    }

    const { draft, issues } = merge(analysis as unknown as AiContractAnalysis);
    const vcItems = issues.filter((item) => item.targetKey.startsWith("vc:"));
    expect(vcItems.some((item) => item.state === "assumed")).toBe(false);
    expect(vcItems.some((item) => item.blocking)).toBe(true);
    expect(draft.variableConsiderationComponents[0]!.inception.effectiveDate).toBe("");
  });

  it("never overwrites an accountant-owned inception assessment", () => {
    const current = createEmptyDraft();
    const first = merge(analysisWithZeroComponent(), current);
    const owned = structuredClone(first.draft);
    const component = owned.variableConsiderationComponents[0]!;
    component.inception.includedInput = "2500";
    component.inception.outcomes = component.inception.outcomes.map((outcome) => ({
      ...outcome,
      amountInput: "2500",
    }));

    const second = mergeAiAnalysis({
      currentDraft: owned,
      currentAiState: first.aiState,
      analysis: analysisWithZeroComponent(),
      runId: RUN_ID,
      guidancePack: guidancePackFixture(),
      priorContext: null,
    });
    expect(second.draft.variableConsiderationComponents[0]!.inception.includedInput).toBe("2500");
  });
});
