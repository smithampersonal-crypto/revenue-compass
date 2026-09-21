/**
 * ARC v1 — Safe Re-analysis routing safety.
 *
 * The firewall decides economic continuity with the accepted Tranche-2 rules,
 * but the run it approves is applied by the UNCHANGED production merge, which
 * re-identifies objects with the legacy reconciler. An object can therefore be
 * `exact` for the firewall and `none` for production merge — and `none` is
 * permission to mint. These regressions pin the rule that closes that gap:
 * apply requires BOTH economic continuity AND proof that production merge will
 * route every governed object to the same canonical identity. Anything else
 * safe-declines, and the accountant's analysis is preserved byte-for-byte.
 *
 * All companies, customers and amounts are fictional.
 */
import { describe, expect, it } from "vitest";

import { createEmptyDraft } from "@/lib/asc606-workflow";
import type { WorkflowDraft } from "@/lib/asc606-workflow/types";

import { createEmptyAiAnalysisState, mergeAiAnalysis } from "../merge";
import { assessSafeReanalysis } from "../safe-reanalysis";
import type { AiContractAnalysis } from "../schema";
import { accountantState, FINGERPRINT, genomixAnalysis, HOSTED } from "./genomix-fixtures";
import { guidancePackFixture, RUN_ID } from "./merge-fixtures";

/* ------------------------------------------------------------------ utils */

const structuralIds = (draft: WorkflowDraft) => ({
  promises: draft.promises.map((promise) => promise.id).sort(),
  obligations: draft.performanceObligations.map((po) => po.id).sort(),
  variableConsideration: draft.variableConsiderationComponents.map((vc) => vc.id).sort(),
  billingEvents: draft.contractBalances.considerationEvents.map((event) => event.id).sort(),
  projectedCollections: draft.contractBalances.cashCollections.map((cc) => cc.id).sort(),
});

function assess(analysis: AiContractAnalysis) {
  const { draft, aiState } = accountantState();
  const before = JSON.stringify({ draft, aiState });
  const decision = assessSafeReanalysis({
    analysis,
    priorAnalysis: genomixAnalysis(),
    priorAnalysisLoad: "loaded",
    currentDraft: draft,
    currentAiState: aiState,
    currentSourceSetFingerprint: FINGERPRINT,
  });
  return { decision, draft, aiState, before, after: JSON.stringify({ draft, aiState }) };
}

/** A decline that changed nothing at all. */
function expectSafeDecline(result: ReturnType<typeof assess>) {
  expect(result.decision.outcome).toBe("decline");
  // Routing safety, not economic doubt, is what stops these runs.
  expect(result.decision.reason).toBe("routing_unverified");
  expect(result.after).toBe(result.before);
  expect(result.draft.promises).toHaveLength(4);
  expect(result.draft.performanceObligations).toHaveLength(3);
  expect(result.draft.variableConsiderationComponents).toHaveLength(2);
  expect(result.draft.transactionPriceNotes).toBe(
    "Expected hours agreed with the delivery lead: 300.",
  );
}

/** Renames one promise's semantic key, keeping its obligation membership. */
function renamePromise(analysis: AiContractAnalysis, from: string, to: string): AiContractAnalysis {
  analysis.promises = analysis.promises.map((promise) =>
    promise.semanticKey === from ? { ...promise, semanticKey: to } : promise,
  );
  analysis.performanceObligations = analysis.performanceObligations.map((po) => ({
    ...po,
    promiseKeys: po.promiseKeys.map((key) => (key === from ? to : key)),
  }));
  return analysis;
}

/* ------------------------------------------------------------------ tests */

describe("Safe Re-analysis — firewall identity must agree with production merge routing", () => {
  it("declines a renamed promise whose promise type also drifted", () => {
    // Same economic promise, new semantic key, taxonomy professional_service →
    // support. Tranche 2 treats the taxonomy change as judgment drift; the
    // legacy reconciler gates on promise type and would mint a new promise.
    const analysis = renamePromise(genomixAnalysis(), "promise:support", "promise:eng-support");
    analysis.promises = analysis.promises.map((promise) =>
      promise.semanticKey === "promise:eng-support"
        ? { ...promise, promiseType: "support" }
        : promise,
    );

    const result = assess(analysis);
    expectSafeDecline(result);
    // The canonical promise the run would have replaced is still the only one.
    expect(
      result.draft.promises.filter((promise) =>
        promise.description.includes("Bioinformatics engineering support"),
      ),
    ).toHaveLength(1);
  });

  it("declines a renamed promise whose citation pages drifted", () => {
    const analysis = renamePromise(genomixAnalysis(), "promise:support", "promise:support-v2");
    analysis.promises = analysis.promises.map((promise) =>
      promise.semanticKey === "promise:support-v2"
        ? {
            ...promise,
            citations: (promise.citations ?? []).map((citation) => ({
              ...citation,
              pageStart: citation.pageStart + 1,
              pageEnd: citation.pageEnd + 1,
            })),
          }
        : promise,
    );

    expectSafeDecline(assess(analysis));
  });

  it("declines when a proposal's existing key routes to a different canonical obligation", () => {
    // The keys po:validation and po:support keep their provenance, but now carry
    // each other's contractual evidence: economic identity and merge routing
    // disagree, so nothing may be re-parented.
    const analysis = genomixAnalysis();
    const validation = analysis.performanceObligations[1]!;
    const support = analysis.performanceObligations[2]!;
    analysis.performanceObligations[1] = {
      ...support,
      semanticKey: "po:validation",
      promiseKeys: validation.promiseKeys,
    };
    analysis.performanceObligations[2] = {
      ...validation,
      semanticKey: "po:support",
      promiseKeys: support.promiseKeys,
    };

    expectSafeDecline(assess(analysis));
  });

  it("declines a renamed variable consideration component", () => {
    const analysis = genomixAnalysis();
    analysis.transactionPrice.variableConsiderationComponents[0] = {
      ...analysis.transactionPrice.variableConsiderationComponents[0]!,
      semanticKey: "vc:overage-fee",
    };

    const result = assess(analysis);
    expectSafeDecline(result);
    expect(result.draft.variableConsiderationComponents).toHaveLength(2);
  });

  it("declines a renamed billing term rather than risking a duplicate schedule", () => {
    const { draft } = accountantState();
    const billingBefore = structuralIds(draft);

    const analysis = genomixAnalysis();
    analysis.billingTerms = analysis.billingTerms.map((term) => ({
      ...term,
      semanticKey: `${term.semanticKey}-renamed`,
    }));

    const result = assess(analysis);
    expect(result.decision.outcome).toBe("decline");
    expect(result.decision.reason).toBe("routing_unverified");
    expect(structuralIds(result.draft).billingEvents).toEqual(billingBefore.billingEvents);
    expect(structuralIds(result.draft).projectedCollections).toEqual(
      billingBefore.projectedCollections,
    );
  });

  it("declines sibling promises that admit more than one bijection", () => {
    // Two promises inside the same obligation resting on identical evidence:
    // a perfect matching exists, but it is not unique, so identity is unproven.
    const twins = (): AiContractAnalysis => {
      const analysis = genomixAnalysis();
      analysis.promises = analysis.promises.map((promise) =>
        promise.semanticKey === "promise:throughput"
          ? { ...promise, description: "Hosted sequencing platform", citations: HOSTED }
          : promise,
      );
      return analysis;
    };

    const merged = mergeAiAnalysis({
      currentDraft: createEmptyDraft(),
      currentAiState: createEmptyAiAnalysisState(),
      analysis: twins(),
      runId: RUN_ID,
      guidancePack: guidancePackFixture(),
      priorContext: null,
    });

    const decision = assessSafeReanalysis({
      analysis: twins(),
      priorAnalysis: twins(),
      priorAnalysisLoad: "loaded",
      currentDraft: merged.draft,
      currentAiState: {
        ...merged.aiState,
        lastSuccessfulRunId: RUN_ID,
        sourceSetFingerprint: FINGERPRINT,
      },
      currentSourceSetFingerprint: FINGERPRINT,
    });

    expect(decision.outcome).toBe("decline");
    expect(decision.reason).toBe("ambiguous");
    expect(decision.objectKind).toBe("promise");
  });

  it("every apply decision preserves canonical structural ID sets through the real merge", () => {
    const { draft, aiState } = accountantState();
    const before = structuralIds(draft);

    // A permissible AI-owned refresh: the same usage component at a new rate.
    const refreshed = genomixAnalysis();
    refreshed.transactionPrice.variableConsiderationComponents[0] = {
      ...refreshed.transactionPrice.variableConsiderationComponents[0]!,
      contractualRateOrAmountInput: "1.50",
      description: "Overage fee for samples above the included allowance (updated)",
    };

    const decision = assessSafeReanalysis({
      analysis: refreshed,
      priorAnalysis: genomixAnalysis(),
      priorAnalysisLoad: "loaded",
      currentDraft: draft,
      currentAiState: aiState,
      currentSourceSetFingerprint: FINGERPRINT,
    });
    expect(decision.outcome).toBe("apply");

    // The REAL production merge, exactly as the orchestrator would run it.
    const merged = mergeAiAnalysis({
      currentDraft: draft,
      currentAiState: aiState,
      analysis: refreshed,
      runId: "run-00000000-0000-4000-8000-000000000002",
      guidancePack: guidancePackFixture(),
      priorContext: null,
    });

    expect(structuralIds(merged.draft)).toEqual(before);
    expect(merged.draft.transactionPriceNotes).toBe(
      "Expected hours agreed with the delivery lead: 300.",
    );
  });
});
