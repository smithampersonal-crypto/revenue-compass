/**
 * Phase 9E — Task 9A. Cash-collection basis is backward-compatible provenance.
 *
 * A stored `arc.workflow.v1` row written before Phase 9E has no `basis`. It
 * must normalize to `actual`: ARC never treats an unlabelled historical cash
 * row as unknown or projected. Because the normalization is lossless in both
 * directions, the workflow schema version is deliberately NOT bumped.
 */
import { describe, expect, it } from "vitest";

import {
  createCashCollectionDraft,
  createEmptyDraft,
  type WorkflowDraft,
} from "@/lib/asc606-workflow";

import {
  ARC_WORKFLOW_SCHEMA_VERSION,
  parseCanonicalInputs,
  toCanonicalInputs,
  validateDraftForPersistence,
} from "../schema";

function draftWithCash(rows: unknown[]): Record<string, unknown> {
  const draft = createEmptyDraft() as unknown as Record<string, unknown>;
  return {
    ...draft,
    contractBalances: { considerationEvents: [], cashCollections: rows },
  };
}

describe("cash collection basis", () => {
  it("keeps the canonical schema version at arc.workflow.v1", () => {
    expect(ARC_WORKFLOW_SCHEMA_VERSION).toBe("arc.workflow.v1");
  });

  it("parses a legacy stored row with no basis as actual", () => {
    const stored = {
      schemaVersion: ARC_WORKFLOW_SCHEMA_VERSION,
      draft: draftWithCash([
        { id: "cc-1", seq: 1, considerationEventId: "ce-1", amountInput: "100", collectionDate: "2027-01-31" },
      ]),
    };
    const parsed = parseCanonicalInputs(stored);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.draft.contractBalances.cashCollections[0]!.basis).toBe("actual");
  });

  it("defaults a newly created manual collection to actual", () => {
    expect(createCashCollectionDraft(1, "cc-1").basis).toBe("actual");
  });

  it("round-trips an explicit projected collection through persistence", () => {
    const draft: WorkflowDraft = {
      ...createEmptyDraft(),
      contractBalances: {
        considerationEvents: [],
        cashCollections: [
          {
            ...createCashCollectionDraft(1, "cc-1"),
            amountInput: "245000",
            collectionDate: "2026-12-01",
            basis: "projected_contract_due_date",
          },
        ],
      },
    };
    const validated = validateDraftForPersistence(draft);
    expect(validated.ok).toBe(true);
    const parsed = parseCanonicalInputs(toCanonicalInputs(draft));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.draft.contractBalances.cashCollections[0]!.basis).toBe(
      "projected_contract_due_date",
    );
  });

  it("rejects an unknown basis value", () => {
    const parsed = parseCanonicalInputs({
      schemaVersion: ARC_WORKFLOW_SCHEMA_VERSION,
      draft: draftWithCash([
        {
          id: "cc-1",
          seq: 1,
          considerationEventId: null,
          amountInput: "1",
          collectionDate: "",
          basis: "guessed",
        },
      ]),
    });
    expect(parsed.ok).toBe(false);
  });
});
