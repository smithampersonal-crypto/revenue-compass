/**
 * Phase 9E — Task 9A. `basis` is provenance/presentation, never arithmetic.
 *
 * Two drafts differing only in the recorded basis of one cash row must produce
 * byte-identical deterministic accounting output from the real engines. ARC
 * does not maintain a second forecast accounting engine.
 */
import { describe, expect, it } from "vitest";

import { buildWorkpaper } from "@/lib/arc/persistence/snapshot";

import { createCashCollectionDraft, type WorkflowDraft } from "../types";
import { scenarioADraft } from "./fixtures";

function withBilling(basis: "actual" | "projected_contract_due_date"): WorkflowDraft {
  const base = scenarioADraft();
  return {
    ...base,
    contractBalances: {
      considerationEvents: [
        {
          id: "ce-1",
          seq: 1,
          amountInput: "120,000.00",
          unconditionalRightDate: "2027-01-01",
          invoiceDate: "2027-01-01",
          amountSource: "manual",
          sourceComponentId: null,
          sourceMonth: "",
        },
      ],
      cashCollections: [
        {
          ...createCashCollectionDraft(1, "cc-1"),
          considerationEventId: "ce-1",
          amountInput: "120,000.00",
          collectionDate: "2027-01-31",
          basis,
        },
      ],
    },
  };
}

describe("cash collection basis does not change accounting", () => {
  it("produces identical engine output for actual and projected cash", () => {
    const actual = buildWorkpaper(withBilling("actual"));
    const projected = buildWorkpaper(withBilling("projected_contract_due_date"));

    expect(projected.workflow).toEqual(actual.workflow);
    expect(projected.balances).toEqual(actual.balances);
    expect(projected.journals).toEqual(actual.journals);
    expect(actual.journals).not.toBeNull();
  });
});
