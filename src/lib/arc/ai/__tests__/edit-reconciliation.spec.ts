/**
 * Phase 9G — Task 4. Pure edit reconciliation.
 *
 * The canonical draft is authoritative. These tests prove that an ordinary
 * accountant edit deterministically updates AI provenance, tombstones and
 * review state — and never the other way round. No database, no clock, no
 * network, no AI.
 */
import { describe, expect, it } from "vitest";

import {
  createCashCollectionDraft,
  createConsiderationEventDraft,
  createEmptyDraft,
  createPoDraft,
  createModificationDraft,
  createPromiseDraft,
  createModifiedPoDraft,
  createVcComponentDraft,
  createVcMeterDraft,
  type WorkflowDraft,
} from "@/lib/asc606-workflow";

import {
  applyEditReviewIntents,
  canonicalReviewTargetFingerprint,
  reconcileAiEdits,
  type EditReviewEventIntent,
} from "../edit-reconciliation";
import { fieldKeys, valueFingerprint } from "../identity";
import { createEmptyAiAnalysisState, type AiAnalysisState } from "../merge";
import type { AiReviewItem } from "../review-state";

const RUN = "run-1";
const NOW = "2027-03-01T00:00:00Z";

const PROMISE_ID = "pr-saas";
const PO_ID = "po-saas";
const EVENT_ID = "ce-annual";
const CASH_ID = "cc-annual";

function baseDraft(): WorkflowDraft {
  const empty = createEmptyDraft();
  return {
    ...empty,
    contract: { ...empty.contract, customerName: "Redwood Retail" },
    transactionPriceInput: "120000",
    promises: [
      {
        ...createPromiseDraft(1, PROMISE_ID),
        description: "Annual hosted SaaS service",
        performanceObligationId: PO_ID,
      },
    ],
    performanceObligations: [
      {
        ...createPoDraft(1, PO_ID),
        name: "SaaS subscription",
        sspInput: "120000",
        recognitionMethod: "over_time_ratable",
        serviceStart: "2027-01-01",
        serviceEnd: "2027-12-31",
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

function aiState(draft: WorkflowDraft, overrides: Partial<AiAnalysisState> = {}): AiAnalysisState {
  return {
    ...createEmptyAiAnalysisState(),
    lastSuccessfulRunId: RUN,
    sourceSetFingerprint: "f".repeat(64),
    sourceState: "current",
    fieldProvenance: {
      [fieldKeys.transactionPrice("input")]: {
        state: "ai_generated_untouched",
        semanticKey: "price:total",
        lastAiRunId: RUN,
        valueFingerprint: valueFingerprint(draft.transactionPriceInput),
      },
      [fieldKeys.contract("customerName")]: {
        state: "manual_from_start",
        semanticKey: null,
        lastAiRunId: null,
        valueFingerprint: valueFingerprint(draft.contract.customerName),
      },
      [fieldKeys.po(PO_ID, "sspInput")]: {
        state: "prior_finalized",
        semanticKey: null,
        lastAiRunId: null,
        valueFingerprint: valueFingerprint(draft.performanceObligations[0]!.sspInput),
      },
    },
    objectProvenance: {
      "promise:saas": {
        state: "ai_generated_untouched",
        semanticKey: "promise:saas",
        lastAiRunId: RUN,
        valueFingerprint: "baseline-promise",
        canonicalId: PROMISE_ID,
        userModified: false,
      },
      "billing:annual": {
        state: "ai_generated_untouched",
        semanticKey: "billing:annual",
        lastAiRunId: RUN,
        valueFingerprint: "baseline-billing",
        canonicalId: EVENT_ID,
        userModified: false,
      },
    },
    ...overrides,
  };
}

function reviewItem(overrides: Partial<AiReviewItem> = {}): AiReviewItem {
  return {
    id: "rev-1",
    targetKey: fieldKeys.billing(EVENT_ID, "amountInput"),
    section: "step_3",
    state: "yellow",
    severity: "yellow",
    reasonCode: "accountant_affirmation_required",
    reason: "Affirm the billing term.",
    guidanceIds: [],
    citations: [],
    valueFingerprint: "v1",
    reviewFingerprint: "rf-1",
    resolution: null,
    affirmedAt: null,
    affirmedMethod: null,
    ...overrides,
  };
}

function edit(mutate: (draft: WorkflowDraft) => void): WorkflowDraft {
  const next = structuredClone(baseDraft());
  mutate(next);
  return next;
}

describe("no-op reconciliation", () => {
  it("changes nothing when the draft is identical", () => {
    const draft = baseDraft();
    const result = reconcileAiEdits({
      previousDraft: draft,
      nextDraft: structuredClone(draft),
      currentAiState: aiState(draft),
    });
    expect(result.changed).toBe(false);
    expect(result.reviewEvents).toEqual([]);
    expect(result.aiState).toEqual(aiState(draft));
  });

  it("changes nothing when there is no AI state at all", () => {
    const draft = baseDraft();
    const result = reconcileAiEdits({
      previousDraft: draft,
      nextDraft: edit((next) => {
        next.transactionPriceInput = "999";
      }),
      currentAiState: createEmptyAiAnalysisState(),
    });
    expect(result.changed).toBe(false);
  });

  it("never mutates its inputs", () => {
    const draft = baseDraft();
    const state = aiState(draft);
    const before = JSON.stringify({ draft, state });
    reconcileAiEdits({
      previousDraft: draft,
      nextDraft: edit((next) => {
        next.transactionPriceInput = "150000";
      }),
      currentAiState: state,
    });
    expect(JSON.stringify({ draft, state })).toBe(before);
  });
});

describe("field provenance", () => {
  it("marks an edited untouched AI scalar as user-edited and keeps the AI baseline", () => {
    const draft = baseDraft();
    const state = aiState(draft);
    const key = fieldKeys.transactionPrice("input");
    const result = reconcileAiEdits({
      previousDraft: draft,
      nextDraft: edit((next) => {
        next.transactionPriceInput = "150000";
      }),
      currentAiState: state,
    });
    const after = result.aiState.fieldProvenance[key]!;
    expect(after.state).toBe("ai_generated_user_edited");
    expect(after.valueFingerprint).toBe(state.fieldProvenance[key]!.valueFingerprint);
    expect(after.lastAiRunId).toBe(RUN);
    expect(after.semanticKey).toBe("price:total");
    expect(result.changed).toBe(true);
  });

  it("keeps user ownership sticky when the AI value is typed back in", () => {
    const draft = baseDraft();
    const edited = edit((next) => {
      next.transactionPriceInput = "150000";
    });
    const first = reconcileAiEdits({
      previousDraft: draft,
      nextDraft: edited,
      currentAiState: aiState(draft),
    });
    const second = reconcileAiEdits({
      previousDraft: edited,
      nextDraft: baseDraft(),
      currentAiState: first.aiState,
    });
    expect(second.aiState.fieldProvenance[fieldKeys.transactionPrice("input")]!.state).toBe(
      "ai_generated_user_edited",
    );
  });

  it("leaves manual and prior-finalized provenance alone", () => {
    const draft = baseDraft();
    const result = reconcileAiEdits({
      previousDraft: draft,
      nextDraft: edit((next) => {
        next.contract.customerName = "Redwood Retail Inc.";
        next.performanceObligations[0]!.sspInput = "130000";
      }),
      currentAiState: aiState(draft),
    });
    expect(result.aiState.fieldProvenance[fieldKeys.contract("customerName")]!.state).toBe(
      "manual_from_start",
    );
    expect(result.aiState.fieldProvenance[fieldKeys.po(PO_ID, "sspInput")]!.state).toBe(
      "prior_finalized",
    );
  });

  it("preserves the last successful run and the source fingerprint", () => {
    const draft = baseDraft();
    const state = aiState(draft);
    const result = reconcileAiEdits({
      previousDraft: draft,
      nextDraft: edit((next) => {
        next.transactionPriceInput = "150000";
      }),
      currentAiState: state,
    });
    expect(result.aiState.lastSuccessfulRunId).toBe(RUN);
    expect(result.aiState.sourceSetFingerprint).toBe(state.sourceSetFingerprint);
    expect(result.aiState.sourceState).toBe("current");
  });
});

describe("object provenance and tombstones", () => {
  it("marks an edited AI object user-modified and keeps its baseline", () => {
    const draft = baseDraft();
    const result = reconcileAiEdits({
      previousDraft: draft,
      nextDraft: edit((next) => {
        next.promises[0]!.description = "Annual hosted SaaS service and support";
      }),
      currentAiState: aiState(draft),
    });
    const provenance = result.aiState.objectProvenance["promise:saas"]!;
    expect(provenance.userModified).toBe(true);
    expect(provenance.state).toBe("ai_generated_user_edited");
    expect(provenance.valueFingerprint).toBe("baseline-promise");
  });

  it("tombstones an AI object the accountant deleted", () => {
    const draft = baseDraft();
    const result = reconcileAiEdits({
      previousDraft: draft,
      nextDraft: edit((next) => {
        next.promises = [];
      }),
      currentAiState: aiState(draft),
    });
    expect(result.aiState.tombstones).toContain("promise:saas");
    expect(result.aiState.objectProvenance["promise:saas"]).toBeUndefined();
  });

  it("invents no AI provenance for a row the accountant created or deleted", () => {
    const draft = baseDraft();
    const result = reconcileAiEdits({
      previousDraft: draft,
      nextDraft: edit((next) => {
        next.performanceObligations = [];
      }),
      currentAiState: aiState(draft),
    });
    expect(result.aiState.tombstones).toEqual([]);
    expect(Object.keys(result.aiState.objectProvenance).sort()).toEqual([
      "billing:annual",
      "promise:saas",
    ]);
  });
});

describe("yellow review items", () => {
  it("resolves an open yellow item whose exact target was edited, with method edited", () => {
    const draft = baseDraft();
    const state = aiState(draft, { reviewItems: [reviewItem()] });
    const result = reconcileAiEdits({
      previousDraft: draft,
      nextDraft: edit((next) => {
        next.contractBalances.considerationEvents[0]!.amountInput = "130000";
      }),
      currentAiState: state,
    });
    expect(result.reviewEvents).toEqual([
      {
        type: "yellow_affirmed",
        reviewItemId: "rev-1",
        targetKey: fieldKeys.billing(EVENT_ID, "amountInput"),
        section: "step_3",
        severity: "yellow",
        reviewFingerprint: "rf-1",
      } satisfies EditReviewEventIntent,
    ]);

    const stamped = applyEditReviewIntents(result.aiState, result.reviewEvents, NOW);
    const item = stamped.reviewItems[0]!;
    expect(item.state).toBe("resolved");
    expect(item.resolution).toEqual({
      kind: "affirmed",
      at: NOW,
      method: "edited",
      reviewFingerprint: "rf-1",
    });
    expect(item.affirmedMethod).toBe("edited");
    expect(item.affirmedAt).toBe(NOW);
  });

  it("leaves a yellow item open when an unrelated field is edited", () => {
    const draft = baseDraft();
    const result = reconcileAiEdits({
      previousDraft: draft,
      nextDraft: edit((next) => {
        next.contract.customerName = "Someone Else";
      }),
      currentAiState: aiState(draft, { reviewItems: [reviewItem()] }),
    });
    expect(result.reviewEvents).toEqual([]);
    expect(result.aiState.reviewItems[0]!.state).toBe("yellow");
  });
});

describe("reopening settled conclusions", () => {
  const resolvedYellow = reviewItem({
    state: "resolved",
    resolution: {
      kind: "affirmed",
      at: "2027-02-01T00:00:00Z",
      method: "individual",
      reviewFingerprint: "rf-1",
    },
    affirmedAt: "2027-02-01T00:00:00Z",
    affirmedMethod: "individual",
  });

  const resolvedRed = reviewItem({
    id: "rev-2",
    targetKey: fieldKeys.po(PO_ID, "recognitionMethod"),
    section: "step_5",
    state: "resolved",
    severity: "red",
    reasonCode: "engine_support_gap",
    reviewFingerprint: "rf-2",
    resolution: {
      kind: "manual_red",
      at: "2027-02-01T00:00:00Z",
      reason: "reviewed_current_treatment",
      note: null,
      reviewFingerprint: "rf-2",
    },
  });

  it("reopens an affirmed yellow item at its base severity", () => {
    const draft = baseDraft();
    const result = reconcileAiEdits({
      previousDraft: draft,
      nextDraft: edit((next) => {
        next.contractBalances.considerationEvents[0]!.invoiceDate = "2027-02-01";
      }),
      currentAiState: aiState(draft, { reviewItems: [resolvedYellow] }),
    });
    const item = result.aiState.reviewItems[0]!;
    expect(item.state).toBe("yellow");
    expect(item.resolution).toBeNull();
    expect(item.affirmedAt).toBeNull();
    expect(result.reviewEvents[0]!.type).toBe("review_item_reopened");
  });

  it("reopens a manually resolved red item as red", () => {
    const draft = baseDraft();
    const result = reconcileAiEdits({
      previousDraft: draft,
      nextDraft: edit((next) => {
        next.performanceObligations[0]!.recognitionMethod = "point_in_time";
      }),
      currentAiState: aiState(draft, { reviewItems: [resolvedRed] }),
    });
    const item = result.aiState.reviewItems[0]!;
    expect(item.state).toBe("red");
    expect(item.severity).toBe("red");
    expect(item.resolution).toBeNull();
    expect(result.reviewEvents).toEqual([
      {
        type: "review_item_reopened",
        reviewItemId: "rev-2",
        targetKey: fieldKeys.po(PO_ID, "recognitionMethod"),
        section: "step_5",
        severity: "red",
        reviewFingerprint: "rf-2",
      } satisfies EditReviewEventIntent,
    ]);
  });

  it("reopens only the items whose own material conclusion changed", () => {
    const draft = baseDraft();
    const result = reconcileAiEdits({
      previousDraft: draft,
      nextDraft: edit((next) => {
        next.performanceObligations[0]!.recognitionMethod = "point_in_time";
      }),
      currentAiState: aiState(draft, { reviewItems: [resolvedYellow, resolvedRed] }),
    });
    expect(result.reviewEvents.map((event) => event.reviewItemId)).toEqual(["rev-2"]);
    expect(result.aiState.reviewItems[0]!.state).toBe("resolved");
  });
});

describe("red issues are never waived by an edit", () => {
  const openRed = reviewItem({
    id: "rev-3",
    state: "red",
    severity: "red",
    reasonCode: "engine_support_gap",
    targetKey: fieldKeys.po(PO_ID, "recognitionMethod"),
    section: "step_5",
    reviewFingerprint: "rf-3",
  });

  it("keeps an open red issue open when its target is edited", () => {
    const draft = baseDraft();
    const result = reconcileAiEdits({
      previousDraft: draft,
      nextDraft: edit((next) => {
        next.performanceObligations[0]!.recognitionMethod = "point_in_time";
      }),
      currentAiState: aiState(draft, { reviewItems: [openRed] }),
    });
    expect(result.aiState.reviewItems[0]!.state).toBe("red");
    expect(result.aiState.reviewItems[0]!.resolution).toBeNull();
    expect(result.reviewEvents).toEqual([]);
  });

  it("clears a missing-required-input red issue only once the input is supplied", () => {
    const empty = createEmptyDraft();
    const missing = reviewItem({
      id: "rev-4",
      state: "red",
      severity: "red",
      reasonCode: "missing_required_input",
      targetKey: fieldKeys.contract("contractNumber"),
      section: "step_1",
      reviewFingerprint: "rf-4",
    });
    const state = { ...createEmptyAiAnalysisState(), reviewItems: [missing] };

    const untouched = reconcileAiEdits({
      previousDraft: empty,
      nextDraft: structuredClone(empty),
      currentAiState: state,
    });
    expect(untouched.aiState.reviewItems[0]!.state).toBe("red");

    const supplied = structuredClone(empty);
    supplied.contract.contractNumber = "CASE-1";
    const cured = reconcileAiEdits({
      previousDraft: empty,
      nextDraft: supplied,
      currentAiState: state,
    });
    expect(cured.aiState.reviewItems).toEqual([]);
    expect(cured.changed).toBe(true);
  });

  it("does not clear a missing-required-input issue on whitespace alone", () => {
    const empty = createEmptyDraft();
    const missing = reviewItem({
      id: "rev-5",
      state: "red",
      severity: "red",
      reasonCode: "missing_required_input",
      targetKey: fieldKeys.contract("contractNumber"),
      section: "step_1",
      reviewFingerprint: "rf-5",
    });
    const supplied = structuredClone(empty);
    supplied.contract.contractNumber = "   ";
    const result = reconcileAiEdits({
      previousDraft: empty,
      nextDraft: supplied,
      currentAiState: { ...createEmptyAiAnalysisState(), reviewItems: [missing] },
    });
    expect(result.aiState.reviewItems[0]!.state).toBe("red");
  });
});

describe("material canonical projections", () => {
  it("has no canonical representation for an advisory topic", () => {
    expect(canonicalReviewTargetFingerprint(baseDraft(), "additionalTopic:principal_agent")).toBe(
      null,
    );
    expect(canonicalReviewTargetFingerprint(baseDraft(), "issue:whatever")).toBe(null);
  });

  const families: Array<[string, string, (draft: WorkflowDraft) => void]> = [
    [
      "billing amount",
      fieldKeys.billing(EVENT_ID, "amountInput"),
      (d) => {
        d.contractBalances.considerationEvents[0]!.amountInput = "1";
      },
    ],
    [
      "billing timing",
      fieldKeys.billing(EVENT_ID, "invoiceDate"),
      (d) => {
        d.contractBalances.considerationEvents[0]!.invoiceDate = "2027-06-01";
      },
    ],
    [
      "projected collection",
      fieldKeys.cash(CASH_ID, "collectionDate"),
      (d) => {
        d.contractBalances.cashCollections[0]!.collectionDate = "2027-04-30";
      },
    ],
    [
      "performance obligation grouping",
      fieldKeys.promise(PROMISE_ID, "performanceObligationId"),
      (d) => {
        d.promises[0]!.performanceObligationId = null;
      },
    ],
    [
      "recognition",
      fieldKeys.po(PO_ID, "recognitionMethod"),
      (d) => {
        d.performanceObligations[0]!.recognitionMethod = "point_in_time";
      },
    ],
    [
      "transaction price",
      fieldKeys.transactionPrice("input"),
      (d) => {
        d.transactionPriceInput = "125000";
      },
    ],
    [
      "variable consideration",
      fieldKeys.transactionPrice("input"),
      (d) => {
        d.hasVariableConsideration = true;
      },
    ],
  ];

  for (const [label, targetKey, mutate] of families) {
    it(`detects a material change in ${label}`, () => {
      const before = canonicalReviewTargetFingerprint(baseDraft(), targetKey);
      const after = canonicalReviewTargetFingerprint(edit(mutate), targetKey);
      expect(before).not.toBeNull();
      expect(after).not.toBe(before);
    });
  }

  it("ignores prose that carries no accounting conclusion", () => {
    const before = canonicalReviewTargetFingerprint(
      baseDraft(),
      fieldKeys.billing(EVENT_ID, "amountInput"),
    );
    const after = canonicalReviewTargetFingerprint(
      edit((d) => {
        d.transactionPriceNotes = "Rewritten memo text.";
      }),
      fieldKeys.billing(EVENT_ID, "amountInput"),
    );
    expect(after).toBe(before);
  });
});

/* ---------------------------------------------------------------------------
 * Task 4 defect 1: object-edit ownership and target-specific review material.
 * ------------------------------------------------------------------------ */

const MOD_ID = "mod-1";
const VC_ID = "vc-1";

function draftWithModification(): WorkflowDraft {
  const base = baseDraft();
  return {
    ...base,
    hasContractModifications: true,
    contractModifications: [{ ...createModificationDraft(1), modificationDate: "2027-06-01" }],
  };
}

function draftWithVc(): WorkflowDraft {
  const base = baseDraft();
  return {
    ...base,
    hasVariableConsideration: true,
    variableConsiderationComponents: [createVcComponentDraft(1, VC_ID)],
  };
}

function objectState(canonicalId: string, semanticKey: string): AiAnalysisState {
  return {
    ...createEmptyAiAnalysisState(),
    lastSuccessfulRunId: RUN,
    objectProvenance: {
      [semanticKey]: {
        state: "ai_generated_untouched",
        semanticKey,
        lastAiRunId: RUN,
        valueFingerprint: "baseline",
        canonicalId,
        userModified: false,
      },
    },
  };
}

describe("review targets react only to their own accounting conclusion", () => {
  const recognitionTarget = fieldKeys.po(PO_ID, "recognitionMethod");

  function withSspChange(): WorkflowDraft {
    const draft = baseDraft();
    draft.performanceObligations[0]!.sspInput = "99000";
    return draft;
  }

  it("does not reopen a resolved recognition review when only SSP changes", () => {
    const resolved = reviewItem({
      id: "rev-rec",
      targetKey: recognitionTarget,
      section: "step_5",
      state: "resolved",
      resolution: { kind: "affirmed", at: NOW, method: "individual", reviewFingerprint: "rfp-1" },
    });
    const result = reconcileAiEdits({
      previousDraft: baseDraft(),
      nextDraft: withSspChange(),
      currentAiState: { ...createEmptyAiAnalysisState(), reviewItems: [resolved] },
    });
    expect(result.aiState.reviewItems[0]!.state).toBe("resolved");
    expect(result.reviewEvents).toEqual([]);
  });

  it("does not resolve an open recognition review when only SSP changes", () => {
    const open = reviewItem({ id: "rev-rec", targetKey: recognitionTarget, section: "step_5" });
    const result = reconcileAiEdits({
      previousDraft: baseDraft(),
      nextDraft: withSspChange(),
      currentAiState: { ...createEmptyAiAnalysisState(), reviewItems: [open] },
    });
    expect(result.aiState.reviewItems[0]!.state).toBe("yellow");
    expect(result.reviewEvents).toEqual([]);
  });

  it("does affirm a recognition review when the service period changes", () => {
    const open = reviewItem({ id: "rev-rec", targetKey: recognitionTarget, section: "step_5" });
    const next = baseDraft();
    next.performanceObligations[0]!.serviceEnd = "2028-06-30";
    const result = reconcileAiEdits({
      previousDraft: baseDraft(),
      nextDraft: next,
      currentAiState: { ...createEmptyAiAnalysisState(), reviewItems: [open] },
    });
    expect(result.reviewEvents.map((event) => event.type)).toEqual(["yellow_affirmed"]);
  });

  it("does not reopen a classification review when SSP changes", () => {
    const before = canonicalReviewTargetFingerprint(
      baseDraft(),
      fieldKeys.po(PO_ID, "classification"),
    );
    const after = canonicalReviewTargetFingerprint(
      withSspChange(),
      fieldKeys.po(PO_ID, "classification"),
    );
    expect(after).toBe(before);
  });

  it("reacts to material-right facts on their own review target", () => {
    const next = baseDraft();
    next.performanceObligations[0]!.benefitAmountInput = "5000";
    const key = fieldKeys.po(PO_ID, "benefitAmountInput");
    expect(canonicalReviewTargetFingerprint(next, key)).not.toBe(
      canonicalReviewTargetFingerprint(baseDraft(), key),
    );
    expect(canonicalReviewTargetFingerprint(next, fieldKeys.po(PO_ID, "sspInput"))).toBe(
      canonicalReviewTargetFingerprint(baseDraft(), fieldKeys.po(PO_ID, "sspInput")),
    );
  });

  it("reacts to the modification treatment conclusion", () => {
    const next = draftWithModification();
    next.contractModifications[0]!.priceReflectsAddedGoodsSsp = true;
    const key = `modification:${MOD_ID}.priceReflectsAddedGoodsSsp`;
    expect(canonicalReviewTargetFingerprint(next, key)).not.toBe(
      canonicalReviewTargetFingerprint(draftWithModification(), key),
    );
  });

  it("reacts to the variable-consideration allocation conclusion", () => {
    const next = draftWithVc();
    next.variableConsiderationComponents[0]!.allocationTreatment = "specific_po";
    const key = `vc:${VC_ID}.allocationTreatment`;
    expect(canonicalReviewTargetFingerprint(next, key)).not.toBe(
      canonicalReviewTargetFingerprint(draftWithVc(), key),
    );
    const estimation = `vc:${VC_ID}.estimationMethod`;
    expect(canonicalReviewTargetFingerprint(next, estimation)).toBe(
      canonicalReviewTargetFingerprint(draftWithVc(), estimation),
    );
  });
});

describe("object edits are detected across the whole material workpaper", () => {
  it("marks an AI-created modification user-modified when a Phase 5C field is completed", () => {
    const next = draftWithModification();
    next.contractModifications[0]!.approvedAndEnforceable = true;
    const result = reconcileAiEdits({
      previousDraft: draftWithModification(),
      nextDraft: next,
      currentAiState: objectState(MOD_ID, "modification:one"),
    });
    expect(result.aiState.objectProvenance["modification:one"]!.userModified).toBe(true);
    expect(result.aiState.objectProvenance["modification:one"]!.state).toBe(
      "ai_generated_user_edited",
    );
  });

  it("covers the modification scope workpaper too", () => {
    const next = draftWithModification();
    next.contractModifications[0]!.removedPoIds = [PO_ID];
    const result = reconcileAiEdits({
      previousDraft: draftWithModification(),
      nextDraft: next,
      currentAiState: objectState(MOD_ID, "modification:one"),
    });
    expect(result.aiState.objectProvenance["modification:one"]!.userModified).toBe(true);
  });

  it("marks an AI-created VC component user-modified on a nested assessment edit", () => {
    const next = draftWithVc();
    next.variableConsiderationComponents[0]!.inception.includedInput = "10000";
    const result = reconcileAiEdits({
      previousDraft: draftWithVc(),
      nextDraft: next,
      currentAiState: objectState(VC_ID, "vc:one"),
    });
    expect(result.aiState.objectProvenance["vc:one"]!.userModified).toBe(true);
  });

  it("marks an AI-created VC component user-modified on an allocation judgment edit", () => {
    const next = draftWithVc();
    next.variableConsiderationComponents[0]!.relatesSpecifically = true;
    const result = reconcileAiEdits({
      previousDraft: draftWithVc(),
      nextDraft: next,
      currentAiState: objectState(VC_ID, "vc:one"),
    });
    expect(result.aiState.objectProvenance["vc:one"]!.userModified).toBe(true);
  });

  it("leaves an untouched object untouched", () => {
    const result = reconcileAiEdits({
      previousDraft: draftWithModification(),
      nextDraft: draftWithModification(),
      currentAiState: objectState(MOD_ID, "modification:one"),
    });
    expect(result.changed).toBe(false);
    expect(result.aiState.objectProvenance["modification:one"]!.userModified).toBe(false);
  });
});

/* ------------------------------------------------- composite merge targets */

const AI_METER_ID = `${VC_ID}-m1`;

function draftWithMeter(): WorkflowDraft {
  const base = draftWithVc();
  const component = base.variableConsiderationComponents[0]!;
  return {
    ...base,
    variableConsiderationComponents: [
      {
        ...component,
        treatment: "usage_as_incurred",
        meters: [
          {
            ...createVcMeterDraft(1, AI_METER_ID),
            name: "API calls",
            rateAmountInput: "0.10",
            rateQuantityInput: "1",
            unit: "call",
          },
          {
            ...createVcMeterDraft(2, `${VC_ID}-m2`),
            name: "Storage",
            rateAmountInput: "5.00",
            rateQuantityInput: "1",
            unit: "GB",
          },
        ],
      },
    ],
  };
}

function meterState(draft: WorkflowDraft): AiAnalysisState {
  const meter = draft.variableConsiderationComponents[0]!.meters[0]!;
  return {
    ...createEmptyAiAnalysisState(),
    lastSuccessfulRunId: RUN,
    fieldProvenance: {
      [fieldKeys.vc(VC_ID, "meter.rateAmountInput")]: {
        state: "ai_generated_untouched",
        semanticKey: "vc:usage",
        lastAiRunId: RUN,
        valueFingerprint: valueFingerprint(meter.rateAmountInput),
      },
    },
  };
}

describe("the composite service-period recognition target", () => {
  const target = fieldKeys.po(PO_ID, "servicePeriod");

  it("does not move when only the standalone selling price changes", () => {
    const next = edit((draft) => {
      draft.performanceObligations[0]!.sspInput = "99000";
    });
    expect(canonicalReviewTargetFingerprint(next, target)).toBe(
      canonicalReviewTargetFingerprint(baseDraft(), target),
    );
  });

  it("moves when the service period changes", () => {
    for (const mutate of [
      (draft: WorkflowDraft) => {
        draft.performanceObligations[0]!.serviceStart = "2027-02-01";
      },
      (draft: WorkflowDraft) => {
        draft.performanceObligations[0]!.serviceEnd = "2028-01-31";
      },
    ]) {
      expect(canonicalReviewTargetFingerprint(edit(mutate), target)).not.toBe(
        canonicalReviewTargetFingerprint(baseDraft(), target),
      );
    }
  });

  it("reopens a resolved service-period review when the service period changes", () => {
    const resolved = reviewItem({
      id: "rev-sp",
      targetKey: target,
      state: "resolved",
      resolution: { kind: "affirmed", at: NOW, method: "individual", reviewFingerprint: "rf-sp" },
      reviewFingerprint: "rf-sp",
    });
    const previous = baseDraft();
    const result = reconcileAiEdits({
      previousDraft: previous,
      nextDraft: edit((draft) => {
        draft.performanceObligations[0]!.serviceEnd = "2028-01-31";
      }),
      currentAiState: { ...aiState(previous), reviewItems: [resolved] },
    });
    expect(result.reviewEvents.map((event) => event.type)).toEqual(["review_item_reopened"]);
  });

  it("clears the red service-period issue only when BOTH dates are supplied", () => {
    const incomplete = edit((draft) => {
      draft.performanceObligations[0]!.serviceStart = "";
      draft.performanceObligations[0]!.serviceEnd = "";
    });
    const red = reviewItem({
      id: "rev-sp-red",
      targetKey: target,
      state: "red",
      severity: "red",
      reasonCode: "missing_required_input",
    });
    const half = structuredClone(incomplete);
    half.performanceObligations[0]!.serviceStart = "2027-01-01";

    const stillRed = reconcileAiEdits({
      previousDraft: incomplete,
      nextDraft: half,
      currentAiState: { ...aiState(incomplete), reviewItems: [red] },
    });
    expect(stillRed.aiState.reviewItems).toHaveLength(1);

    const cured = reconcileAiEdits({
      previousDraft: incomplete,
      nextDraft: baseDraft(),
      currentAiState: { ...aiState(incomplete), reviewItems: [red] },
    });
    expect(cured.aiState.reviewItems).toHaveLength(0);
  });
});

describe("the composite Phase 5C modification target", () => {
  const target = fieldKeys.modification(MOD_ID, "phase5cFacts");

  function reopened(mutate: (draft: WorkflowDraft) => void): string[] {
    const previous = draftWithModification();
    const next = structuredClone(previous);
    mutate(next);
    const resolved = reviewItem({
      id: "rev-5c",
      targetKey: target,
      state: "resolved",
      resolution: { kind: "affirmed", at: NOW, method: "individual", reviewFingerprint: "rf-5c" },
      reviewFingerprint: "rf-5c",
    });
    return reconcileAiEdits({
      previousDraft: previous,
      nextDraft: next,
      currentAiState: { ...createEmptyAiAnalysisState(), reviewItems: [resolved] },
    }).reviewEvents.map((event) => event.type);
  }

  it("reopens on a material gating fact", () => {
    expect(
      reopened((draft) => {
        draft.contractModifications[0]!.approvedAndEnforceable = true;
      }),
    ).toEqual(["review_item_reopened"]);
  });

  it("reopens on a material modified-performance-obligation fact", () => {
    expect(
      reopened((draft) => {
        draft.contractModifications[0]!.modifiedPerformanceObligations = [
          {
            ...createModifiedPoDraft(1, `${MOD_ID}-po-1`),
            remainingGoodsDistinctFromTransferred: true,
            remainingSspInput: "40000",
          },
        ];
      }),
    ).toEqual(["review_item_reopened"]);
  });

  it("does not reopen on a field outside the material workpaper", () => {
    expect(
      reopened((draft) => {
        draft.contractModifications[0]!.seq = 7;
      }),
    ).toEqual([]);
  });

  describe("the modified performance obligation's presentation name", () => {
    function draftWithModifiedPo(): WorkflowDraft {
      const draft = draftWithModification();
      draft.contractModifications[0]!.modifiedPerformanceObligations = [
        {
          ...createModifiedPoDraft(1, `${MOD_ID}-po-1`),
          name: "Hosted platform access",
          remainingGoodsDistinctFromTransferred: true,
          remainingSspInput: "40000",
          recognitionMethod: "ratable",
        },
      ];
      return draft;
    }

    function reconcileFrom(mutate: (draft: WorkflowDraft) => void) {
      const previous = draftWithModifiedPo();
      const next = structuredClone(previous);
      mutate(next);
      const resolved = reviewItem({
        id: "rev-5c-name",
        targetKey: target,
        state: "resolved",
        resolution: {
          kind: "affirmed",
          at: NOW,
          method: "individual",
          reviewFingerprint: "rf-5c-name",
        },
        reviewFingerprint: "rf-5c-name",
      });
      return reconcileAiEdits({
        previousDraft: previous,
        nextDraft: next,
        currentAiState: { ...createEmptyAiAnalysisState(), reviewItems: [resolved] },
      });
    }

    it("does not move the material fingerprint when only the name changes", () => {
      const previous = draftWithModifiedPo();
      const next = structuredClone(previous);
      next.contractModifications[0]!.modifiedPerformanceObligations[0]!.name =
        "Accountant's workpaper label";
      expect(canonicalReviewTargetFingerprint(next, target)).toBe(
        canonicalReviewTargetFingerprint(previous, target),
      );
    });

    it("does not reopen or clear the resolution on a name-only change", () => {
      const result = reconcileFrom((draft) => {
        draft.contractModifications[0]!.modifiedPerformanceObligations[0]!.name =
          "Accountant's workpaper label";
      });
      expect(result.reviewEvents.map((event) => event.type)).toEqual([]);
      const item = result.aiState.reviewItems[0]!;
      expect(item.state).toBe("resolved");
      expect(item.resolution?.reviewFingerprint).toBe("rf-5c-name");
    });

    it("still reopens when a genuinely material nested field changes", () => {
      for (const mutate of [
        (draft: WorkflowDraft) => {
          draft.contractModifications[0]!.modifiedPerformanceObligations[0]!.remainingSspInput =
            "55000";
        },
        (draft: WorkflowDraft) => {
          draft.contractModifications[0]!.modifiedPerformanceObligations[0]!.remainingGoodsDistinctFromTransferred =
            false;
        },
        (draft: WorkflowDraft) => {
          draft.contractModifications[0]!.modifiedPerformanceObligations[0]!.recognitionMethod =
            "point_in_time";
        },
      ]) {
        const result = reconcileFrom(mutate);
        expect(result.reviewEvents.map((event) => event.type)).toEqual(["review_item_reopened"]);
      }
    });
  });
});

describe("nested variable-consideration meter provenance", () => {
  const key = fieldKeys.vc(VC_ID, "meter.rateAmountInput");

  it("marks an edited AI meter field user-edited and keeps its AI baseline", () => {
    const previous = draftWithMeter();
    const state = meterState(previous);
    const next = structuredClone(previous);
    next.variableConsiderationComponents[0]!.meters[0]!.rateAmountInput = "0.20";
    const result = reconcileAiEdits({
      previousDraft: previous,
      nextDraft: next,
      currentAiState: state,
    });
    const after = result.aiState.fieldProvenance[key]!;
    expect(after.state).toBe("ai_generated_user_edited");
    expect(after.valueFingerprint).toBe(state.fieldProvenance[key]!.valueFingerprint);
    expect(after.lastAiRunId).toBe(RUN);
  });

  it("keeps meter ownership sticky when the AI rate is typed back in", () => {
    const previous = draftWithMeter();
    const edited = structuredClone(previous);
    edited.variableConsiderationComponents[0]!.meters[0]!.rateAmountInput = "0.20";
    const first = reconcileAiEdits({
      previousDraft: previous,
      nextDraft: edited,
      currentAiState: meterState(previous),
    });
    const second = reconcileAiEdits({
      previousDraft: edited,
      nextDraft: draftWithMeter(),
      currentAiState: first.aiState,
    });
    expect(second.aiState.fieldProvenance[key]!.state).toBe("ai_generated_user_edited");
  });

  it("never claims the AI meter key from a different meter or property", () => {
    const previous = draftWithMeter();
    const next = structuredClone(previous);
    next.variableConsiderationComponents[0]!.meters[1]!.rateAmountInput = "9.00";
    next.variableConsiderationComponents[0]!.meters[0]!.unit = "requests";
    const result = reconcileAiEdits({
      previousDraft: previous,
      nextDraft: next,
      currentAiState: meterState(previous),
    });
    expect(result.aiState.fieldProvenance[key]!.state).toBe("ai_generated_untouched");
  });

  it("gives a meter review target the usage conclusion rather than nothing", () => {
    const previous = draftWithMeter();
    const next = structuredClone(previous);
    next.variableConsiderationComponents[0]!.meters[0]!.rateAmountInput = "0.20";
    expect(canonicalReviewTargetFingerprint(previous, key)).not.toBeNull();
    expect(canonicalReviewTargetFingerprint(next, key)).not.toBe(
      canonicalReviewTargetFingerprint(previous, key),
    );
  });
});

describe("whole-performance-obligation grouping membership", () => {
  const wholePo = `po:${PO_ID}`;

  it("reacts to a promise leaving or joining the performance obligation", () => {
    const removed = edit((draft) => {
      draft.promises[0]!.performanceObligationId = "";
    });
    expect(canonicalReviewTargetFingerprint(removed, wholePo)).not.toBe(
      canonicalReviewTargetFingerprint(baseDraft(), wholePo),
    );
    const added = edit((draft) => {
      draft.promises.push({
        ...createPromiseDraft(2, "pr-support"),
        description: "Support",
        performanceObligationId: PO_ID,
      });
    });
    expect(canonicalReviewTargetFingerprint(added, wholePo)).not.toBe(
      canonicalReviewTargetFingerprint(baseDraft(), wholePo),
    );
  });

  it("ignores a pure reorder of promises", () => {
    const previous = edit((draft) => {
      draft.promises.push({
        ...createPromiseDraft(2, "pr-support"),
        description: "Support",
        performanceObligationId: PO_ID,
      });
    });
    const reordered = structuredClone(previous);
    reordered.promises.reverse();
    expect(canonicalReviewTargetFingerprint(reordered, wholePo)).toBe(
      canonicalReviewTargetFingerprint(previous, wholePo),
    );
  });

  it("keeps membership out of the recognition- and ssp-specific groups", () => {
    const moved = edit((draft) => {
      draft.promises[0]!.performanceObligationId = "";
    });
    for (const field of ["recognitionMethod", "sspInput"]) {
      const key = fieldKeys.po(PO_ID, field);
      expect(canonicalReviewTargetFingerprint(moved, key)).toBe(
        canonicalReviewTargetFingerprint(baseDraft(), key),
      );
    }
  });

  it("marks an AI-owned performance obligation user-modified when membership changes", () => {
    const result = reconcileAiEdits({
      previousDraft: baseDraft(),
      nextDraft: edit((draft) => {
        draft.promises[0]!.performanceObligationId = "";
      }),
      currentAiState: objectState(PO_ID, "po:saas"),
    });
    expect(result.aiState.objectProvenance["po:saas"]!.userModified).toBe(true);
  });
});

describe("the object:<id> retained-object review target", () => {
  const target = `object:${PO_ID}`;

  it("resolves an open yellow when the retained object is materially edited", () => {
    const previous = baseDraft();
    const open = reviewItem({ id: "rev-obj", targetKey: target, reviewFingerprint: "rf-obj" });
    const result = reconcileAiEdits({
      previousDraft: previous,
      nextDraft: edit((draft) => {
        draft.performanceObligations[0]!.recognitionRationale = "Ratable over the term.";
      }),
      currentAiState: { ...aiState(previous), reviewItems: [open] },
    });
    expect(result.reviewEvents.map((event) => event.type)).toEqual(["yellow_affirmed"]);
    const stamped = applyEditReviewIntents(result.aiState, result.reviewEvents, NOW);
    const resolution = stamped.reviewItems[0]!.resolution;
    expect(resolution?.kind).toBe("affirmed");
    expect(resolution?.kind === "affirmed" ? resolution.method : null).toBe("edited");
  });

  it("reopens a resolved retained-object review on a later material edit", () => {
    const previous = baseDraft();
    const resolved = reviewItem({
      id: "rev-obj",
      targetKey: target,
      state: "resolved",
      resolution: { kind: "affirmed", at: NOW, method: "individual", reviewFingerprint: "rf-obj" },
      reviewFingerprint: "rf-obj",
    });
    const result = reconcileAiEdits({
      previousDraft: previous,
      nextDraft: edit((draft) => {
        draft.performanceObligations[0]!.sspInput = "99000";
      }),
      currentAiState: { ...aiState(previous), reviewItems: [resolved] },
    });
    expect(result.reviewEvents.map((event) => event.type)).toEqual(["review_item_reopened"]);
  });

  it("leaves tombstoned and unbound relationship targets unrepresentable", () => {
    for (const key of ["tombstone:promise:gone", "recognition:po:saas", "ssp:po:saas"]) {
      expect(canonicalReviewTargetFingerprint(baseDraft(), key)).toBeNull();
    }
    expect(canonicalReviewTargetFingerprint(baseDraft(), `object:${PO_ID}-missing`)).toBeNull();
  });
});

describe("transaction-price review targets", () => {
  const NOTES = fieldKeys.transactionPrice("notes");
  const ADVISORY = [
    fieldKeys.transactionPrice("financing"),
    fieldKeys.transactionPrice("noncash"),
    fieldKeys.transactionPrice("payableToCustomer"),
  ];

  it("fingerprints the notes target against the canonical notes field", () => {
    const previous = baseDraft();
    const before = canonicalReviewTargetFingerprint(previous, NOTES);
    const after = canonicalReviewTargetFingerprint(
      edit((draft) => {
        draft.transactionPriceNotes = "Fixed fee of 120,000 with no variability.";
      }),
      NOTES,
    );
    expect(before).not.toBeNull();
    expect(after).not.toBe(before);
  });

  it("does not move the notes fingerprint when only the input or a VC component changes", () => {
    const previous = baseDraft();
    const before = canonicalReviewTargetFingerprint(previous, NOTES);
    expect(
      canonicalReviewTargetFingerprint(
        edit((draft) => {
          draft.transactionPriceInput = "130000";
        }),
        NOTES,
      ),
    ).toBe(before);
    expect(
      canonicalReviewTargetFingerprint(
        edit((draft) => {
          draft.hasVariableConsideration = true;
          draft.variableConsiderationComponents = [
            createVcComponentDraft(1, "vc-usage", "usage_as_incurred"),
          ];
        }),
        NOTES,
      ),
    ).toBe(before);
  });

  it("resolves an open notes yellow with method edited", () => {
    const previous = baseDraft();
    const open = reviewItem({
      id: "rev-notes",
      targetKey: NOTES,
      section: "step_3",
      reviewFingerprint: "rf-notes",
    });
    const result = reconcileAiEdits({
      previousDraft: previous,
      nextDraft: edit((draft) => {
        draft.transactionPriceNotes = "Manual conclusion.";
      }),
      currentAiState: { ...aiState(previous), reviewItems: [open] },
    });
    expect(result.reviewEvents.map((event) => event.type)).toEqual(["yellow_affirmed"]);
    const stamped = applyEditReviewIntents(result.aiState, result.reviewEvents, NOW);
    const resolution = stamped.reviewItems[0]!.resolution;
    expect(resolution?.kind === "affirmed" ? resolution.method : null).toBe("edited");
  });

  it("reopens a resolved notes item on a later notes edit", () => {
    const previous = baseDraft();
    const resolved = reviewItem({
      id: "rev-notes",
      targetKey: NOTES,
      section: "step_3",
      state: "resolved",
      resolution: { kind: "affirmed", at: NOW, method: "individual", reviewFingerprint: "rf-n" },
      reviewFingerprint: "rf-n",
    });
    const result = reconcileAiEdits({
      previousDraft: previous,
      nextDraft: edit((draft) => {
        draft.transactionPriceNotes = "Revisited.";
      }),
      currentAiState: { ...aiState(previous), reviewItems: [resolved] },
    });
    expect(result.reviewEvents.map((event) => event.type)).toEqual(["review_item_reopened"]);
  });

  it("leaves a notes review untouched when only the input or a VC component changes", () => {
    const previous = baseDraft();
    for (const mutate of [
      (draft: WorkflowDraft) => {
        draft.transactionPriceInput = "130000";
      },
      (draft: WorkflowDraft) => {
        draft.hasVariableConsideration = true;
        draft.variableConsiderationComponents = [
          createVcComponentDraft(1, "vc-usage", "usage_as_incurred"),
        ];
      },
    ]) {
      const result = reconcileAiEdits({
        previousDraft: previous,
        nextDraft: edit(mutate),
        currentAiState: {
          ...aiState(previous),
          reviewItems: [
            reviewItem({ id: "rev-notes", targetKey: NOTES, reviewFingerprint: "rf-notes" }),
          ],
        },
      });
      expect(result.reviewEvents).toEqual([]);
      expect(result.aiState.reviewItems[0]!.state).toBe("yellow");
    }
  });

  it("treats the advisory transaction-price topics as unrepresentable", () => {
    const draft = baseDraft();
    for (const key of ADVISORY) {
      expect(canonicalReviewTargetFingerprint(draft, key)).toBeNull();
    }
    expect(
      canonicalReviewTargetFingerprint(draft, fieldKeys.transactionPrice("futureAdvisoryThing")),
    ).toBeNull();
  });

  it("never resolves or reopens an advisory topic from unrelated canonical edits", () => {
    const previous = baseDraft();
    for (const key of ADVISORY) {
      for (const mutate of [
        (draft: WorkflowDraft) => {
          draft.transactionPriceInput = "130000";
        },
        (draft: WorkflowDraft) => {
          draft.hasVariableConsideration = true;
          draft.variableConsiderationComponents = [
            createVcComponentDraft(1, "vc-usage", "usage_as_incurred"),
          ];
        },
      ]) {
        const open = reviewItem({ id: "rev-adv", targetKey: key, reviewFingerprint: "rf-adv" });
        const resolved = reviewItem({
          id: "rev-adv2",
          targetKey: key,
          state: "resolved",
          resolution: {
            kind: "affirmed",
            at: NOW,
            method: "individual",
            reviewFingerprint: "rf-adv2",
          },
          reviewFingerprint: "rf-adv2",
        });
        const result = reconcileAiEdits({
          previousDraft: previous,
          nextDraft: edit(mutate),
          currentAiState: { ...aiState(previous), reviewItems: [open, resolved] },
        });
        expect(result.reviewEvents).toEqual([]);
        expect(result.aiState.reviewItems[0]!.state).toBe("yellow");
        expect(result.aiState.reviewItems[1]!.state).toBe("resolved");
      }
    }
  });
});
