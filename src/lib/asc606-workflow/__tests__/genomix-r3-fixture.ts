/**
 * Phase 9G-R3 accounting-authority fixture, expressed as a REAL WorkflowDraft.
 *
 * Every fact below is entered the way an accountant enters it in the app, so
 * the acceptance tests travel the same path the product does. All companies,
 * customers and amounts are fictional demonstration data.
 *
 * The full accepted Genomix benchmark — the one the K acceptance suite uses —
 * lives in ./genomix-k-fixture.ts. This fixture stays the narrower engine
 * fixture the accepted B/D/E/F/J authority suites were written against.
 *
 * Genomix Bio / Helix Analytics — fixed $490,000:
 *   Hosted SaaS         $446,000  over time, time based
 *   Validation services  $29,600  point in time, NOT yet transferred
 *   Support hours        $14,400  over time, input measure (200 hours)
 *   Service-level credit      $0  specific service period, no trigger yet
 *   Billing: two $245,000 instalments
 */

import {
  createEmptyDraft,
  createPoDraft,
  createPromiseDraft,
  createVcComponentDraft,
  type PoDraft,
  type VcComponentDraft,
  type WorkflowDraft,
} from "../types";
import { answerAllStep1 } from "./fixtures";

export const GENOMIX_FIXED_CENTS = 49_000_000;
export const GENOMIX_HOSTED_CENTS = 44_600_000;
export const GENOMIX_VALIDATION_CENTS = 2_960_000;
export const GENOMIX_SUPPORT_CENTS = 1_440_000;

function hostedPo(): PoDraft {
  return {
    ...createPoDraft(1, "po-hosted"),
    name: "Hosted SaaS platform",
    classification: "series",
    classificationRationale: "A series of distinct daily services with the same transfer pattern.",
    sspInput: "446,000.00",
    sspBasis: "Provisional: no observable standalone price; expected cost plus a margin.",
    recognitionMethod: "over_time_ratable",
    overTimeMeasure: "time_based",
    serviceStart: "2027-01-01",
    serviceEnd: "2027-12-31",
    recognitionRationale: "The customer simultaneously receives and consumes the hosted service.",
  };
}

function validationPo(): PoDraft {
  return {
    ...createPoDraft(2, "po-validation"),
    name: "Validation services",
    classification: "single_distinct",
    classificationRationale: "A distinct validation service the customer can benefit from alone.",
    sspInput: "29,600.00",
    sspBasis: "Provisional: expected cost plus a margin.",
    recognitionMethod: "point_in_time",
    transferStatus: "not_yet_transferred",
    recognitionRationale: "Control transfers on customer acceptance of the validation report.",
  };
}

function supportPo(): PoDraft {
  return {
    ...createPoDraft(3, "po-support"),
    name: "Support hours",
    classification: "single_distinct",
    classificationRationale: "A distinct block of contracted support effort.",
    sspInput: "14,400.00",
    sspBasis: "Provisional: contracted hourly rate card.",
    recognitionMethod: "over_time_ratable",
    overTimeMeasure: "input_measure",
    totalExpectedUnitsInput: "200",
    unitLabel: "hours",
    progressEvents: [],
    recognitionRationale:
      "Progress is measured by support hours incurred against the contracted block.",
  };
}

/** The $0 no-trigger service-level credit, targeted at a service period. */
function slaComponent(): VcComponentDraft {
  const base = createVcComponentDraft(1, "vc-sla", "estimated");
  return {
    ...base,
    description: "Service-level credit",
    effect: "decrease",
    estimationMethod: "most_likely_amount",
    allocationTreatment: "specific_series_period",
    targetPoId: "po-hosted",
    relatesSpecifically: true,
    consistentWithAllocationObjective: true,
    allocationRationale:
      "A credit relates specifically to the quarter whose service level was missed, so allocating it to that distinct service period meets the allocation objective.",
    inception: {
      ...base.inception,
      effectiveDate: "2027-01-01",
      includedInput: "0.00",
      constraintRationale:
        "No service level has been missed and none is expected, so the most likely amount of credit at inception is nil.",
      outcomes: [
        {
          id: "vc-sla-o1",
          seq: 1,
          description: "No service-level failure",
          amountInput: "0.00",
          probabilityInput: "100",
          isMostLikely: true,
        },
      ],
    },
    seriesPeriods: [
      { id: "q1", seq: 1, label: "Q1 2027", startDate: "2027-01-01", endDate: "2027-03-31" },
      { id: "q2", seq: 2, label: "Q2 2027", startDate: "2027-04-01", endDate: "2027-06-30" },
      { id: "q3", seq: 3, label: "Q3 2027", startDate: "2027-07-01", endDate: "2027-09-30" },
      { id: "q4", seq: 4, label: "Q4 2027", startDate: "2027-10-01", endDate: "2027-12-31" },
    ],
    realizedEvents: [],
    billOnRealization: true,
  };
}

export function genomixR3Draft(): WorkflowDraft {
  const base = answerAllStep1(createEmptyDraft());
  const pos = [hostedPo(), validationPo(), supportPo()];
  const promises = pos.map((po, index) => ({
    ...createPromiseDraft(index + 1, `pr-${po.id}`),
    description: po.name,
    capableOfBeingDistinct: true,
    distinctWithinContractContext: true,
    distinctRationale: "The customer can benefit from the promise on its own.",
    performanceObligationId: po.id,
  }));

  return {
    ...base,
    contract: {
      ...base.contract,
      customerName: "Helix Analytics",
      contractNumber: "GENOMIX-R3",
    },
    transactionPriceInput: "490,000.00",
    promises,
    performanceObligations: pos,
    hasVariableConsideration: true,
    variableConsiderationComponents: [slaComponent()],
    contractBalances: {
      ...base.contractBalances,
      considerationEvents: [
        {
          id: "bill-1",
          seq: 1,
          amountInput: "245,000.00",
          unconditionalRightDate: "2027-01-01",
          invoiceDate: "2027-01-01",
        },
        {
          id: "bill-2",
          seq: 2,
          amountInput: "245,000.00",
          unconditionalRightDate: "2027-07-01",
          invoiceDate: "2027-07-01",
        },
      ],
      cashCollections: [],
    },
  };
}

/** Mutation 1: the validation service actually transfers. */
export function withValidationTransfer(draft: WorkflowDraft, date: string): WorkflowDraft {
  return {
    ...draft,
    performanceObligations: draft.performanceObligations.map((po) =>
      po.id === "po-validation"
        ? { ...po, transferStatus: "transferred" as const, recognitionDate: date }
        : po,
    ),
  };
}

/** Mutation 2: support hours are incurred. */
export function withSupportHours(
  draft: WorkflowDraft,
  events: { id: string; seq: number; date: string; unitsInput: string }[],
): WorkflowDraft {
  return {
    ...draft,
    performanceObligations: draft.performanceObligations.map((po) =>
      po.id === "po-support" ? { ...po, progressEvents: events } : po,
    ),
  };
}

/** Mutation 3: a service-level credit is actually realized in one quarter. */
export function withRealizedCredit(
  draft: WorkflowDraft,
  amountInput: string,
  seriesPeriodId: string,
  date: string,
): WorkflowDraft {
  return {
    ...draft,
    variableConsiderationComponents: draft.variableConsiderationComponents.map((component) =>
      component.id === "vc-sla"
        ? {
            ...component,
            realizedEvents: [
              {
                id: `${component.id}:${seriesPeriodId}`,
                seq: 1,
                date,
                amountInput,
                seriesPeriodId,
                description: "Service-level credit issued",
              },
            ],
          }
        : component,
    ),
  };
}
