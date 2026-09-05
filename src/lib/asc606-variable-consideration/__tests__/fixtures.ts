/**
 * Deterministic Phase 5B engine fixtures.
 * All companies, customers and amounts are fictional.
 */

import type { PerformanceObligationInput } from "@/lib/asc606";
import type {
  EstimatedComponentInput,
  UsageComponentInput,
  VcContractInput,
} from "../types";

export const D = (whole: number, cents = 0) => whole * 100 + cents;

/** Case 7 — AtlasData / TitanEnergy. */
export const CASE7_IMPLEMENTATION: PerformanceObligationInput = {
  id: "po-implementation",
  seq: 1,
  name: "Implementation services",
  sspCents: D(60_000),
  sspBasis: "Standalone implementation pricing for comparable customers.",
  classification: "single_distinct",
  recognitionMethod: "point_in_time",
  recognitionDate: "2027-03-20",
};

export const CASE7_SAAS: PerformanceObligationInput = {
  id: "po-saas",
  seq: 2,
  name: "SaaS subscription",
  sspCents: D(440_000),
  sspBasis: "Observable renewal pricing.",
  classification: "series",
  recognitionMethod: "over_time_ratable",
  serviceStart: "2027-04-01",
  serviceEnd: "2029-03-31",
  overTimeConvention: "daily_ratable",
};

export const CASE7_BONUS: EstimatedComponentInput = {
  id: "vc-bonus",
  seq: 1,
  description: "Implementation completion bonus",
  effect: "increase",
  estimationMethod: "most_likely_amount",
  allocationTreatment: "specific_po",
  targetPoId: "po-implementation",
  relatesSpecificallyToPo: true,
  consistentWithAllocationObjective: true,
  allocationRationale:
    "The bonus is earned only by completing implementation by 3/31/2027 and therefore relates specifically to that performance obligation.",
  inception: {
    id: "vc-bonus-inception",
    seq: 1,
    effectiveDate: "2027-01-01",
    outcomes: [
      { id: "o1", seq: 1, amountCents: D(30_000), isMostLikely: true, description: "Completed timely" },
      { id: "o2", seq: 2, amountCents: 0, description: "Not completed timely" },
    ],
    includedCents: D(30_000),
    constraintRationale:
      "Management forecasts timely completion and 38 of 40 comparable historical jobs completed timely, so a significant revenue reversal is not probable.",
  },
  remeasurements: [],
  resolution: {
    id: "vc-bonus-resolution",
    date: "2027-03-20",
    actualCents: D(30_000),
    rationale: "Implementation accepted 3/20/2027 and the full bonus was earned.",
  },
};

export function case7Input(): VcContractInput {
  return {
    fixedConsiderationCents: D(460_000),
    standardPerformanceObligations: [CASE7_IMPLEMENTATION, CASE7_SAAS],
    materialRights: [],
    estimatedComponents: [CASE7_BONUS],
    usageComponents: [],
  };
}

/** CloudAI / Acme Labs — hosted AI platform with metered usage. */
export const CLOUDAI_PLATFORM: PerformanceObligationInput = {
  id: "po-platform",
  seq: 1,
  name: "Hosted AI Platform Service",
  sspCents: D(120_000),
  sspBasis: "Observable list pricing.",
  classification: "series",
  recognitionMethod: "over_time_ratable",
  serviceStart: "2027-01-01",
  serviceEnd: "2027-12-31",
  overTimeConvention: "daily_ratable",
};

export const CLOUDAI_USAGE: UsageComponentInput = {
  id: "vc-usage",
  seq: 1,
  description: "AI API Consumption",
  targetPoId: "po-platform",
  allocationTreatment: "specific_series_period",
  relatesSpecificallyToPeriod: true,
  consistentWithAllocationObjective: true,
  allocationRationale:
    "Each month's usage fee relates specifically to the distinct daily service provided in that month and pricing is consistent throughout the term.",
  meters: [
    { id: "meter-input", seq: 1, name: "Input tokens", rateAmountCents: D(4), rateQuantity: 1_000_000, unit: "tokens" },
    { id: "meter-output", seq: 2, name: "Output tokens", rateAmountCents: D(20), rateQuantity: 1_000_000, unit: "tokens" },
  ],
  periods: [
    {
      month: "2027-01",
      quantitiesByMeterId: { "meter-input": 8_000_000, "meter-output": 2_000_000 },
    },
  ],
};

export function cloudAiInput(): VcContractInput {
  return {
    fixedConsiderationCents: D(120_000),
    standardPerformanceObligations: [CLOUDAI_PLATFORM],
    materialRights: [],
    estimatedComponents: [],
    usageComponents: [CLOUDAI_USAGE],
  };
}
