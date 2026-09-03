import {
  createEmptyDraft,
  createPoDraft,
  createPromiseDraft,
  STEP1_CRITERIA,
  type WorkflowDraft,
} from "../types";

/** All companies, customers and amounts are fictional. */
export function answerAllStep1(draft: WorkflowDraft, answer: boolean = true): WorkflowDraft {
  const criteria = { ...draft.contract.criteria };
  for (const criterion of STEP1_CRITERIA) {
    criteria[criterion.id] = { answer, rationale: "Fictional demonstration rationale." };
  }
  return { ...draft, contract: { ...draft.contract, criteria } };
}

/** Scenario A — Redwood Retail, single SaaS promise, $120,000 annual. */
export function scenarioADraft(): WorkflowDraft {
  const base = answerAllStep1(createEmptyDraft());
  const po = {
    ...createPoDraft(1, "po-saas"),
    name: "SaaS subscription",
    classification: "single_distinct" as const,
    classificationRationale: "Single distinct hosted service.",
    sspInput: "120,000.00",
    sspBasis: "Observable standalone renewal pricing.",
    recognitionMethod: "over_time_ratable" as const,
    serviceStart: "2027-01-01",
    serviceEnd: "2027-12-31",
    recognitionRationale: "Customer simultaneously receives and consumes the hosted service.",
  };
  const promise = {
    ...createPromiseDraft(1, "pr-saas"),
    description: "Annual hosted SaaS service",
    capableOfBeingDistinct: true,
    distinctWithinContractContext: true,
    distinctRationale: "Benefit available on its own; not significantly integrated.",
    performanceObligationId: po.id,
  };
  return {
    ...base,
    contract: { ...base.contract, customerName: "Redwood Retail", contractNumber: "CASE-1" },
    transactionPriceInput: "120,000.00",
    promises: [promise],
    performanceObligations: [po],
  };
}

/** Scenario B — Apex Manufacturing, SaaS + training, $126,000. */
export function scenarioBDraft(): WorkflowDraft {
  const base = answerAllStep1(createEmptyDraft());
  const saasPo = {
    ...createPoDraft(1, "po-saas"),
    name: "SaaS subscription",
    classification: "single_distinct" as const,
    classificationRationale: "Single distinct hosted service.",
    sspInput: "120,000.00",
    sspBasis: "Observable standalone renewal pricing.",
    recognitionMethod: "over_time_ratable" as const,
    serviceStart: "2027-01-01",
    serviceEnd: "2027-12-31",
    recognitionRationale: "Simultaneous receipt and consumption of the hosted service.",
  };
  const trainingPo = {
    ...createPoDraft(2, "po-training"),
    name: "Training",
    classification: "single_distinct" as const,
    classificationRationale: "Distinct one-day training session.",
    sspInput: "20,000.00",
    sspBasis: "Observable standalone training price list.",
    recognitionMethod: "point_in_time" as const,
    recognitionDate: "2027-01-15",
    recognitionRationale: "Control transfers when the training session is delivered.",
  };
  const promises = [
    {
      ...createPromiseDraft(1, "pr-saas"),
      description: "Annual SaaS access",
      capableOfBeingDistinct: true,
      distinctWithinContractContext: true,
      distinctRationale: "Benefit available on its own.",
      performanceObligationId: saasPo.id,
    },
    {
      ...createPromiseDraft(2, "pr-training"),
      description: "One-day employee training",
      capableOfBeingDistinct: true,
      distinctWithinContractContext: true,
      distinctRationale: "Separately saleable training service.",
      performanceObligationId: trainingPo.id,
    },
  ];
  return {
    ...base,
    contract: { ...base.contract, customerName: "Apex Manufacturing", contractNumber: "CASE-2" },
    transactionPriceInput: "126,000.00",
    promises,
    performanceObligations: [saasPo, trainingPo],
  };
}
