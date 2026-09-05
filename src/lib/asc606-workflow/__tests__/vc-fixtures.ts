/**
 * Phase 5B workflow fixtures. All companies, customers and amounts are
 * fictional demonstration data.
 */

import {
  createPoDraft,
  createPromiseDraft,
  createVcComponentDraft,
  createVcMeterDraft,
  createEmptyDraft,
  type VcComponentDraft,
  type WorkflowDraft,
} from "../types";
import { answerAllStep1 } from "./fixtures";

/** Case 7 — AtlasData / TitanEnergy: fixed $460,000 plus a $30,000 bonus. */
export function case7Draft(): WorkflowDraft {
  const base = answerAllStep1(createEmptyDraft());
  const implementation = {
    ...createPoDraft(1, "po-implementation"),
    name: "Implementation services",
    classification: "single_distinct" as const,
    classificationRationale: "Distinct implementation service.",
    sspInput: "60,000.00",
    sspBasis: "Observable standalone implementation pricing.",
    recognitionMethod: "point_in_time" as const,
    recognitionDate: "2027-03-20",
    recognitionRationale: "Control transfers on go-live acceptance.",
  };
  const saas = {
    ...createPoDraft(2, "po-saas"),
    name: "SaaS subscription",
    classification: "single_distinct" as const,
    classificationRationale: "Distinct hosted service.",
    sspInput: "440,000.00",
    sspBasis: "Observable standalone renewal pricing.",
    recognitionMethod: "over_time_ratable" as const,
    serviceStart: "2027-04-01",
    serviceEnd: "2029-03-31",
    recognitionRationale: "Customer simultaneously receives and consumes the hosted service.",
  };
  const promises = [
    {
      ...createPromiseDraft(1, "pr-implementation"),
      description: "Implementation and configuration",
      capableOfBeingDistinct: true,
      distinctWithinContractContext: true,
      distinctRationale: "Separately saleable implementation service.",
      performanceObligationId: implementation.id,
    },
    {
      ...createPromiseDraft(2, "pr-saas"),
      description: "Two-year hosted SaaS access",
      capableOfBeingDistinct: true,
      distinctWithinContractContext: true,
      distinctRationale: "Benefit available on its own.",
      performanceObligationId: saas.id,
    },
  ];

  const bonusBase = createVcComponentDraft(1, "vc-bonus", "estimated");
  const bonus: VcComponentDraft = {
    ...bonusBase,
    description: "Implementation go-live bonus",
    effect: "increase",
    estimationMethod: "most_likely_amount",
    allocationTreatment: "specific_po",
    targetPoId: implementation.id,
    relatesSpecifically: true,
    consistentWithAllocationObjective: true,
    allocationRationale:
      "The bonus relates specifically to the implementation effort and allocating it entirely to that obligation meets the allocation objective.",
    inception: {
      ...bonusBase.inception,
      effectiveDate: "2027-01-01",
      includedInput: "30,000.00",
      constraintRationale:
        "A significant revenue reversal is not probable; the go-live date is within the entity's control and historically achieved.",
      outcomes: [
        {
          id: "vc-bonus-o1",
          seq: 1,
          description: "Go-live achieved by 3/31/2027",
          amountInput: "30,000.00",
          probabilityInput: "",
          isMostLikely: true,
        },
        {
          id: "vc-bonus-o2",
          seq: 2,
          description: "Go-live missed",
          amountInput: "0.00",
          probabilityInput: "",
          isMostLikely: false,
        },
      ],
    },
  };

  return {
    ...base,
    contract: { ...base.contract, customerName: "TitanEnergy", contractNumber: "CASE-7" },
    transactionPriceInput: "460,000.00",
    promises,
    performanceObligations: [implementation, saas],
    hasVariableConsideration: true,
    variableConsiderationComponents: [bonus],
  };
}

/** Adds the accountant's resolution of the bonus on the go-live date. */
export function case7ResolvedDraft(): WorkflowDraft {
  const draft = case7Draft();
  return {
    ...draft,
    variableConsiderationComponents: draft.variableConsiderationComponents.map((component) => ({
      ...component,
      hasResolution: true,
      resolutionDate: "2027-03-20",
      resolutionAmountInput: "30,000.00",
      resolutionRationale: "Go-live accepted by the customer on 3/20/2027; the bonus was earned in full.",
    })),
  };
}

/** CloudAI / Acme Labs — $120,000 fixed annual platform plus metered usage. */
export function cloudAiDraft(): WorkflowDraft {
  const base = answerAllStep1(createEmptyDraft());
  const platform = {
    ...createPoDraft(1, "po-platform"),
    name: "AI platform subscription",
    classification: "series" as const,
    classificationRationale: "A series of distinct daily services with the same pattern of transfer.",
    sspInput: "120,000.00",
    sspBasis: "Observable standalone annual platform pricing.",
    recognitionMethod: "over_time_ratable" as const,
    serviceStart: "2027-01-01",
    serviceEnd: "2027-12-31",
    recognitionRationale: "Customer simultaneously receives and consumes platform access.",
  };
  const promise = {
    ...createPromiseDraft(1, "pr-platform"),
    description: "Annual AI platform access with metered token usage",
    capableOfBeingDistinct: true,
    distinctWithinContractContext: true,
    distinctRationale: "Benefit available on its own.",
    performanceObligationId: platform.id,
  };

  const usageBase = createVcComponentDraft(1, "vc-usage", "usage_as_incurred");
  const inputMeter = {
    ...createVcMeterDraft(1, "meter-input"),
    name: "Input tokens",
    rateAmountInput: "4.00",
    rateQuantityInput: "1000000",
    unit: "tokens",
  };
  const outputMeter = {
    ...createVcMeterDraft(2, "meter-output"),
    name: "Output tokens",
    rateAmountInput: "20.00",
    rateQuantityInput: "1000000",
    unit: "tokens",
  };
  const usage: VcComponentDraft = {
    ...usageBase,
    description: "Metered token usage",
    treatment: "usage_as_incurred",
    allocationTreatment: "specific_series_period",
    targetPoId: platform.id,
    relatesSpecifically: true,
    consistentWithAllocationObjective: true,
    allocationRationale:
      "Each month's usage fee relates specifically to the distinct service period in which the usage occurs.",
    meters: [inputMeter, outputMeter],
    usagePeriods: [
      {
        id: "usage-2027-01",
        month: "2027-01",
        quantities: { "meter-input": "8000000", "meter-output": "2000000" },
      },
    ],
  };

  return {
    ...base,
    contract: { ...base.contract, customerName: "Acme Labs", contractNumber: "CASE-CLOUDAI" },
    transactionPriceInput: "120,000.00",
    promises: [promise],
    performanceObligations: [platform],
    hasVariableConsideration: true,
    variableConsiderationComponents: [usage],
  };
}
