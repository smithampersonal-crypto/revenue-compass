/**
 * Package 3D-Q.2 — full Test 03 synthetic regression through the production
 * schema → merge → analyzeWorkflow path. Deterministic only.
 */
import { describe, expect, it } from "vitest";

import { analyzeWorkflow, createEmptyDraft } from "@/lib/asc606-workflow";

import { createEmptyAiAnalysisState, mergeAiAnalysis } from "../merge";
import { parseAiContractAnalysis } from "../schema";
import { cedarTest03Analysis } from "./cedar-test03-fixture";
import { guidancePackFixture, RUN_ID } from "./merge-fixtures";

describe("Test 03 — Cedar Analytics / Harbor Medical Group pattern", () => {
  it("produces the accepted ASC 606 result, six billing events and unblocked balances", () => {
    const parsed = parseAiContractAnalysis(cedarTest03Analysis());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const { draft, issues } = mergeAiAnalysis({
      currentDraft: createEmptyDraft(),
      currentAiState: createEmptyAiAnalysisState(),
      analysis: parsed.analysis,
      runId: RUN_ID,
      guidancePack: guidancePackFixture(),
      priorContext: null,
    });

    // ASC 606
    expect(draft.performanceObligations).toHaveLength(3);
    expect(Number(draft.transactionPriceInput)).toBe(150000);
    const result = analyzeWorkflow(draft);
    expect(result.blockedReason).toBeNull();
    expect(result.allocation!.map((row) => row.allocatedCents)).toEqual([
      2_812_500, 11_250_000, 937_500,
    ]);
    expect(result.revenueSchedule!.totalCents).toBe(15_000_000);

    // Billing
    const events = draft.contractBalances.considerationEvents
      .map((row) => `${row.invoiceDate}|${Number(row.amountInput)}`)
      .sort();
    expect(events).toEqual([
      "2027-01-01|24000",
      "2027-01-01|30000",
      "2027-04-01|30000",
      "2027-04-15|6000",
      "2027-07-01|30000",
      "2027-10-01|30000",
    ]);
    expect(
      draft.contractBalances.considerationEvents.reduce((s, r) => s + Number(r.amountInput), 0),
    ).toBe(150000);

    // Contract balances: nothing blocked for missing billing; no fabricated cash.
    expect(
      issues.filter((i) => /billing/.test(i.reasonCode) || i.reasonCode === "source_conflict"),
    ).toEqual([]);
    expect(result.workflowValidation.blocking).toEqual([]);
    for (const cash of draft.contractBalances.cashCollections) {
      expect(cash).not.toHaveProperty("status", "actual");
    }
  });
});
