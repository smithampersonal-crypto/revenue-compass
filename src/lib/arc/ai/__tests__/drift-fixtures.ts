/**
 * Phase 9G-R3 — re-analysis canonical identity hardening.
 *
 * Deterministic two-run fixtures reproducing the semantic-key drift observed
 * between two independent production runs of the same contract: the model
 * renamed most of its own semantic keys, renamed descriptions, added one
 * genuinely new promise and changed one recognition proposal.
 *
 * Hand-authored synthetic data. No model produced any part of this file and
 * all companies, references and amounts are fictional.
 */

import { AI_OUTPUT_SCHEMA_VERSION, type AiContractAnalysis } from "../schema";

import { genomixR1Analysis } from "./r1-fixtures";

export const DRIFT_RUN_1 = "run-00000000-0000-4000-8000-0000000000a1";
export const DRIFT_RUN_2 = "run-00000000-0000-4000-8000-0000000000a2";

const DOC = "doc-r1-fixture-1";

function cite(page: number, excerpt: string) {
  return {
    documentId: DOC,
    pageStart: page,
    pageEnd: page,
    evidenceMode: "text" as const,
    excerpt,
  };
}

/* ------------------------------------------------------------ run 1 keys */

export const RUN1 = {
  hostedPromise: "promise:hosted-platform-access",
  capacityPromise: "promise:included-throughput-capacity",
  validationPromise: "promise:gxp-validation-artifacts",
  supportPromise: "promise:clinical-bioinformatics-engineering-support",
  hostedPo: "po:hosted-platform-series",
  validationPo: "po:gxp-validation-artifacts",
  supportPo: "po:engineering-support",
  usageVc: "vc:throughput-overage",
  slaVc: "vc:sla-service-credits",
} as const;

/* ------------------------------------------------------------ run 2 keys */

export const RUN2 = {
  hostedPromise: "promise:hosted-platform-access",
  capacityPromise: "promise:included-throughput-capacity",
  validationPromise: "promise:validation-artifact-package",
  supportPromise: "promise:bioinformatics-engineering-support",
  slaPromise: "promise:sla-availability-and-incident-response",
  hostedPo: "po:hosted-platform-service",
  validationPo: "po:validation-artifact-package",
  supportPo: "po:bioinformatics-engineering-support",
  usageVc: "vc:tier-2-specimen-overage",
  slaVc: "vc:sla-service-credits",
} as const;

type Promise_ = AiContractAnalysis["promises"][number];
type Po = AiContractAnalysis["performanceObligations"][number];
type Vc = AiContractAnalysis["transactionPrice"]["variableConsiderationComponents"][number];
type Recognition = AiContractAnalysis["recognitionProposals"][number];
type Ssp = AiContractAnalysis["sspAndAllocation"]["items"][number];

function promise(
  semanticKey: string,
  description: string,
  promiseType: Promise_["promiseType"],
  page: number,
): Promise_ {
  return {
    semanticKey,
    description,
    promiseType,
    otherPromiseTypeDescription: null,
    explicitOrImplicit: "explicit",
    distinctCapableOfBeingDistinct: "yes",
    distinctSeparatelyIdentifiable: "yes",
    distinctConclusion: "yes",
    distinctnessRationale: "Benefit available on its own; not significantly integrated.",
    citations: [cite(page, description)],
    guidanceIds: [11],
    reviewState: "supported",
  };
}

function po(
  semanticKey: string,
  promiseKeys: string[],
  description: string,
  satisfactionPattern: Po["satisfactionPattern"],
  page: number,
): Po {
  return {
    semanticKey,
    promiseKeys,
    description,
    groupingRationale: "Grouping follows the distinctness conclusions above.",
    satisfactionPattern,
    recognitionRationale: "Recognition follows the satisfaction pattern above.",
    citations: [cite(page, description)],
    guidanceIds: [11],
    reviewState: "supported",
  };
}

function usageVc(semanticKey: string, targetKey: string, rate: string): Vc {
  return {
    semanticKey,
    description: "Excess specimen processing overage",
    type: "usage",
    contractualRateOrAmountInput: rate,
    unitDescription: "per specimen",
    billingFrequency: "quarterly",
    trigger: "Specimens processed above the included annual tier.",
    estimationMethodProposal: "unknown",
    initialEstimateBasis: "not_applicable_usage_as_incurred",
    initialEstimatedAmountInput: null,
    initialIncludedAmountInput: null,
    initialEstimateRationale: "Basis recorded for the initial estimate at inception.",
    constraintAssessment: "Usage is recognized as it occurs.",
    allocationTreatmentProposal: "specific_series_period",
    targetPerformanceObligationKey: targetKey,
    relatesSpecifically: "yes",
    consistentWithAllocationObjective: "yes",
    allocationRationale: "Each period's overage relates specifically to that period's processing.",
    citations: [cite(2, "overage rate")],
    guidanceIds: [25],
    reviewState: "supported",
  };
}

function slaVc(semanticKey: string, targetKey: string): Vc {
  return {
    semanticKey,
    description: "Availability service credit",
    type: "service_credit",
    contractualRateOrAmountInput: null,
    unitDescription: null,
    billingFrequency: "monthly",
    trigger: "Monthly availability below the committed level.",
    estimationMethodProposal: "expected_value",
    initialEstimateBasis: "needs_user_input",
    initialEstimatedAmountInput: null,
    initialIncludedAmountInput: null,
    initialEstimateRationale: "Basis recorded for the initial estimate at inception.",
    constraintAssessment: "Credits are constrained to amounts probable of being incurred.",
    allocationTreatmentProposal: "specific_series_period",
    targetPerformanceObligationKey: targetKey,
    relatesSpecifically: "yes",
    consistentWithAllocationObjective: "yes",
    allocationRationale: "The credit applies exclusively to the recurring platform fees.",
    citations: [cite(5, "service credit")],
    guidanceIds: [25],
    reviewState: "supported",
  };
}

function recognition(
  performanceObligationKey: string,
  satisfactionPattern: Recognition["satisfactionPattern"],
  recognitionMethod: Recognition["recognitionMethod"],
  extra: Partial<Recognition> = {},
): Recognition {
  return {
    performanceObligationKey,
    satisfactionPattern,
    recognitionMethod,
    serviceStartDate: "2026-11-01",
    serviceEndDate: "2028-10-31",
    measureDescription: "Measure of progress stated in the contract.",
    recognitionEventDescription: null,
    recognitionDateIfContractuallyDeterminable: null,
    rationale: "Follows the satisfaction pattern concluded in step 2.",
    citations: [cite(1, "term")],
    guidanceIds: [58],
    reviewState: "supported",
    ...extra,
  };
}

function ssp(semanticKey: string, appliesToKey: string, amount: string): Ssp {
  return {
    semanticKey,
    appliesToKey,
    observableSspEvidence: "observable",
    observedAmountInput: amount,
    proposedMethod: "observable_price",
    proposedSspAmountInput: null,
    methodRationale: "Stated contract price assumption.",
    missingInformation: "None.",
    citations: [cite(1, amount)],
    guidanceIds: [44],
    reviewState: "supported",
  };
}

/** The first analysis: three performance obligations, two VC components. */
export function driftRun1Analysis(): AiContractAnalysis {
  const analysis = genomixR1Analysis();
  analysis.schemaVersion = AI_OUTPUT_SCHEMA_VERSION;
  analysis.promises = [
    promise(RUN1.hostedPromise, "Hosted platform access", "hosted_service", 1),
    promise(RUN1.capacityPromise, "Included annual throughput capacity", "hosted_service", 2),
    promise(RUN1.validationPromise, "GxP validation evidence artifacts", "validation", 3),
    promise(RUN1.supportPromise, "Dedicated engineering support, 40 hours annually", "support", 4),
  ];
  analysis.performanceObligations = [
    po(
      RUN1.hostedPo,
      [RUN1.hostedPromise, RUN1.capacityPromise],
      "Hosted platform access series",
      "over_time",
      1,
    ),
    po(RUN1.validationPo, [RUN1.validationPromise], "Validation artifacts", "point_in_time", 3),
    po(RUN1.supportPo, [RUN1.supportPromise], "Engineering support", "over_time", 4),
  ];
  analysis.transactionPrice.variableConsiderationComponents = [
    usageVc(RUN1.usageVc, RUN1.hostedPo, "1.35"),
    slaVc(RUN1.slaVc, RUN1.hostedPo),
  ];
  analysis.recognitionProposals = [
    recognition(RUN1.hostedPo, "over_time", "ratable_over_time"),
    recognition(RUN1.validationPo, "point_in_time", "point_in_time_transfer", {
      recognitionEventDescription: "Delivery of the validation artifact package.",
    }),
    recognition(RUN1.supportPo, "over_time", "input_method"),
  ];
  analysis.sspAndAllocation.items = [
    ssp("ssp:hosted", RUN1.hostedPo, "446000"),
    ssp("ssp:validation", RUN1.validationPo, "29600"),
    ssp("ssp:support", RUN1.supportPo, "14400"),
  ];
  analysis.transactionPrice.fixedConsiderationInput = "245000";
  return analysis;
}

/**
 * The second independent analysis of the SAME contract. The model renamed
 * most of its own semantic keys and descriptions, grouped a genuinely new
 * SLA promise into the hosted obligation, changed the overage rate it reads
 * from the contract and proposed a different measure of progress for support.
 */
export function driftRun2Analysis(): AiContractAnalysis {
  const analysis = driftRun1Analysis();
  analysis.promises = [
    promise(RUN2.hostedPromise, "Hosted HelixFlow platform access", "hosted_service", 1),
    promise(RUN2.capacityPromise, "Annual specimen throughput entitlement", "hosted_service", 2),
    promise(RUN2.validationPromise, "IQ/OQ/PQ validation artifact package", "validation", 3),
    promise(
      RUN2.supportPromise,
      "Clinical bioinformatics engineering support hours",
      "support",
      4,
    ),
    promise(RUN2.slaPromise, "Availability and incident-response commitment", "support", 5),
  ];
  analysis.performanceObligations = [
    po(
      RUN2.hostedPo,
      [RUN2.hostedPromise, RUN2.capacityPromise, RUN2.slaPromise],
      "Hosted platform service",
      "over_time",
      1,
    ),
    po(
      RUN2.validationPo,
      [RUN2.validationPromise],
      "Validation artifact package",
      "point_in_time",
      3,
    ),
    po(
      RUN2.supportPo,
      [RUN2.supportPromise],
      "Bioinformatics engineering support",
      "over_time",
      4,
    ),
  ];
  analysis.transactionPrice.variableConsiderationComponents = [
    usageVc(RUN2.usageVc, RUN2.hostedPo, "1.55"),
    slaVc(RUN2.slaVc, RUN2.hostedPo),
  ];
  analysis.recognitionProposals = [
    recognition(RUN2.hostedPo, "over_time", "ratable_over_time"),
    recognition(RUN2.validationPo, "point_in_time", "point_in_time_transfer", {
      recognitionEventDescription: "Delivery of the validation artifact package.",
    }),
    // Drift: the accountant already recorded an input measure on this PO.
    recognition(RUN2.supportPo, "over_time", "output_method"),
  ];
  analysis.sspAndAllocation.items = [
    ssp("ssp:hosted", RUN2.hostedPo, "446000"),
    ssp("ssp:validation", RUN2.validationPo, "29600"),
    ssp("ssp:support", RUN2.supportPo, "14400"),
  ];
  return analysis;
}
