/**
 * Package 3D-Q.2 — Safe Re-analysis protects the linked-obligation dates that
 * drive a v9 billing schedule. Fictional companies and amounts.
 */
import { describe, expect, it } from "vitest";

import { createEmptyDraft } from "@/lib/asc606-workflow";

import { createEmptyAiAnalysisState, mergeAiAnalysis, type AiAnalysisState } from "../merge";
import { assessSafeReanalysis, resolvedLinkedDateSignature } from "../safe-reanalysis";
import type { AiContractAnalysis } from "../schema";
import { cedarTest03Analysis } from "./cedar-test03-fixture";
import { guidancePackFixture, RUN_ID } from "./merge-fixtures";

const FINGERPRINT = "sha256:cedar-test03";

function applied(analysis: AiContractAnalysis) {
  const merged = mergeAiAnalysis({
    currentDraft: createEmptyDraft(),
    currentAiState: createEmptyAiAnalysisState(),
    analysis,
    runId: RUN_ID,
    guidancePack: guidancePackFixture(),
    priorContext: null,
  });
  const aiState: AiAnalysisState = {
    ...merged.aiState,
    lastSuccessfulRunId: RUN_ID,
    sourceSetFingerprint: FINGERPRINT,
  };
  return { draft: merged.draft, aiState };
}

function assess(next: AiContractAnalysis) {
  const prior = cedarTest03Analysis();
  const { draft, aiState } = applied(prior);
  const before = JSON.stringify({ draft, aiState });
  const decision = assessSafeReanalysis({
    analysis: next,
    priorAnalysis: prior,
    priorAnalysisLoad: "loaded",
    currentDraft: draft,
    currentAiState: aiState,
    currentSourceSetFingerprint: FINGERPRINT,
  });
  expect(JSON.stringify({ draft, aiState })).toBe(before);
  return { decision, draft };
}

const eventDates = (draft: ReturnType<typeof createEmptyDraft>) =>
  draft.contractBalances.considerationEvents.map((row) => row.invoiceDate).sort();

function proposal(analysis: AiContractAnalysis, key: string) {
  return analysis.recognitionProposals.find((row) => row.performanceObligationKey === key)!;
}

describe("3D-Q.2 — linked-obligation dates are structural for v9 billing", () => {
  it("A. declines a changed completion date; April 15 stays, April 20 never created", () => {
    const next = cedarTest03Analysis();
    proposal(next, "po:training").recognitionDateIfContractuallyDeterminable = "2027-04-20";
    const { decision, draft } = assess(next);
    expect(decision).toEqual({ outcome: "decline", reason: "unmatched", objectKind: "billing_term" });
    expect(eventDates(draft)).toContain("2027-04-15");
    expect(eventDates(draft)).not.toContain("2027-04-20");
  });

  it("B. declines a shifted installment service period; quarterly invoices unchanged", () => {
    const next = cedarTest03Analysis();
    const sub = proposal(next, "po:subscription");
    sub.serviceStartDate = "2027-02-01";
    sub.serviceEndDate = "2028-01-31";
    const { decision, draft } = assess(next);
    expect(decision.outcome).toBe("decline");
    expect(decision.reason).toBe("unmatched");
    expect(eventDates(draft)).toEqual([
      "2027-01-01",
      "2027-01-01",
      "2027-04-01",
      "2027-04-15",
      "2027-07-01",
      "2027-10-01",
    ]);
  });

  it("C. unchanged dates with changed citation wording and prose still apply", () => {
    const next = cedarTest03Analysis();
    for (const term of next.billingTerms) {
      term.description = `${term.description} (restated)`;
      term.citations = term.citations.map((c) => ({ ...c, excerpt: `${c.excerpt ?? ""} ` }));
    }
    expect(assess(next).decision.outcome).toBe("apply");
    expect(assess(cedarTest03Analysis()).decision.outcome).toBe("apply");
  });

  it("D. identical billing-term fields but a changed linked date declines via the date signature", () => {
    const prior = cedarTest03Analysis();
    const next = cedarTest03Analysis();
    proposal(next, "po:training").recognitionDateIfContractuallyDeterminable = "2027-04-20";
    const pairs = prior.billingTerms.map((t, i) => [t, next.billingTerms[i]!] as const);
    for (const [before, after] of pairs) expect(after).toEqual(before);
    const training = (a: AiContractAnalysis) =>
      a.billingTerms.find((t) => t.semanticKey === "billing:training")!;
    expect(resolvedLinkedDateSignature(training(prior), prior)).not.toBe(
      resolvedLinkedDateSignature(training(next), next),
    );
    expect(assess(next).decision.outcome).toBe("decline");
  });
});
