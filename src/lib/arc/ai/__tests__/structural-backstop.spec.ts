/**
 * ARC v1 — post-merge structural backstop.
 *
 * The pre-merge firewall governs IDENTITY. This governs the OUTCOME: once the
 * real merge has run, a re-analysis with an established AI baseline must leave
 * canonical structural topology untouched — no object appears, disappears or
 * changes parent — or the run is declined and never applied.
 *
 * All companies, customers and amounts are fictional.
 */
import { describe, expect, it } from "vitest";

import { createEmptyDraft } from "@/lib/asc606-workflow";
import type { WorkflowDraft } from "@/lib/asc606-workflow/types";

import { createEmptyAiAnalysisState, mergeAiAnalysis, type AiAnalysisState } from "../merge";
import { assessSafeReanalysis, detectsStructuralMutation } from "../safe-reanalysis";
import type { AiContractAnalysis } from "../schema";
import { accountantState, FINGERPRINT, genomixAnalysis } from "./genomix-fixtures";
import { guidancePackFixture, RUN_ID } from "./merge-fixtures";

const NEXT_RUN = "run-00000000-0000-4000-8000-000000000002";

/** Re-runs the REAL merge against the accountant's canonical state. */
function reMerge(analysis: AiContractAnalysis): {
  before: WorkflowDraft;
  after: WorkflowDraft;
  aiState: AiAnalysisState;
} {
  const { draft, aiState } = accountantState();
  const merged = mergeAiAnalysis({
    currentDraft: draft,
    currentAiState: aiState,
    analysis,
    runId: NEXT_RUN,
    guidancePack: guidancePackFixture(),
    priorContext: null,
  });
  return { before: draft, after: merged.draft, aiState };
}

describe("post-merge structural backstop", () => {
  it("detects a contract modification the previous analysis did not carry", () => {
    const analysis = genomixAnalysis();
    analysis.contractModifications = {
      ...analysis.contractModifications,
      hasModification: "yes",
      effectiveDate: "2027-07-01",
      addedGoodsOrServices: "An additional validation package.",
      treatmentCandidate: "prospective",
      rationale: "The parties added a distinct service at its standalone selling price.",
    };

    const { before, after } = reMerge(analysis);
    expect(detectsStructuralMutation(before, after)).toBe(true);
    // The accountant's canonical state is what the orchestrator keeps.
    expect(before.contractModifications).toHaveLength(0);
  });

  it("detects a projected collection that only the new run makes derivable", () => {
    const withoutBilling = (): AiContractAnalysis => {
      const analysis = genomixAnalysis();
      analysis.billingTerms = [];
      return analysis;
    };

    const merged = mergeAiAnalysis({
      currentDraft: createEmptyDraft(),
      currentAiState: createEmptyAiAnalysisState(),
      analysis: withoutBilling(),
      runId: RUN_ID,
      guidancePack: guidancePackFixture(),
      priorContext: null,
    });
    expect(merged.draft.contractBalances.cashCollections).toHaveLength(0);

    const next = mergeAiAnalysis({
      currentDraft: merged.draft,
      currentAiState: {
        ...merged.aiState,
        lastSuccessfulRunId: RUN_ID,
        sourceSetFingerprint: FINGERPRINT,
      },
      analysis: genomixAnalysis(),
      runId: NEXT_RUN,
      guidancePack: guidancePackFixture(),
      priorContext: null,
    });

    expect(detectsStructuralMutation(merged.draft, next.draft)).toBe(true);
  });

  it("detects a billing change that adds derived invoice periods", () => {
    const analysis = genomixAnalysis();
    analysis.billingTerms = analysis.billingTerms.map((term) => ({
      ...term,
      frequency: "monthly" as const,
      citations: [
        {
          ...term.citations[0]!,
          excerpt: `The $${term.amountOrRateInput} fee is invoiced monthly in advance.`,
        },
      ],
    }));

    const { before, after } = reMerge(analysis);
    expect(detectsStructuralMutation(before, after)).toBe(true);
  });

  it("detects promise re-parenting even though every ID is unchanged", () => {
    const { draft } = accountantState();
    const hosted = draft.performanceObligations[0]!;
    const reparented: WorkflowDraft = {
      ...draft,
      promises: draft.promises.map((promise, index) =>
        index === draft.promises.length - 1
          ? { ...promise, performanceObligationId: hosted.id }
          : promise,
      ),
    };

    expect(reparented.promises.map((promise) => promise.id)).toEqual(
      draft.promises.map((promise) => promise.id),
    );
    expect(detectsStructuralMutation(draft, reparented)).toBe(true);
  });

  it("detects variable consideration re-parenting even though every ID is unchanged", () => {
    const { draft } = accountantState();
    const other = draft.performanceObligations[1]!;
    const retargeted: WorkflowDraft = {
      ...draft,
      variableConsiderationComponents: draft.variableConsiderationComponents.map(
        (component, index) => (index === 0 ? { ...component, targetPoId: other.id } : component),
      ),
    };

    expect(retargeted.variableConsiderationComponents.map((vc) => vc.id)).toEqual(
      draft.variableConsiderationComponents.map((vc) => vc.id),
    );
    expect(detectsStructuralMutation(draft, retargeted)).toBe(true);
  });

  it("passes a stable-route rate refresh, because topology is identical", () => {
    const analysis = genomixAnalysis();
    analysis.transactionPrice.variableConsiderationComponents[0] = {
      ...analysis.transactionPrice.variableConsiderationComponents[0]!,
      contractualRateOrAmountInput: "1.50",
    };

    const { before, after, aiState } = reMerge(analysis);
    const decision = assessSafeReanalysis({
      analysis,
      priorAnalysis: genomixAnalysis(),
      priorAnalysisLoad: "loaded",
      currentDraft: before,
      currentAiState: aiState,
      currentSourceSetFingerprint: FINGERPRINT,
    });

    expect(decision.outcome).toBe("apply");
    expect(detectsStructuralMutation(before, after)).toBe(false);
  });

  it("leaves a first analysis free to create the initial structure", () => {
    const empty = createEmptyDraft();
    const merged = mergeAiAnalysis({
      currentDraft: empty,
      currentAiState: createEmptyAiAnalysisState(),
      analysis: genomixAnalysis(),
      runId: RUN_ID,
      guidancePack: guidancePackFixture(),
      priorContext: null,
    });

    // Structure is created — and the backstop is not consulted at all, because
    // the orchestrator only applies it once an AI baseline exists.
    expect(merged.draft.promises).toHaveLength(4);
    expect(merged.draft.performanceObligations).toHaveLength(3);
    expect(detectsStructuralMutation(empty, merged.draft)).toBe(true);
    expect(createEmptyAiAnalysisState().lastSuccessfulRunId).toBeNull();
  });
});
