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
    hasContractModifications: true,
    contractModifications: [
      {
        ...createModificationDraft(1),
        modificationDate: "2027-07-01",
        approvedAndEnforceable: true,
        approvalRationale: "Signed amendment.",
        scopeChangeDescription: "50 additional seats",
        considerationMagnitudeInput: "90,000.00",
        considerationEffect: "increase",
        priceReflectsAddedGoodsSsp: true,
        priceReflectsSspRationale: "Added seats are priced at their standalone selling price.",
        modifiedPerformanceObligations: [
          {
            ...createModifiedPoDraft(1, "mod-1-po-1", "continuing"),
            name: po.name,
            sourcePoId: po.id,
            scopeEffect: "unchanged" as const,
            remainingGoodsDistinctFromTransferred: true,
            remainingDistinctnessRationale: "Each service day is distinct.",
            remainingSspInput: "120,000.00",
            remainingSspBasis: "Observable renewal pricing.",
            totalModifiedSspInput: "240,000.00",
            totalModifiedSspBasis: "Observable renewal pricing.",
            recognitionMethod: "over_time_ratable" as const,
            serviceStart: "2027-07-01",
            serviceEnd: "2028-12-31",
            recognitionRationale: "Simultaneous receipt and consumption.",
          },
          {
            ...createModifiedPoDraft(2, "mod-1-po-2", "added"),
            name: "SaaS subscription (50 added seats)",
            addedGoodsAreDistinct: true,
            addedGoodsDistinctnessRationale: "Separately beneficial added seats.",
            remainingGoodsDistinctFromTransferred: true,
            remainingDistinctnessRationale: "Distinct from service already transferred.",
            remainingSspInput: "90,000.00",
            remainingSspBasis: "Observable per-seat price.",
            totalModifiedSspInput: "90,000.00",
            totalModifiedSspBasis: "Observable per-seat price.",
            recognitionMethod: "over_time_ratable" as const,
            serviceStart: "2027-07-01",
            serviceEnd: "2028-12-31",
            recognitionRationale: "Simultaneous receipt and consumption.",
          },
        ],
      },
    ],

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
    draft.contractModifications = [
      { ...draft.contractModifications[0]!, priceReflectsAddedGoodsSsp: null },
    ];
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
describe("Phase 5C workflow coverage of the remaining treatments", () => {
  /** Case 10 — prospective: added distinct seats priced below their SSP. */
  function case10Draft(): WorkflowDraft {
    const draft = case9Draft();
    const mod = draft.contractModifications[0]!;
    draft.contractModifications = [
      {
        ...mod,
        considerationMagnitudeInput: "18,000.00",
        priceReflectsAddedGoodsSsp: false,
        priceReflectsSspRationale: "The added seats are discounted below standalone price.",
      },
    ];
    return draft;
  }

  /** Case 11 — cumulative catch-up: expanded scope of one non-distinct PO. */
  function case11Draft(): WorkflowDraft {
    const draft = case9Draft();
    const mod = draft.contractModifications[0]!;
    draft.contractModifications = [
      {
        ...mod,
        scopeChangeDescription: "Expanded scope of the same integrated service",
        considerationMagnitudeInput: "30,000.00",
        priceReflectsAddedGoodsSsp: false,
        modifiedPerformanceObligations: [
          {
            ...mod.modifiedPerformanceObligations[0]!,
            scopeEffect: "increase" as const,
            remainingGoodsDistinctFromTransferred: false,
            remainingDistinctnessRationale: "Part of one integrated service.",
            totalModifiedSspInput: "270,000.00",
            serviceStart: "2027-01-01",
            serviceEnd: "2028-12-31",
          },
        ],
      },
    ];
    return draft;
  }

  /** Case 12 — mixed: one non-distinct continuing PO plus one distinct addition. */
  function case12Draft(): WorkflowDraft {
    const draft = case9Draft();
    const mod = draft.contractModifications[0]!;
    draft.contractModifications = [
      {
        ...mod,
        considerationMagnitudeInput: "60,000.00",
        priceReflectsAddedGoodsSsp: false,
        mixedAllocationPolicy: "updated_total_transaction_price" as const,
        mixedAllocationPolicyRationale: "Documented entity policy.",
        modifiedPerformanceObligations: [
          {
            ...mod.modifiedPerformanceObligations[0]!,
            scopeEffect: "increase" as const,
            remainingGoodsDistinctFromTransferred: false,
            remainingDistinctnessRationale: "Part of one integrated service.",
            totalModifiedSspInput: "260,000.00",
            serviceStart: "2027-01-01",
            serviceEnd: "2028-12-31",
          },
          mod.modifiedPerformanceObligations[1]!,
        ],
      },
    ];
    return draft;
  }

  it("finalizes Case 10 prospectively without a catch-up", () => {
    const result = analyzeWorkflow(case10Draft());
    expect(result.finalized).toBe(true);
    expect(result.modification?.classification?.treatment).toBe("prospective");
    expect(result.modification?.totals.catchUpCents).toBe(0);
    expect(result.modification?.reconciliation.reconciled).toBe(true);
    expect(result.contractGroups).toHaveLength(1);
  });

  it("finalizes Case 11 with a cumulative catch-up on the effective date", () => {
    const result = analyzeWorkflow(case11Draft());
    expect(result.finalized).toBe(true);
    expect(result.modification?.classification?.treatment).toBe("cumulative_catch_up");
    expect(result.modification?.catchUpEvents).toHaveLength(1);
    expect(result.modification?.catchUpEvents[0]!.month).toBe("2027-07");
    expect(result.modification?.reconciliation.reconciled).toBe(true);
  });

  it("finalizes Case 12 as a mixed modification under the selected policy", () => {
    const result = analyzeWorkflow(case12Draft());
    expect(result.finalized).toBe(true);
    expect(result.modification?.classification?.treatment).toBe("mixed");
    expect(result.modification?.totals.updatedTotalTransactionPriceCents).toBe(30_000_000);
    expect(result.modification?.reconciliation.reconciled).toBe(true);
  });

  it("blocks a mixed modification with no allocation policy selected", () => {
    const draft = case12Draft();
    draft.contractModifications = [
      { ...draft.contractModifications[0]!, mixedAllocationPolicy: null },
    ];
    const result = analyzeWorkflow(draft);
    expect(result.finalized).toBe(false);
    expect(result.revenueSchedule).toBeNull();
  });

  it("blocks an unapproved modification", () => {
    const draft = case9Draft();
    draft.contractModifications = [
      { ...draft.contractModifications[0]!, approvedAndEnforceable: false },
    ];
    const result = analyzeWorkflow(draft);
    expect(result.finalized).toBe(false);
  });

  it("preserves entered modification data when the feature is switched off", () => {
    const draft = case9Draft();
    const disabled: WorkflowDraft = { ...draft, hasContractModifications: false };
    const result = analyzeWorkflow(disabled);
    expect(result.modification).toBeNull();
    expect(disabled.contractModifications).toHaveLength(1);
    expect(disabled.contractModifications[0]!.modifiedPerformanceObligations).toHaveLength(2);
  });
});

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
