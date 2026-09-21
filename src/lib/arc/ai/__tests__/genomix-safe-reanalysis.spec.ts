/**
 * ARC v1 — the Genomix re-analysis condition, end to end through the firewall.
 *
 * A later model run describes the hosted platform and its included throughput
 * allowance as a SINGLE promise, where the accountant's analysis carries two.
 * Nothing about that re-description may reach canonical accounting structure.
 *
 * All companies, customers and amounts are fictional.
 */
import { describe, expect, it } from "vitest";

import { assessSafeReanalysis } from "../safe-reanalysis";
import { accountantState, driftedAnalysis, FINGERPRINT, genomixAnalysis } from "./genomix-fixtures";

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
    expect(draft.transactionPriceNotes).toBe("Expected hours agreed with the delivery lead: 300.");
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
