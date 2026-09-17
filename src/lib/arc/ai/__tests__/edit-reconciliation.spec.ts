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
  createPromiseDraft,
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
    ["billing amount", fieldKeys.billing(EVENT_ID, "amountInput"), (d) => {
      d.contractBalances.considerationEvents[0]!.amountInput = "1";
    }],
    ["billing timing", fieldKeys.billing(EVENT_ID, "invoiceDate"), (d) => {
      d.contractBalances.considerationEvents[0]!.invoiceDate = "2027-06-01";
    }],
    ["projected collection", fieldKeys.cash(CASH_ID, "collectionDate"), (d) => {
      d.contractBalances.cashCollections[0]!.collectionDate = "2027-04-30";
    }],
    ["performance obligation grouping", fieldKeys.promise(PROMISE_ID, "performanceObligationId"),
      (d) => {
        d.promises[0]!.performanceObligationId = null;
      }],
    ["recognition", fieldKeys.po(PO_ID, "recognitionMethod"), (d) => {
      d.performanceObligations[0]!.recognitionMethod = "point_in_time";
    }],
    ["transaction price", fieldKeys.transactionPrice("input"), (d) => {
      d.transactionPriceInput = "125000";
    }],
    ["variable consideration", fieldKeys.transactionPrice("input"), (d) => {
      d.hasVariableConsideration = true;
    }],
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
