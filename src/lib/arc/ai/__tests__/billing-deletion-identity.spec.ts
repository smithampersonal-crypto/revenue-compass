/**
 * Phase 9G-R3 / Phase L — billing deletion identity.
 *
 * A deleted invoice (or its projected collection) must stay deleted when the
 * model renames the billing schedule. The deletion is recorded by the economic
 * SCHEDULE identity plus the deterministic schedule period, so it survives
 * even when no live row of that period remains to carry the old alias.
 *
 * Everything runs through the real merge, the real autosave edit
 * reconciliation and the real sidecar serializer. No model, no network, no
 * database. All data is hand-authored and fictional.
 */
import { describe, expect, it } from "vitest";

import { createEmptyDraft, type WorkflowDraft } from "@/lib/asc606-workflow";

import { reconcileAiEdits } from "../edit-reconciliation";
import { createEmptyAiAnalysisState, mergeAiAnalysis, type AiAnalysisState } from "../merge";
import type { AiContractAnalysis } from "../schema";
import { toPersistedAiState } from "../state-serialization";
import { decodeTombstones } from "../tombstones";
import { DRIFT_RUN_1, DRIFT_RUN_2, driftRun1Analysis, driftRun2Analysis } from "./drift-fixtures";
import { guidancePackFixture } from "./merge-fixtures";

const DRIFT_RUN_3 = "run-00000000-0000-4000-8000-0000000000a3";

const RUN1_KEY = "fixed_annual_advance_billing";
const RUN2_KEY = "billing_fixed_annual_advance";
const RUN3_KEY = "annual_advance_invoice_schedule";

type BillingTerm = AiContractAnalysis["billingTerms"][number];

function annualAdvanceTerm(semanticKey: string, overrides: Partial<BillingTerm> = {}): BillingTerm {
  return {
    semanticKey,
    description: "Annual advance subscription invoice.",
    billingTiming: "advance",
    frequency: "annual",
    invoiceTrigger: "Start of each annual period.",
    amountOrRateInput: "245000",
    paymentTermsDays: 30,
    dueDateRule: "Net 30 from invoice date.",
    citations: [
      {
        documentId: "doc-r1-fixture-1",
        pageStart: 1,
        pageEnd: 1,
        evidenceMode: "text" as const,
        excerpt: "billing schedule annual advance ($245,000/yr net 30)",
      },
    ],
    reviewState: "supported",
    amountKind: "fixed_invoice_amount",
    ...overrides,
  };
}

function withBilling(
  analysis: AiContractAnalysis,
  billingTerms: readonly BillingTerm[],
): AiContractAnalysis {
  analysis.billingTerms = [...billingTerms];
  return analysis;
}

function merge(
  analysis: AiContractAnalysis,
  currentDraft: WorkflowDraft,
  currentAiState: AiAnalysisState,
  runId: string,
) {
  return mergeAiAnalysis({
    currentDraft,
    currentAiState,
    analysis,
    runId,
    guidancePack: guidancePackFixture(),
    priorContext: null,
  });
}

function run1(terms: readonly BillingTerm[] = [annualAdvanceTerm(RUN1_KEY)]) {
  return merge(
    withBilling(driftRun1Analysis(), terms),
    createEmptyDraft(),
    createEmptyAiAnalysisState(),
    DRIFT_RUN_1,
  );
}

const eventIds = (draft: WorkflowDraft) =>
  draft.contractBalances.considerationEvents.map((row) => row.id).sort();
const cashIds = (draft: WorkflowDraft) =>
  draft.contractBalances.cashCollections.map((row) => row.id).sort();

/** Saves the sidecar exactly as the database stores it and reads it back. */
function saveAndReload(state: AiAnalysisState): AiAnalysisState {
  const persisted = toPersistedAiState(state);
  const decoded = decodeTombstones(persisted["tombstones"]);
  return {
    ...(persisted as unknown as AiAnalysisState),
    tombstones: decoded.tombstones,
    tombstoneIdentities: decoded.tombstoneIdentities,
  };
}

/** One accountant autosave that removed rows from the canonical draft. */
function autosave(previousDraft: WorkflowDraft, nextDraft: WorkflowDraft, state: AiAnalysisState) {
  const reconciled = reconcileAiEdits({ previousDraft, nextDraft, currentAiState: state });
  return { draft: nextDraft, aiState: saveAndReload(reconciled.aiState) };
}

/** Removes one invoice (by canonical ID) and the collection attached to it. */
function withoutInvoice(draft: WorkflowDraft, eventId: string): WorkflowDraft {
  return {
    ...draft,
    contractBalances: {
      ...draft.contractBalances,
      considerationEvents: draft.contractBalances.considerationEvents.filter(
        (row) => row.id !== eventId,
      ),
      cashCollections: draft.contractBalances.cashCollections.filter(
        (row) => row.considerationEventId !== eventId,
      ),
    },
  };
}

describe("billing deletion identity survives schedule renames", () => {
  it("run 1 creates two invoices and two projected collections", () => {
    const first = run1();
    expect(first.draft.contractBalances.considerationEvents).toHaveLength(2);
    expect(first.draft.contractBalances.cashCollections).toHaveLength(2);
  });

  it("a deleted period-1 invoice and collection do not return through two renames", () => {
    const first = run1();
    const [period1, period2] = eventIds(first.draft);
    const saved = autosave(first.draft, withoutInvoice(first.draft, period1!), first.aiState);

    const second = merge(
      withBilling(driftRun2Analysis(), [annualAdvanceTerm(RUN2_KEY)]),
      saved.draft,
      saved.aiState,
      DRIFT_RUN_2,
    );
    expect(second.draft.contractBalances.considerationEvents).toHaveLength(1);
    expect(second.draft.contractBalances.cashCollections).toHaveLength(1);
    expect(eventIds(second.draft)).toEqual([period2]);

    const reloaded = saveAndReload(second.aiState);
    const third = merge(
      withBilling(driftRun2Analysis(), [annualAdvanceTerm(RUN3_KEY)]),
      second.draft,
      reloaded,
      DRIFT_RUN_3,
    );
    expect(third.draft.contractBalances.considerationEvents).toHaveLength(1);
    expect(eventIds(third.draft)).toEqual([period2]);
    expect(cashIds(third.draft)).toEqual(cashIds(second.draft));
  });

  it("deleting only a projected collection does not recreate it after a rename", () => {
    const first = run1();
    const removedCash = cashIds(first.draft)[0]!;
    const next: WorkflowDraft = {
      ...first.draft,
      contractBalances: {
        ...first.draft.contractBalances,
        cashCollections: first.draft.contractBalances.cashCollections.filter(
          (row) => row.id !== removedCash,
        ),
      },
    };
    const saved = autosave(first.draft, next, first.aiState);

    const second = merge(
      withBilling(driftRun2Analysis(), [annualAdvanceTerm(RUN2_KEY)]),
      saved.draft,
      saved.aiState,
      DRIFT_RUN_2,
    );
    expect(second.draft.contractBalances.considerationEvents).toHaveLength(2);
    expect(eventIds(second.draft)).toEqual(eventIds(first.draft));
    expect(cashIds(second.draft)).not.toContain(removedCash);
    expect(second.draft.contractBalances.cashCollections).toHaveLength(1);
  });

  it("deleting the whole AI billing schedule does not let a rename bring it back", () => {
    const first = run1();
    const emptied: WorkflowDraft = {
      ...first.draft,
      contractBalances: {
        ...first.draft.contractBalances,
        considerationEvents: [],
        cashCollections: [],
      },
    };
    const saved = autosave(first.draft, emptied, first.aiState);

    const second = merge(
      withBilling(driftRun2Analysis(), [annualAdvanceTerm(RUN2_KEY)]),
      saved.draft,
      saved.aiState,
      DRIFT_RUN_2,
    );
    expect(second.draft.contractBalances.considerationEvents).toEqual([]);
    expect(second.draft.contractBalances.cashCollections).toEqual([]);
  });

  it("a genuinely new billing schedule is still creatable after a deletion", () => {
    const first = run1();
    const saved = autosave(
      first.draft,
      withoutInvoice(first.draft, eventIds(first.draft)[0]!),
      first.aiState,
    );
    const implementation = annualAdvanceTerm("implementation_fee_invoice", {
      description: "One-time implementation fee invoice.",
      frequency: "one_time",
      invoiceTrigger: "Contract signature.",
      amountOrRateInput: "50000",
      citations: [
        {
          documentId: "doc-r1-fixture-1",
          pageStart: 7,
          pageEnd: 7,
          evidenceMode: "text" as const,
          excerpt: "The one-time $50,000 implementation fee is invoiced upon signing.",
        },
      ],
    });
    const second = merge(
      withBilling(driftRun2Analysis(), [annualAdvanceTerm(RUN2_KEY), implementation]),
      saved.draft,
      saved.aiState,
      DRIFT_RUN_2,
    );
    expect(second.draft.contractBalances.considerationEvents).toHaveLength(2);
  });

  it("an ambiguous deleted invoice identity fails closed and creates nothing", () => {
    const platform = annualAdvanceTerm("platform_annual_advance");
    const twin = annualAdvanceTerm("platform_annual_advance_twin");
    const first = run1([platform, twin]);
    expect(first.draft.contractBalances.considerationEvents).toHaveLength(4);

    const emptied: WorkflowDraft = {
      ...first.draft,
      contractBalances: {
        ...first.draft.contractBalances,
        considerationEvents: [],
        cashCollections: [],
      },
    };
    const saved = autosave(first.draft, emptied, first.aiState);

    const second = merge(
      withBilling(driftRun2Analysis(), [annualAdvanceTerm(RUN2_KEY)]),
      saved.draft,
      saved.aiState,
      DRIFT_RUN_2,
    );
    expect(second.draft.contractBalances.considerationEvents).toEqual([]);
    expect(second.draft.contractBalances.cashCollections).toEqual([]);
    expect(second.issues.some((issue) => issue.reasonCode === "unsafe_semantic_relationship")).toBe(
      true,
    );
  });

  it("the deletion identity survives the real sidecar serializer", () => {
    const first = run1();
    const saved = autosave(
      first.draft,
      withoutInvoice(first.draft, eventIds(first.draft)[0]!),
      first.aiState,
    );
    const kinds = (saved.aiState.tombstoneIdentities ?? []).map((entry) => entry.kind);
    expect(kinds).toContain("billing_event");
    expect(kinds).toContain("billing_collection");
    const persisted = toPersistedAiState(saved.aiState);
    expect(persisted["tombstoneIdentities"]).toBeUndefined();
    expect(decodeTombstones(persisted["tombstones"]).tombstoneIdentities.length).toBe(
      (saved.aiState.tombstoneIdentities ?? []).length,
    );
  });
});
