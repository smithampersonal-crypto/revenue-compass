/**
 * Phase 5C: a modification's cumulative catch-up must reach the journals with
 * the correct SIGN, and every presentation group's journals must replay to that
 * group's own Phase 3 rollforward.
 *
 * All companies, customers and amounts are fictional.
 */

import { describe, expect, it } from "vitest";

import { analyzeGroupedJournalEntries, analyzeJournalEntries } from "@/lib/asc606-journals";

import { analyzeWorkflow } from "../analysis";
import { analyzeContractBalanceWorkflow } from "../contract-balances";
import {
  createCashCollectionDraft,
  createConsiderationEventDraft,
  createModificationDraft,
  createModifiedPoDraft,
  type WorkflowDraft,
} from "../types";
import { scenarioADraft } from "./fixtures";

const CATCH_UP_MONTH = "2028-07";

/**
 * A $120,000 contract across calendar 2028 repriced on 2028-07-02, when the
 * single non-distinct obligation is exactly 50% complete.
 */
function repricedDraft(
  totalConsiderationInput: string,
  effect: "increase" | "decrease",
  magnitudeInput: string,
): WorkflowDraft {
  const draft = scenarioADraft();
  const po = {
    ...draft.performanceObligations[0]!,
    sspInput: "120,000.00",
    serviceStart: "2028-01-01",
    serviceEnd: "2028-12-31",
  };
  return {
    ...draft,
    transactionPriceInput: "120,000.00",
    performanceObligations: [po],
    hasContractModifications: true,
    contractModifications: [
      {
        ...createModificationDraft(1),
        modificationDate: "2028-07-02",
        approvedAndEnforceable: true,
        approvalRationale: "Countersigned amendment retained in the contract file.",
        scopeChangeDescription: "Repriced the same integrated service.",
        considerationEffect: effect,
        considerationMagnitudeInput: magnitudeInput,
        modifiedPerformanceObligations: [
          {
            ...createModifiedPoDraft(1, "mod-1-po-1", "continuing"),
            name: po.name,
            sourcePoId: po.id,
            scopeEffect: "reconfigured" as const,
            remainingGoodsDistinctFromTransferred: false,
            remainingDistinctnessRationale: "One integrated service across the whole term.",
            remainingSspInput: totalConsiderationInput,
            remainingSspBasis: "Repriced renewal evidence.",
            totalModifiedSspInput: totalConsiderationInput,
            totalModifiedSspBasis: "Repriced renewal evidence.",
            recognitionMethod: "over_time_ratable" as const,
            serviceStart: "2028-01-01",
            serviceEnd: "2028-12-31",
            recognitionRationale: "Simultaneous receipt and consumption.",
          },
        ],
      },
    ],
    contractBalances: {
      ...draft.contractBalances,
      considerationEvents: [
        {
          ...createConsiderationEventDraft(1, "ce-1"),
          amountInput: totalConsiderationInput,
          unconditionalRightDate: "2028-01-01",
          invoiceDate: "2028-01-01",
        },
      ],
      cashCollections: [
        {
          ...createCashCollectionDraft(1, "cash-1"),
          considerationEventId: "ce-1",
          amountInput: totalConsiderationInput,
          collectionDate: "2028-01-31",
        },
      ],
    },
  };
}

function julyRevenue(draft: WorkflowDraft) {
  const balances = analyzeContractBalanceWorkflow(draft);
  expect(balances.finalized).toBe(true);
  const journals = analyzeJournalEntries(balances.engineInput!);
  expect(journals.reconciliation.reconciled).toBe(true);
  const lines = (journals.entries ?? [])
    .filter((entry) => entry.month === CATCH_UP_MONTH)
    .flatMap((entry) => entry.lines)
    .filter((line) => line.account === "revenue");
  return {
    debits: lines.reduce((sum, line) => sum + line.debitCents, 0),
    credits: lines.reduce((sum, line) => sum + line.creditCents, 0),
  };
}

describe("modification catch-up reaches the journals with the correct sign", () => {
  it("credits revenue for a +$15,000 catch-up", () => {
    const draft = repricedDraft("150,000.00", "increase", "30,000.00");
    const analysis = analyzeWorkflow(draft);
    expect(analysis.modification?.totals.catchUpCents).toBe(1_500_000);

    const control = julyRevenue(
      // Same contract, same month, without any modification.
      { ...draft, hasContractModifications: false },
    );
    const withCatchUp = julyRevenue(draft);
    expect(withCatchUp.debits).toBe(0);
    expect(withCatchUp.credits).toBeGreaterThan(control.credits);
  });

  it("debits revenue for a -$15,000 catch-up", () => {
    const draft = repricedDraft("90,000.00", "decrease", "30,000.00");
    const analysis = analyzeWorkflow(draft);
    expect(analysis.modification?.totals.catchUpCents).toBe(-1_500_000);

    const july = julyRevenue(draft);
    expect(july.credits).toBe(0);
    expect(july.debits).toBeGreaterThan(0);
  });

  it("replays each presentation group's journals to that group's own rollforward", () => {
    const balances = analyzeContractBalanceWorkflow(repricedDraft("150,000.00", "increase", "30,000.00"));
    const journals = analyzeGroupedJournalEntries(balances.groupInputs);
    expect(journals.groups.length).toBeGreaterThan(0);
    for (const group of journals.groups) {
      expect(group.analysis.reconciliation.monthlyBalancesTie).toBe(true);
      expect(group.analysis.reconciliation.reconciled).toBe(true);
    }
    expect(journals.reconciled).toBe(true);
  });
});
