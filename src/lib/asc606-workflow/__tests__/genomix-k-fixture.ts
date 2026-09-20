/**
 * Phase 9G-R3 accounting-authority fixture, expressed as a REAL WorkflowDraft.
 *
 * Every fact below is entered the way an accountant enters it in the app, so
 * the acceptance tests travel the same path the product does. The facts are
 * the accepted synthetic Genomix benchmark (see
 * src/lib/asc606-progressive/__tests__/genomix-r3.ts), expressed in canonical
 * draft form rather than as a direct engine input. All companies, customers
 * and amounts are fictional demonstration data.
 *
 * Genomix Bio / Helix Analytics — fixed $490,000:
 *   Hosted SaaS         $446,000  over time, time based, 11/1/2026 - 10/31/2028
 *   Validation services  $29,600  point in time, NOT yet transferred
 *   Support hours        $14,400  over time, input measure (300 hours)
 *   Tier 2 usage overages          contractual meter rule known, no usage yet
 *   Service-level credit      $0  specific service period, no trigger yet
 *   Billing: two $245,000 annual instalments (11/1/2026 and 11/1/2027)
 */

import {
  createEmptyDraft,
  createPoDraft,
  createPromiseDraft,
  createVcComponentDraft,
  type PoDraft,
  type VcComponentDraft,
  type VcSeriesPeriodDraft,
  type WorkflowDraft,
} from "../types";
import { answerAllStep1 } from "./fixtures";

export const GENOMIX_FIXED_CENTS = 49_000_000;
export const GENOMIX_HOSTED_CENTS = 44_600_000;
export const GENOMIX_VALIDATION_CENTS = 2_960_000;
export const GENOMIX_SUPPORT_CENTS = 1_440_000;

export const GENOMIX_SERVICE_START = "2026-11-01";
export const GENOMIX_SERVICE_END = "2028-10-31";
export const GENOMIX_SUPPORT_UNITS = 300;

/** Contractual distinct service periods of the hosted series. */
export const GENOMIX_SERIES_PERIODS: VcSeriesPeriodDraft[] = [
  {
    id: "y1",
    seq: 1,
    label: "Year 1 service period",
    startDate: "2026-11-01",
    endDate: "2027-10-31",
  },
  {
    id: "y2",
    seq: 2,
    label: "Year 2 service period",
    startDate: "2027-11-01",
    endDate: "2028-10-31",
  },
];

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
    serviceStart: GENOMIX_SERVICE_START,
    serviceEnd: GENOMIX_SERVICE_END,
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
    totalExpectedUnitsInput: String(GENOMIX_SUPPORT_UNITS),
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
    description: "Monthly SLA availability credits",
    effect: "decrease",
    estimationMethod: "most_likely_amount",
    allocationTreatment: "specific_series_period",
    targetPoId: "po-hosted",
    relatesSpecifically: true,
    consistentWithAllocationObjective: true,
    allocationRationale:
      "A credit relates specifically to the service period whose service level was missed, so allocating it to that distinct service period meets the allocation objective.",
    inception: {
      ...base.inception,
      effectiveDate: GENOMIX_SERVICE_START,
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
    seriesPeriods: GENOMIX_SERIES_PERIODS.map((period) => ({ ...period })),
    realizedEvents: [],
    billOnRealization: true,
  };
}

/**
 * Tier 2 usage overages. The contractual rule is known at inception; no usage
 * actual exists and none is fabricated.
 */
function usageComponent(): VcComponentDraft {
  const base = createVcComponentDraft(2, "vc-usage", "usage_as_incurred");
  return {
    ...base,
    description: "Tier 2 usage overages",
    effect: "increase",
    allocationTreatment: "specific_series_period",
    targetPoId: "po-hosted",
    relatesSpecifically: true,
    consistentWithAllocationObjective: true,
    allocationRationale:
      "Each overage relates specifically to the service period in which the usage occurred.",
    meters: [
      {
        id: "m-samples",
        seq: 1,
        name: "Tier 2 samples",
        rateAmountInput: "12.00",
        rateQuantityInput: "1",
        unit: "samples",
        // The contract establishes the tier threshold: every Tier 2 sample is
        // chargeable, so the included quantity is a known zero, not a blank.
        includedQuantityInput: "0",
      },
    ],
    usagePeriods: [],
    seriesPeriods: GENOMIX_SERIES_PERIODS.map((period) => ({ ...period })),
    billOnRealization: true,
  };
}

export function genomixBenchmarkDraft(): WorkflowDraft {
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
    variableConsiderationComponents: [slaComponent(), usageComponent()],
    contractBalances: {
      ...base.contractBalances,
      considerationEvents: [
        {
          id: "bill-y1",
          seq: 1,
          amountInput: "245,000.00",
          unconditionalRightDate: "2026-11-01",
          invoiceDate: "2026-11-01",
        },
        {
          id: "bill-y2",
          seq: 2,
          amountInput: "245,000.00",
          unconditionalRightDate: "2027-11-01",
          invoiceDate: "2027-11-01",
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

/** Mutation 3: real Tier 2 usage is measured in one accounting month. */
export function withUsageActual(
  draft: WorkflowDraft,
  month: string,
  quantityInput: string,
): WorkflowDraft {
  return {
    ...draft,
    variableConsiderationComponents: draft.variableConsiderationComponents.map((component) =>
      component.id === "vc-usage"
        ? {
            ...component,
            usagePeriods: [
              {
                id: `vc-usage-p-${month}`,
                month,
                quantities: { "m-samples": quantityInput },
              },
            ],
          }
        : component,
    ),
  };
}

/** Mutation 4: a service-level credit is actually realized in one period. */
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

/**
 * The complete R3 operational fact set that belongs to the accountant. Every
 * field named in the closure patch is compared, not a sample of them.
 */
export function r3OperationalFacts(draft: WorkflowDraft) {
  const po = (id: string) => draft.performanceObligations.find((row) => row.id === id)!;
  const vc = (id: string) => draft.variableConsiderationComponents.find((row) => row.id === id)!;
  const support = po("po-support");
  const validation = po("po-validation");
  const sla = vc("vc-sla");
  const usage = vc("vc-usage");
  return {
    support: {
      transferStatus: support.transferStatus,
      recognitionDate: support.recognitionDate,
      overTimeMeasure: support.overTimeMeasure,
      totalExpectedUnitsInput: support.totalExpectedUnitsInput,
      unitLabel: support.unitLabel,
      progressEvents: support.progressEvents,
    },
    validation: {
      transferStatus: validation.transferStatus,
      recognitionDate: validation.recognitionDate,
    },
    sla: {
      allocationTreatment: sla.allocationTreatment,
      targetPoId: sla.targetPoId,
      inception: sla.inception,
      remeasurements: sla.remeasurements,
      hasResolution: sla.hasResolution,
      resolutionDate: sla.resolutionDate,
      resolutionAmountInput: sla.resolutionAmountInput,
      seriesPeriods: sla.seriesPeriods,
      realizedEvents: sla.realizedEvents,
      billOnRealization: sla.billOnRealization,
    },
    usage: {
      allocationTreatment: usage.allocationTreatment,
      targetPoId: usage.targetPoId,
      meters: usage.meters,
      usagePeriods: usage.usagePeriods,
      seriesPeriods: usage.seriesPeriods,
      billOnRealization: usage.billOnRealization,
    },
    billing: {
      considerationEvents: draft.contractBalances.considerationEvents,
      cashCollections: draft.contractBalances.cashCollections,
    },
  };
}
