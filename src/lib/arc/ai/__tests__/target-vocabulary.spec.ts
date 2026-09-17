/**
 * Phase 9G — Task 4. The merge-emitted target vocabulary.
 *
 * Hand-written Task 4 target strings are not enough. This table locks the
 * canonical target shapes the production merge engine actually raises, and
 * proves each one is DELIBERATELY classified — never silently falling through
 * to an undefined property read on a canonical row.
 */
import { describe, expect, it } from "vitest";

import {
  createModificationDraft,
  createPoDraft,
  createPromiseDraft,
  createVcComponentDraft,
  createVcMeterDraft,
  createEmptyDraft,
  createConsiderationEventDraft,
  createCashCollectionDraft,
  type WorkflowDraft,
} from "@/lib/asc606-workflow";

import {
  canonicalReviewTargetFingerprint,
  classifyReviewTarget,
  type TargetClassification,
} from "../edit-reconciliation";
import { fieldKeys } from "../identity";

const PROMISE_ID = "pr-saas";
const PO_ID = "po-saas";
const VC_ID = "vc-usage";
const MOD_ID = "mod-1";
const EVENT_ID = "ce-annual";
const CASH_ID = "cc-annual";

function draft(): WorkflowDraft {
  const empty = createEmptyDraft();
  return {
    ...empty,
    hasVariableConsideration: true,
    hasContractModifications: true,
    transactionPriceInput: "120000",
    promises: [{ ...createPromiseDraft(1, PROMISE_ID), performanceObligationId: PO_ID }],
    performanceObligations: [
      {
        ...createPoDraft(1, PO_ID),
        recognitionMethod: "over_time_ratable",
        serviceStart: "2027-01-01",
        serviceEnd: "2027-12-31",
        sspInput: "120000",
      },
    ],
    variableConsiderationComponents: [
      {
        ...createVcComponentDraft(1, VC_ID, "usage_as_incurred"),
        meters: [{ ...createVcMeterDraft(1, `${VC_ID}-m1`), rateAmountInput: "0.10" }],
      },
    ],
    contractModifications: [createModificationDraft(1)],
    contractBalances: {
      considerationEvents: [createConsiderationEventDraft(1, EVENT_ID)],
      cashCollections: [createCashCollectionDraft(1, CASH_ID)],
    },
  };
}

const VOCABULARY: ReadonlyArray<readonly [string, TargetClassification]> = [
  [fieldKeys.contract("customerName"), "exact_scalar"],
  [fieldKeys.criterion("collectibility_probable"), "exact_scalar"],
  [fieldKeys.criterionRationale("collectibility_probable"), "exact_scalar"],

  [fieldKeys.promise(PROMISE_ID, "description"), "material_group"],
  [fieldKeys.promise(PROMISE_ID, "performanceObligationId"), "material_group"],
  [fieldKeys.po(PO_ID, "classification"), "material_group"],
  [fieldKeys.po(PO_ID, "recognitionMethod"), "material_group"],
  [fieldKeys.po(PO_ID, "recognitionDate"), "material_group"],
  [fieldKeys.po(PO_ID, "sspInput"), "material_group"],
  [fieldKeys.po(PO_ID, "servicePeriod"), "composite"],
  [`po:${PO_ID}`, "composite"],

  [fieldKeys.transactionPrice("input"), "composite"],
  [fieldKeys.transactionPrice("notes"), "exact_scalar"],
  // Advisory only: the merge engine states outright that ARC has no canonical
  // field for these, so no accounting edit can stand in for reviewing them.
  [fieldKeys.transactionPrice("financing"), "unrepresentable"],
  [fieldKeys.transactionPrice("noncash"), "unrepresentable"],
  [fieldKeys.transactionPrice("payableToCustomer"), "unrepresentable"],
  // Future schema expansion must not inherit accidental Task 4 semantics.
  [fieldKeys.transactionPrice("futureAdvisoryThing"), "unrepresentable"],

  [fieldKeys.vc(VC_ID, "treatment"), "material_group"],
  [fieldKeys.vc(VC_ID, "inception"), "material_group"],
  [fieldKeys.vc(VC_ID, "usagePeriods"), "material_group"],
  [fieldKeys.vc(VC_ID, "meter.rateAmountInput"), "composite"],
  [fieldKeys.vc(VC_ID, "meter.unit"), "composite"],

  [fieldKeys.modification(MOD_ID, "phase5cFacts"), "composite"],
  [fieldKeys.modification(MOD_ID, "approvedAndEnforceable"), "material_group"],

  [fieldKeys.structural("hasContractModifications"), "exact_scalar"],

  [fieldKeys.billing(EVENT_ID, "invoiceDate"), "material_group"],
  [fieldKeys.cash(CASH_ID, "collectionDate"), "material_group"],

  [`object:${PO_ID}`, "composite"],

  // Deliberately unrepresentable: no authoritative canonical object to bind to.
  [`tombstone:promise:gone`, "unrepresentable"],
  [`recognition:po:saas`, "unrepresentable"],
  [`ssp:po:saas`, "unrepresentable"],
  [fieldKeys.topic("principal_agent"), "unrepresentable"],
  [fieldKeys.issue("some-issue"), "unrepresentable"],
];

describe("every merge-emitted target key is deliberately classified", () => {
  const workpaper = draft();

  for (const [key, classification] of VOCABULARY) {
    it(`classifies ${key} as ${classification}`, () => {
      expect(classifyReviewTarget(workpaper, key)).toBe(classification);
      const fingerprint = canonicalReviewTargetFingerprint(workpaper, key);
      if (classification === "unrepresentable") {
        expect(fingerprint).toBeNull();
      } else {
        expect(fingerprint).not.toBeNull();
      }
    });
  }
});
