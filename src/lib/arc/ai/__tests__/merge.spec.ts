/**
 * Phase 9E — the primary acceptance checkpoint.
 *
 * An AI-adapted canonical draft and an independently hand-entered equivalent
 * canonical draft must produce identical output from the REAL deterministic
 * engines. No arithmetic is duplicated in this test: it calls `buildWorkpaper`,
 * the same entry point the workspace and the finalization snapshot use.
 */
import { describe, expect, it } from "vitest";

import { buildWorkpaper } from "@/lib/arc/persistence/snapshot";
import { answerAllStep1, scenarioADraft } from "@/lib/asc606-workflow/__tests__/fixtures";
import {
  createCashCollectionDraft,
  createConsiderationEventDraft,
  createEmptyDraft,
  createPoDraft,
  createPromiseDraft,
  STEP1_CRITERIA,
  type WorkflowDraft,
} from "@/lib/asc606-workflow";

import { deriveCanonicalId } from "../identity";
import { aiContractAnalysisSchema } from "../schema";
import { createEmptyAiAnalysisState, mergeAiAnalysis } from "../merge";
import { fixtureAAnalysis, guidancePackFixture, RUN_ID } from "./merge-fixtures";

const PROMISE_ID = deriveCanonicalId("promise", "promise:saas");
const PO_ID = deriveCanonicalId("performance_obligation", "po:saas");
const EVENT_ID = deriveCanonicalId("consideration_event", "billing:annual-advance#1");
const CASH_ID = deriveCanonicalId("cash_collection", "billing:annual-advance#1#collection");

function adapt(): ReturnType<typeof mergeAiAnalysis> {
  return mergeAiAnalysis({
    currentDraft: createEmptyDraft(),
    currentAiState: createEmptyAiAnalysisState(),
    analysis: fixtureAAnalysis(),
    runId: RUN_ID,
    guidancePack: guidancePackFixture(),
    priorContext: null,
  });
}

/** Hand-entered equivalent. Deliberately NOT produced by the adapter. */
function manualEquivalent(): WorkflowDraft {
  const analysis = fixtureAAnalysis();
  const base = createEmptyDraft();
  const criteria = { ...base.contract.criteria };
  const rationales: Record<string, string> = {
    approval_and_commitment: analysis.contractAssessment.approvalAndCommitment.rationale,
    rights_identifiable: analysis.contractAssessment.identifiableRights.rationale,
    payment_terms_identifiable: analysis.contractAssessment.identifiablePaymentTerms.rationale,
    commercial_substance: analysis.contractAssessment.commercialSubstance.rationale,
    collectibility_probable: analysis.contractAssessment.collectibility.rationale,
  };
  for (const criterion of STEP1_CRITERIA) {
    criteria[criterion.id] = { answer: true, rationale: rationales[criterion.id]! };
  }

  return {
    ...base,
    contract: {
      ...base.contract,
      customerName: "Redwood Retail",
      executionDate: "2027-01-01",
      criteria,
    },
    // ARC derives the full-term fixed consideration from the contract's own
    // billing schedule; model arithmetic is never authoritative.
    transactionPriceInput: "120000.00",
    transactionPriceNotes:
      "ARC derived the full-term fixed consideration of 120000.00 from the contract's annual billing schedule of 120000 across 1 billing periods in the contract service period.",
    promises: [
      {
        ...createPromiseDraft(1, PROMISE_ID),
        // Package 2C-B: the additive presentation label.
        displayName: "Hosted SaaS Access",
        description: "Annual hosted SaaS service",
        capableOfBeingDistinct: true,
        distinctWithinContractContext: true,
        distinctRationale: "Benefit available on its own; not significantly integrated.",
        performanceObligationId: PO_ID,
      },
    ],
    performanceObligations: [
      {
        ...createPoDraft(1, PO_ID),
        // Package 2C-B: the canonical PO name is the concise accounting label.
        name: "Hosted SaaS Service Series",
        classification: "single_distinct",
        classificationRationale: "Single distinct hosted service.",
        sspInput: "120000",
        sspBasis: "Observable standalone renewal pricing.",
        recognitionMethod: "over_time_ratable",
        // The accountant's equivalent choice: over time, measured by time.
        overTimeMeasure: "time_based",
        serviceStart: "2027-01-01",
        serviceEnd: "2027-12-31",
        recognitionRationale: "Customer simultaneously receives and consumes the hosted service.",
      },
    ],
    contractBalances: {
      considerationEvents: [
        {
          ...createConsiderationEventDraft(1, EVENT_ID),
          amountInput: "120000",
          invoiceDate: "2027-01-01",
          unconditionalRightDate: "2027-01-01",
        },
      ],
      cashCollections: [
        {
          ...createCashCollectionDraft(1, CASH_ID),
          considerationEventId: EVENT_ID,
          amountInput: "120000",
          collectionDate: "2027-01-31",
          basis: "projected_contract_due_date",
        },
      ],
    },
  };
}

describe("the Phase 9E fixtures are real, schema-valid model output", () => {
  it("parses under the accepted Phase 9D strict schema", () => {
    expect(() => aiContractAnalysisSchema.parse(fixtureAAnalysis())).not.toThrow();
  });
});

describe("Fixture A — AI-adapted and manual canonical inputs are equivalent", () => {
  it("produces the identical canonical draft", () => {
    expect(adapt().draft).toEqual(manualEquivalent());
  });

  it("leaves the contract number blank without blocking when none is stated", () => {
    const { draft, issues } = adapt();
    expect(draft.contract.contractNumber).toBe("");
    expect(issues.some((i) => i.targetKey === "contract.contractNumber")).toBe(false);
  });

  it("produces identical deterministic engine output", () => {
    // This fixture states no contract reference, so the accountant supplies
    // the same one on both sides.
    const withNumber = (draft: WorkflowDraft): WorkflowDraft => ({
      ...draft,
      contract: { ...draft.contract, contractNumber: "CASE-1" },
    });
    const fromAi = buildWorkpaper(withNumber(adapt().draft));
    const fromManual = buildWorkpaper(withNumber(manualEquivalent()));

    expect(fromAi.workflow).toEqual(fromManual.workflow);
    expect(fromAi.balances).toEqual(fromManual.balances);
    expect(fromAi.journals).toEqual(fromManual.journals);
    // The fixture is complete enough to finalize, so this is a real comparison.
    expect(fromAi.workflow.finalized).toBe(true);
    expect(fromAi.journals).not.toBeNull();
  });

  it("derives the billing event and the Net 30 projected collection", () => {
    const { draft } = adapt();
    const [event] = draft.contractBalances.considerationEvents;
    const [cash] = draft.contractBalances.cashCollections;
    expect(event!.invoiceDate).toBe("2027-01-01");
    expect(event!.amountInput).toBe("120000");
    expect(cash!.considerationEventId).toBe(event!.id);
    expect(cash!.collectionDate).toBe("2027-01-31");
    expect(cash!.basis).toBe("projected_contract_due_date");
    // No actual cash is ever inferred from a contract.
    expect(draft.contractBalances.cashCollections.every((row) => row.basis !== "actual")).toBe(
      true,
    );
  });

  it("never writes AI metadata into the canonical draft", () => {
    const serialized = JSON.stringify(adapt().draft);
    for (const forbidden of [
      "semanticKey",
      "guidanceIds",
      "citations",
      "reviewState",
      "lastAiRunId",
      "valueFingerprint",
      RUN_ID,
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("is pure: identical inputs produce identical output and inputs are unchanged", () => {
    const currentDraft = scenarioADraft();
    const currentAiState = createEmptyAiAnalysisState();
    const analysis = fixtureAAnalysis();
    const guidancePack = guidancePackFixture();
    const before = JSON.stringify({ currentDraft, currentAiState, analysis, guidancePack });

    const args = {
      currentDraft,
      currentAiState,
      analysis,
      runId: RUN_ID,
      guidancePack,
      priorContext: null,
    };
    const first = mergeAiAnalysis(args);
    const second = mergeAiAnalysis(args);

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(JSON.stringify({ currentDraft, currentAiState, analysis, guidancePack })).toBe(before);
  });

  it("keeps a manually answered Step 1 judgment and records the AI difference", () => {
    const manual = answerAllStep1(createEmptyDraft(), false);
    const { draft, issues } = mergeAiAnalysis({
      currentDraft: manual,
      currentAiState: createEmptyAiAnalysisState(),
      analysis: fixtureAAnalysis(),
      runId: RUN_ID,
      guidancePack: guidancePackFixture(),
      priorContext: null,
    });
    expect(draft.contract.criteria.collectibility_probable.answer).toBe(false);
    expect(
      issues.some(
        (issue) => issue.targetKey === "contract.criteria.collectibility_probable.answer",
      ),
    ).toBe(true);
  });
});
