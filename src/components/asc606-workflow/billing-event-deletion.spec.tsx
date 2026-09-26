// @vitest-environment jsdom
/**
 * Phase 9G-R3 / Phase L — the REAL "Remove billing event" interaction.
 *
 * The deletion-identity suite exercises the merge with hand-authored drafts.
 * This suite exercises the shipped component instead: an accountant clicks the
 * button, and the canonical draft the component produces is then carried
 * through the real autosave edit reconciliation, the real sidecar serializer
 * and a real renamed-schedule re-analysis.
 *
 * No model, no network, no database. All data is fictional.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { reconcileAiEdits } from "@/lib/arc/ai/edit-reconciliation";
import {
  createEmptyAiAnalysisState,
  mergeAiAnalysis,
  type AiAnalysisState,
} from "@/lib/arc/ai/merge";
import type { AiContractAnalysis } from "@/lib/arc/ai/schema";
import { toPersistedAiState } from "@/lib/arc/ai/state-serialization";
import { decodeTombstones } from "@/lib/arc/ai/tombstones";
import {
  DRIFT_RUN_1,
  DRIFT_RUN_2,
  driftRun1Analysis,
  driftRun2Analysis,
} from "@/lib/arc/ai/__tests__/drift-fixtures";
import { guidancePackFixture } from "@/lib/arc/ai/__tests__/merge-fixtures";
import {
  analyzeContractBalanceWorkflow,
  analyzeWorkflow,
  createEmptyDraft,
  type WorkflowDraft,
} from "@/lib/asc606-workflow";

import { BillingAndBalances } from "./BillingAndBalances";

const RUN1_KEY = "fixed_annual_advance_billing";
const RUN2_KEY = "billing_fixed_annual_advance";

type BillingTerm = AiContractAnalysis["billingTerms"][number];

function annualAdvanceTerm(semanticKey: string): BillingTerm {
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
  };
}

function withBilling(analysis: AiContractAnalysis, terms: readonly BillingTerm[]) {
  analysis.billingTerms = [...terms];
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

const run1 = () =>
  merge(
    withBilling(driftRun1Analysis(), [annualAdvanceTerm(RUN1_KEY)]),
    createEmptyDraft(),
    createEmptyAiAnalysisState(),
    DRIFT_RUN_1,
  );

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

/** Renders the shipped workpaper editor and exposes the draft it produces. */
function mount(initial: WorkflowDraft) {
  const state = { draft: initial };
  function Harness() {
    const [draft, setDraft] = useState(initial);
    state.draft = draft;
    return (
      <BillingAndBalances
        draft={draft}
        onChange={setDraft}
        balances={analyzeContractBalanceWorkflow(draft)}
        contractGroups={analyzeWorkflow(draft).contractGroups}
      />
    );
  }
  render(<Harness />);
  return state;
}

const balanceIssueIds = (draft: WorkflowDraft) =>
  analyzeContractBalanceWorkflow(draft).validation.issues.map((issue) => issue.id);

describe("Remove billing event — real UI deletion semantics", () => {
  it("removes the invoice and its AI-projected collection, leaving no orphan", () => {
    const first = run1();
    const [period1] = first.draft.contractBalances.considerationEvents.map((row) => row.id).sort();
    const ui = mount(first.draft);

    fireEvent.click(screen.getByTestId(`remove-billing-event-${period1}`));

    expect(ui.draft.contractBalances.considerationEvents.map((row) => row.id)).not.toContain(
      period1,
    );
    expect(
      ui.draft.contractBalances.cashCollections.some(
        (row) => row.considerationEventId === period1!,
      ),
    ).toBe(false);
    expect(balanceIssueIds(ui.draft)).not.toContain("cash.event_reference.valid");
  });

  it("records both deletion identities and a rename recreates neither", () => {
    const first = run1();
    const ids = first.draft.contractBalances.considerationEvents.map((row) => row.id).sort();
    const ui = mount(first.draft);
    fireEvent.click(screen.getByTestId(`remove-billing-event-${ids[0]}`));

    const reconciled = reconcileAiEdits({
      previousDraft: first.draft,
      nextDraft: ui.draft,
      currentAiState: first.aiState,
    });
    const saved = saveAndReload(reconciled.aiState);
    const kinds = (saved.tombstoneIdentities ?? []).map((entry) => entry.kind);
    expect(kinds).toContain("billing_event");
    expect(kinds).toContain("billing_collection");

    const second = merge(
      withBilling(driftRun2Analysis(), [annualAdvanceTerm(RUN2_KEY)]),
      ui.draft,
      saved,
      DRIFT_RUN_2,
    );
    expect(second.draft.contractBalances.considerationEvents.map((row) => row.id)).toEqual([
      ids[1],
    ]);
    expect(second.draft.contractBalances.cashCollections).toHaveLength(1);
    expect(balanceIssueIds(second.draft)).not.toContain("cash.event_reference.valid");
  });

  it("never silently discards recorded cash applied to the invoice", () => {
    const first = run1();
    const ids = first.draft.contractBalances.considerationEvents.map((row) => row.id).sort();
    const withActualCash: WorkflowDraft = {
      ...first.draft,
      contractBalances: {
        ...first.draft.contractBalances,
        cashCollections: first.draft.contractBalances.cashCollections.map((row) =>
          row.considerationEventId === ids[0] ? { ...row, basis: "actual" as const } : row,
        ),
      },
    };
    const ui = mount(withActualCash);

    const button = screen.getByTestId(`remove-billing-event-${ids[0]}`);
    expect(button).toBeDisabled();
    fireEvent.click(button);

    expect(ui.draft.contractBalances.considerationEvents).toHaveLength(2);
    expect(ui.draft.contractBalances.cashCollections).toHaveLength(2);
    expect(balanceIssueIds(ui.draft)).not.toContain("cash.event_reference.valid");
  });
});
