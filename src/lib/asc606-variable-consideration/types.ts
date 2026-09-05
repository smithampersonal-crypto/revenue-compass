/**
 * Phase 5B variable-consideration subsystem — shared types.
 *
 * Conventions match the approved engines: integer cents at every public
 * boundary, probabilities as integer basis points, "YYYY-MM-DD" calendar
 * dates, "YYYY-MM" reporting periods, no React/DOM/network/database/AI
 * dependency and no mutable global accounting state.
 *
 * The accountant owns every judgment expressed here (estimation method,
 * outcomes, the amount included after the constraint, the allocation
 * treatment, the allocation-exception judgments, remeasurement, resolution and
 * usage actuals). This module only calculates.
 */

import type {
  AllocationRow,
  Cents,
  IsoDate,
  MonthKey,
  PerformanceObligationInput,
  RevenueSchedule,
} from "@/lib/asc606";
import type {
  BasisPoints,
  MaterialRightInput,
  MaterialRightOutcome,
  RevenueSource,
} from "@/lib/asc606-material-rights";

export type VcTreatment = "estimated" | "usage_as_incurred";

export type VcEffect = "increase" | "decrease";

export type EstimationMethod = "most_likely_amount" | "expected_value";

export type VcAllocationTreatment = "general" | "specific_po" | "specific_series_period";

export type ConstraintConclusion = "excluded" | "partially_included" | "fully_included";

/** One possible outcome of an estimated variable-consideration component. */
export interface VcOutcomeInput {
  id: string;
  seq: number;
  /** Magnitude in cents; the component effect supplies the sign. */
  amountCents: Cents;
  /** Expected value only. */
  probabilityBps?: BasisPoints;
  /** Most likely amount only; exactly one outcome must be marked. */
  isMostLikely?: boolean;
  description?: string;
}

/** A dated assessment (inception estimate or a later remeasurement). */
export interface VcAssessmentInput {
  id: string;
  seq: number;
  effectiveDate: IsoDate;
  outcomes: VcOutcomeInput[];
  /** Magnitude included after applying the constraint. */
  includedCents: Cents;
  constraintRationale: string;
  evidence?: string;
}

/** Optional final resolution of an estimated component. */
export interface VcResolutionInput {
  id: string;
  date: IsoDate;
  /** Magnitude of the actual outcome. */
  actualCents: Cents;
  rationale?: string;
}

export interface EstimatedComponentInput {
  id: string;
  seq: number;
  description: string;
  effect: VcEffect;
  estimationMethod: EstimationMethod;
  /** Locked across the component lifecycle. */
  allocationTreatment: Extract<VcAllocationTreatment, "general" | "specific_po">;
  /** Required when the allocation treatment is specific_po; locked. */
  targetPoId?: string;
  /** Allocation-exception judgments, required for specific_po. */
  relatesSpecificallyToPo?: boolean;
  consistentWithAllocationObjective?: boolean;
  allocationRationale: string;
  inception: VcAssessmentInput;
  remeasurements: VcAssessmentInput[];
  resolution?: VcResolutionInput;
}

/** One fixed-rate meter, stored as exact ratio terms (never a unit price). */
export interface UsageMeterInput {
  id: string;
  seq: number;
  name: string;
  /** Rate numerator, integer cents (for example $4.00 -> 400). */
  rateAmountCents: Cents;
  /** Rate denominator, positive integer quantity (for example 1_000_000). */
  rateQuantity: number;
  unit: string;
}

/** Actual usage for one accounting month. `null` means blank (not zero). */
export interface UsagePeriodInput {
  month: MonthKey;
  quantitiesByMeterId: Record<string, number | null>;
}

export interface UsageComponentInput {
  id: string;
  seq: number;
  description: string;
  /** Locked series performance obligation the usage relates to. */
  targetPoId: string;
  /** Always specific_series_period in Phase 5B. */
  allocationTreatment: Extract<VcAllocationTreatment, "specific_series_period">;
  relatesSpecificallyToPeriod?: boolean;
  consistentWithAllocationObjective?: boolean;
  allocationRationale: string;
  meters: UsageMeterInput[];
  periods: UsagePeriodInput[];
}

export interface VcContractInput {
  /** Fixed consideration determined in Step 3. */
  fixedConsiderationCents: Cents;
  standardPerformanceObligations: PerformanceObligationInput[];
  materialRights: MaterialRightInput[];
  estimatedComponents: EstimatedComponentInput[];
  usageComponents: UsageComponentInput[];
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export interface VcCheckResult {
  id: string;
  category: "component" | "allocation" | "usage" | "lifecycle" | "reconciliation";
  severity: "blocking" | "warning";
  message: string;
  passed: boolean;
}

export interface VcValidationOutcome {
  status: "passed" | "attention";
  results: VcCheckResult[];
  blockingFailures: VcCheckResult[];
}

/** Per-assessment derived measurement, preserved as read-only history. */
export interface VcAssessmentResult {
  assessmentId: string;
  seq: number;
  effectiveDate: IsoDate;
  /** Signed unconstrained estimate. */
  unconstrainedCents: Cents;
  /** Signed amount included after the constraint. */
  includedCents: Cents;
  constraintConclusion: ConstraintConclusion;
  constraintRationale: string;
  /** Signed change against the prior assessment; 0 for the inception row. */
  changeCents: Cents;
  isResolution: boolean;
}

export interface VcComponentResult {
  componentId: string;
  seq: number;
  description: string;
  effect: VcEffect;
  estimationMethod: EstimationMethod;
  allocationTreatment: VcAllocationTreatment;
  targetPoId: string | null;
  /** Signed amount included at inception (part of the initial transaction price). */
  initialIncludedCents: Cents;
  /** Signed amount currently included after every approved change. */
  currentIncludedCents: Cents;
  assessments: VcAssessmentResult[];
  resolved: boolean;
}

/** One dated, allocated transaction-price change and its revenue effect. */
export interface VcChangeEvent {
  id: string;
  componentId: string;
  assessmentId: string;
  effectiveDate: IsoDate;
  month: MonthKey;
  /** Signed change in the transaction price. */
  transactionPriceChangeCents: Cents;
  /** Signed change allocated to each performance obligation. */
  allocationByPo: { poId: string; amountCents: Cents }[];
  /** Signed revenue recognized in the effective month because of the change. */
  catchUpCents: Cents;
  /** Signed amount that will affect future periods. */
  futureImpactCents: Cents;
  isResolution: boolean;
}

export interface UsageMeterPeriodResult {
  meterId: string;
  meterName: string;
  quantity: number;
  rateAmountCents: Cents;
  rateQuantity: number;
  amountCents: Cents;
}

export interface UsagePeriodResult {
  componentId: string;
  targetPoId: string;
  revenueSourceId: string;
  month: MonthKey;
  meters: UsageMeterPeriodResult[];
  totalCents: Cents;
}

export interface VcAllocationLayers {
  /** Relative-SSP allocation of the general pool. */
  base: AllocationRow[];
  /** Specific variable amounts added in full to a target PO. */
  specific: {
    componentId: string;
    description: string;
    poId: string;
    poName: string;
    amountCents: Cents;
  }[];
  /** Inception allocation by PO: base + specific. */
  inceptionFinal: { poId: string; name: string; amountCents: Cents }[];
  /** Current allocation by PO: inception + every dated change. */
  currentFinal: { poId: string; name: string; amountCents: Cents }[];
}

export interface VcTotals {
  fixedConsiderationCents: Cents;
  /** fixed + initial constrained estimated variable consideration. */
  initialTransactionPriceCents: Cents;
  /** initial transaction price + approved estimated-VC changes. */
  currentEstimatedConsiderationCents: Cents;
  /** Actual usage-as-incurred consideration recognized to date. */
  usageConsiderationCents: Cents;
  /** Consideration arising on exercised material rights. */
  exerciseConsiderationCents: Cents;
  /** current estimated + usage + material-right exercise consideration. */
  lifecycleConsiderationCents: Cents;
  scheduledRevenueCents: Cents | null;
  unscheduledConsiderationCents: Cents | null;
}

export interface VcReconciliation {
  scheduledPlusUnscheduledCents: Cents | null;
  differenceCents: Cents | null;
  reconciled: boolean | null;
}

export interface VariableConsiderationAnalysis {
  validation: VcValidationOutcome;
  allocation: VcAllocationLayers | null;
  revenueSchedule: RevenueSchedule | null;
  revenueSources: RevenueSource[];
  components: VcComponentResult[];
  changeEvents: VcChangeEvent[];
  usagePeriods: UsagePeriodResult[];
  materialRights: MaterialRightOutcome[];
  totals: VcTotals;
  reconciliation: VcReconciliation;
}

export class VariableConsiderationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VariableConsiderationError";
  }
}
