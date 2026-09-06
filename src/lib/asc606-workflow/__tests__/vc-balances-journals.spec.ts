/**
 * Phase 5B downstream acceptance: source-linked billing, signed revenue in the
 * contract-balance rollforward, and signed journal entries.
 */

import { describe, expect, it } from "vitest";

import { analyzeJournalEntries } from "@/lib/asc606-journals";
import { analyzeContractBalanceWorkflow } from "../contract-balances";
import { analyzeWorkflow } from "../analysis";
import { createConsiderationEventDraft } from "../types";
import { case7Draft, cloudAiDraft } from "./vc-fixtures";
import type { WorkflowDraft } from "../types";

function withEvents(
  draft: WorkflowDraft,
  events: WorkflowDraft["contractBalances"]["considerationEvents"],
): WorkflowDraft {
  return {
    ...draft,
    contractBalances: {
      ...draft.contractBalances,
      considerationEvents: events,
      cashCollections: [],
    },
  };
}

describe("source-linked billing", () => {
  it("bills the engine's constrained bonus amount without re-entry", () => {
    const draft = withEvents(case7Draft(), [
      {
        ...createConsiderationEventDraft(1, "ce-fixed"),
        amountInput: "460,000.00",
        unconditionalRightDate: "2027-03-20",
        invoiceDate: "2027-03-21",
      },
      {
        ...createConsiderationEventDraft(2, "ce-bonus"),
        amountSource: "estimated_component",
        sourceComponentId: "vc-bonus",
        unconditionalRightDate: "2027-03-20",
        invoiceDate: "2027-03-21",
      },
    ]);
    const result = analyzeContractBalanceWorkflow(draft);
    expect(result.blockedReason).toBeNull();
    expect(result.finalized).toBe(true);
    const bonus = result.engineInput!.considerationEvents.find((e) => e.id === "ce-bonus")!;
    expect(bonus.amountCents).toBe(3_000_000); // $30,000.00
    expect(result.engineInput!.transactionPriceCents).toBe(49_000_000);
    expect(result.analysis!.reconciliation.reconciled).toBe(true);
  });

  it("bills the engine's usage amount for the linked month", () => {
    const draft = withEvents(cloudAiDraft(), [
      {
        ...createConsiderationEventDraft(1, "ce-fixed"),
        amountInput: "120,000.00",
        unconditionalRightDate: "2027-01-01",
        invoiceDate: "2027-01-01",
      },
      {
        ...createConsiderationEventDraft(2, "ce-usage"),
        amountSource: "usage_period",
        sourceComponentId: "vc-usage",
        sourceMonth: "2027-01",
        unconditionalRightDate: "2027-01-31",
        invoiceDate: "2027-02-01",
      },
    ]);
    const result = analyzeContractBalanceWorkflow(draft);
    expect(result.finalized).toBe(true);
    const usage = result.engineInput!.considerationEvents.find((e) => e.id === "ce-usage")!;
    expect(usage.amountCents).toBe(7_200); // $72.00
    expect(result.engineInput!.transactionPriceCents).toBe(12_007_200);
  });

  it("blocks when the linked usage month has no recorded usage", () => {
    const draft = withEvents(cloudAiDraft(), [
      {
        ...createConsiderationEventDraft(1, "ce-usage"),
        amountSource: "usage_period",
        sourceComponentId: "vc-usage",
        sourceMonth: "2027-02",
        unconditionalRightDate: "2027-02-28",
        invoiceDate: "2027-03-01",
      },
    ]);
    const result = analyzeContractBalanceWorkflow(draft);
    expect(result.finalized).toBe(false);
    expect(result.analysis).toBeNull();
  });
});

describe("signed revenue flows through balances and journals", () => {
  /** The bonus estimate is reduced after the implementation obligation is satisfied. */
  function reducedBonusDraft(): WorkflowDraft {
    const draft = case7Draft();
    const component = draft.variableConsiderationComponents[0]!;
    return withEvents(
      {
        ...draft,
        variableConsiderationComponents: [
          {
            ...component,
            remeasurements: [
              {
                id: "vc-bonus-a2",
                seq: 2,
                effectiveDate: "2027-06-30",
                includedInput: "10,000.00",
                constraintRationale:
                  "New evidence indicates only part of the bonus is probable of being retained.",
                evidence: "Customer acceptance dispute opened in June 2027.",
                outcomes: [
                  {
                    id: "vc-bonus-a2-o1",
                    seq: 1,
                    description: "Reduced bonus",
                    amountInput: "10,000.00",
                    probabilityInput: "",
                    isMostLikely: true,
                  },
                ],
              },
            ],
          },
        ],
      },
      [
        {
          ...createConsiderationEventDraft(1, "ce-fixed"),
          amountInput: "470,000.00",
          unconditionalRightDate: "2027-03-20",
          invoiceDate: "2027-03-21",
        },
      ],
    );
  }

  it("recognizes a negative catch-up in the remeasurement month", () => {
    const result = analyzeWorkflow(reducedBonusDraft());
    expect(result.finalized).toBe(true);
    const june = result.revenueSchedule!.byMonth.find((r) => r.month === "2027-06")!;
    expect(june.perPo["po-implementation"]).toBe(-2_000_000); // -$20,000.00
    expect(result.variableConsideration!.totals.currentEstimatedConsiderationCents).toBe(
      47_000_000,
    );
    expect(result.variableConsideration!.reconciliation.reconciled).toBe(true);
  });

  it("produces a balanced journal entry with a revenue debit and still replays Phase 3", () => {
    const balances = analyzeContractBalanceWorkflow(reducedBonusDraft());
    expect(balances.finalized).toBe(true);

    const journals = analyzeJournalEntries(balances.engineInput!);
    expect(journals.validation.blockingFailures).toEqual([]);
    const june = journals.entries!.filter((e) => e.date.startsWith("2027-06"));
    const revenueDebit = june
      .flatMap((entry) => entry.lines)
      .find((line) => line.account === "revenue" && line.debitCents > 0);
    expect(revenueDebit?.debitCents).toBe(2_000_000);

    for (const entry of journals.entries!) {
      const debits = entry.lines.reduce((sum, line) => sum + line.debitCents, 0);
      const credits = entry.lines.reduce((sum, line) => sum + line.creditCents, 0);
      expect(debits).toBe(credits);
    }
    expect(journals.reconciliation.reconciled).toBe(true);
  });
});
