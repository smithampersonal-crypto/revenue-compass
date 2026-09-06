/**
 * Phase 5C workflow integration: the accountant's modification draft must reach
 * the pure modification engine unchanged, and a separate-contract modification
 * must produce two independently presented contracts through Phase 3 and 4.
 */

import { describe, expect, it } from "vitest";

import { analyzeGroupedJournalEntries } from "@/lib/asc606-journals";

import { analyzeContractBalanceWorkflow } from "../contract-balances";
import { analyzeWorkflow } from "../analysis";
import { NEW_CONTRACT_GROUP_ID, ORIGINAL_GROUP_ID } from "@/lib/asc606-contract-modifications";

import {
  createCashCollectionDraft,
  createConsiderationEventDraft,
  createModificationDraft,
  createModifiedPoDraft,
  type WorkflowDraft,
} from "../types";
import { scenarioADraft, scenarioBDraft } from "./fixtures";

/** Case 9 — Redwood-style separate contract: 50 added seats priced at SSP. */
function case9Draft(): WorkflowDraft {
  const base = scenarioADraft();
  const po = {
    ...base.performanceObligations[0]!,
    sspInput: "240,000.00",
    serviceStart: "2027-01-01",
    serviceEnd: "2028-12-31",
  };
  return {
    ...base,
    transactionPriceInput: "240,000.00",
    performanceObligations: [po],
    hasContractModification: true,
    modification: {
      ...createModificationDraft(),
      effectiveDate: "2027-07-01",
      description: "50 additional seats",
      considerationChangeInput: "90,000.00",
      considerationChangeDirection: "increase",
      addsDistinctGoodsOrServices: true,
      priceReflectsStandaloneSellingPrices: true,
      separateContractRationale: "Added seats are priced at their standalone selling price.",
      modifiedPerformanceObligations: [
        {
          ...createModifiedPoDraft(1, po.id, "continuing"),
          name: po.name,
          sourcePoId: po.id,
          remainingGoodsDistinct: true,
          remainingSspInput: "120,000.00",
          totalModifiedSspInput: "240,000.00",
          recognitionMethod: "over_time_ratable" as const,
          serviceStart: "2027-07-01",
          serviceEnd: "2028-12-31",
          recognitionRationale: "Simultaneous receipt and consumption.",
        },
        {
          ...createModifiedPoDraft(2, "po-added-seats", "added"),
          name: "SaaS subscription (50 added seats)",
          remainingGoodsDistinct: true,
          remainingSspInput: "90,000.00",
          totalModifiedSspInput: "90,000.00",
          recognitionMethod: "over_time_ratable" as const,
          serviceStart: "2027-07-01",
          serviceEnd: "2028-12-31",
          recognitionRationale: "Simultaneous receipt and consumption.",
        },
      ],
    },
  };
}

describe("Phase 5C workflow integration", () => {
  it("keeps an unmodified contract exactly as before", () => {
    const result = analyzeWorkflow(scenarioBDraft());
    expect(result.finalized).toBe(true);
    expect(result.modification).toBeNull();
    expect(result.contractGroups).toEqual([]);
  });

  it("finalizes Case 9 as a separate contract with two presentation groups", () => {
    const result = analyzeWorkflow(case9Draft());
    expect(result.finalized).toBe(true);
    expect(result.modification?.classification?.treatment).toBe("separate_contract");
    expect(result.contractGroups).toHaveLength(2);
    expect(result.lifecycleConsiderationCents).toBe(33_000_000);
    expect(result.revenueSchedule?.totalCents).toBe(33_000_000);
    expect(result.modification?.reconciliation.reconciled).toBe(true);
  });

  it("blocks the analysis when a modification judgment is missing", () => {
    const draft = case9Draft();
    draft.modification = { ...draft.modification, addsDistinctGoodsOrServices: null };
    const result = analyzeWorkflow(draft);
    expect(result.finalized).toBe(false);
    expect(result.revenueSchedule).toBeNull();
  });

  it("bills and reconciles each presentation group independently", () => {
    const draft = case9Draft();
    const original = {
      ...createConsiderationEventDraft(1, "ce-original"),
      amountInput: "240,000.00",
      unconditionalRightDate: "2027-01-01",
      invoiceDate: "2027-01-01",
      contractGroupId: ORIGINAL_GROUP_ID,
    };
    const added = {
      ...createConsiderationEventDraft(2, "ce-added"),
      amountInput: "90,000.00",
      unconditionalRightDate: "2027-07-01",
      invoiceDate: "2027-07-01",
      contractGroupId: NEW_CONTRACT_GROUP_ID,
    };
    draft.contractBalances = {
      ...draft.contractBalances,
      considerationEvents: [original, added],
      cashCollections: [
        {
          ...createCashCollectionDraft(1, "cash-1"),
          considerationEventId: "ce-original",
          amountInput: "240,000.00",
          collectionDate: "2027-01-31",
        },
        {
          ...createCashCollectionDraft(2, "cash-2"),
          considerationEventId: "ce-added",
          amountInput: "90,000.00",
          collectionDate: "2027-07-31",
        },
      ],
    };

    const balances = analyzeContractBalanceWorkflow(draft);
    expect(balances.groupInputs).toHaveLength(2);
    expect(balances.grouped?.reconciled).toBe(true);
    expect(balances.grouped?.combinedTransactionPriceCents).toBe(33_000_000);
    expect(balances.grouped?.combinedRevenueCents).toBe(33_000_000);

    const journals = analyzeGroupedJournalEntries(balances.groupInputs);
    expect(journals.reconciled).toBe(true);
    expect(journals.groups).toHaveLength(2);
    const debits = (journals.entries ?? [])
      .flatMap((entry) => entry.lines)
      .reduce((sum, line) => sum + line.debitCents, 0);
    const credits = (journals.entries ?? [])
      .flatMap((entry) => entry.lines)
      .reduce((sum, line) => sum + line.creditCents, 0);
    expect(debits).toBe(credits);
  });
});

/**
 * Remediation item 10: the generic Results allocation must stay the ORIGINAL
 * inception allocation. A modification row must never be presented inside it.
 */
describe("Original contract allocation is never contaminated by a modification", () => {
  it("keeps the Meridian-style separate contract out of the original allocation", () => {
    const result = analyzeWorkflow(case9Draft());
    const allocatedTotal = (result.allocation ?? []).reduce(
      (sum, row) => sum + row.allocatedCents,
      0,
    );
    expect(allocatedTotal).toBe(24_000_000);
    expect(result.allocation?.some((row) => row.allocatedCents === 9_000_000)).toBe(false);
    expect(result.modification?.allocationLayers?.[0]?.transactionPriceCents).toBe(9_000_000);
    expect(result.lifecycleConsiderationCents).toBe(33_000_000);
  });
});

/**
 * Remediation item 11: billing events must be explicitly assigned to a
 * contract once a modification produced more than one contract.
 */
describe("billing group assignment control", () => {
  function billedDraft(originalGroup: string | null, addedGroup: string | null): WorkflowDraft {
    const draft = case9Draft();
    draft.contractBalances = {
      ...draft.contractBalances,
      considerationEvents: [
        {
          ...createConsiderationEventDraft(1, "ce-original"),
          amountInput: "240,000.00",
          unconditionalRightDate: "2027-01-01",
          invoiceDate: "2027-01-01",
          ...(originalGroup === null ? {} : { contractGroupId: originalGroup }),
        },
        {
          ...createConsiderationEventDraft(2, "ce-added"),
          amountInput: "90,000.00",
          unconditionalRightDate: "2027-07-01",
          invoiceDate: "2027-07-01",
          ...(addedGroup === null ? {} : { contractGroupId: addedGroup }),
        },
      ],
      cashCollections: [],
    };
    return draft;
  }

  it("blocks an unassigned billing event instead of posting it to the original contract", () => {
    const balances = analyzeContractBalanceWorkflow(billedDraft(null, null));
    expect(balances.finalized).toBe(false);
    expect(balances.analysis).toBeNull();
    expect(balances.grouped).toBeNull();
    expect(
      balances.validation.issues.some((issue) => issue.id.startsWith("billing.group.missing.")),
    ).toBe(true);
  });

  it("blocks a billing event linked to a contract that does not exist", () => {
    const balances = analyzeContractBalanceWorkflow(
      billedDraft(ORIGINAL_GROUP_ID, "contract-that-was-deleted"),
    );
    expect(balances.finalized).toBe(false);
    expect(
      balances.validation.issues.some((issue) => issue.id.startsWith("billing.group.stale.")),
    ).toBe(true);
  });

  it("accepts fully assigned billing events", () => {
    const balances = analyzeContractBalanceWorkflow(
      billedDraft(ORIGINAL_GROUP_ID, NEW_CONTRACT_GROUP_ID),
    );
    expect(balances.groupInputs).toHaveLength(2);
    expect(balances.grouped?.combinedTransactionPriceCents).toBe(33_000_000);
  });
});
