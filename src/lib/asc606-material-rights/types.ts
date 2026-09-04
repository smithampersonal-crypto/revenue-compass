/**
 * Phase 5A material-right subsystem — shared types.
 *
 * Conventions match the approved engines: integer cents everywhere,
 * "YYYY-MM-DD" calendar dates, "YYYY-MM" reporting periods, no React/DOM/
 * network/database/AI dependency and no mutable global accounting state.
 *
 * The accountant owns every judgment expressed here (whether a customer option
 * conveys a material right, the economic benefit, the inception exercise
 * probability, the option outcome and the recognition pattern of the resulting
 * good or service). This module only calculates.
 */

import type {
  AllocationRow,
  Cents,
  CheckResult,
  IsoDate,
  PerformanceObligationInput,
  RecognitionMethod,
  RevenueSchedule,
  ValidationOutcome,
} from "@/lib/asc606";

export type MaterialRightStatus = "outstanding" | "exercised" | "expired";

/** Basis points; 100.00% === 10,000 bps. */
export type BasisPoints = number;

export const BPS_SCALE = 10_000;

/** The linked exercise segment created when the customer exercises the option. */
export interface MaterialRightExerciseInput {
  exerciseDate: IsoDate;
  /** New contractual consideration arising on exercise. */
  newConsiderationCents: Cents;
  recognitionMethod: RecognitionMethod;
  serviceStart?: IsoDate;
  serviceEnd?: IsoDate;
  recognitionDate?: IsoDate;
  recognitionRationale?: string;
}

/** A performance obligation that is a material right (never a PoClassification). */
export interface MaterialRightInput {
  id: string;
  seq: number;
  name: string;
  /** The good or service the customer would obtain on exercise. */
  underlyingGoodOrServiceName: string;
  /** Accountant judgment: economic benefit of the option. */
  benefitAmountCents: Cents;
  /** Accountant judgment: exercise probability at contract inception, in bps. */
  exerciseProbabilityBps: BasisPoints;
  sspBasis?: string;
  status: MaterialRightStatus;
  /** Required when the option expired unexercised. */
  expirationDate?: IsoDate;
  /** Required when the option was exercised. */
  exercise?: MaterialRightExerciseInput;
}

/** Lifecycle engine input: an original contract that contains material rights. */
export interface MaterialRightContractInput {
  /** ORIGINAL contract transaction price (Step 3). Never future consideration. */
  transactionPriceCents: Cents;
  standardPerformanceObligations: PerformanceObligationInput[];
  materialRights: MaterialRightInput[];
}

export type RevenueSourceType =
  | "original_po"
  | "material_right_exercise"
  | "material_right_expiration";

/** Deterministic display metadata for every column of the lifecycle schedule. */
export interface RevenueSource {
  id: string;
  name: string;
  sourceType: RevenueSourceType;
  originalPoId?: string;
  materialRightPoId?: string;
}

export interface MaterialRightOutcome {
  poId: string;
  seq: number;
  name: string;
  underlyingGoodOrServiceName: string;
  benefitAmountCents: Cents;
  exerciseProbabilityBps: BasisPoints;
  /** benefit x probability, exact half-up. */
  estimatedSspCents: Cents;
  /** Original relative-SSP allocation to this material right. */
  allocatedCents: Cents;
  status: MaterialRightStatus;
  /** Allocated consideration with no determinable revenue date yet. */
  unscheduledCents: Cents;
  exerciseDate: IsoDate | null;
  exerciseConsiderationCents: Cents | null;
  /** New consideration + carried original allocation. */
  exerciseRecognitionBasisCents: Cents | null;
  expirationDate: IsoDate | null;
  expirationRevenueCents: Cents | null;
  /** Deterministic revenue-source id for the exercise/expiration column. */
  revenueSourceId: string | null;
}

export interface LifecycleTotals {
  originalTransactionPriceCents: Cents;
  originalAllocatedCents: Cents | null;
  exerciseConsiderationCents: Cents;
  lifecycleConsiderationCents: Cents;
  scheduledRevenueCents: Cents | null;
  unscheduledMaterialRightCents: Cents | null;
}

export interface LifecycleReconciliation {
  /** scheduled + unscheduled; null when blocked. */
  scheduledPlusUnscheduledCents: Cents | null;
  /** lifecycle consideration − (scheduled + unscheduled); null when blocked. */
  differenceCents: Cents | null;
  reconciled: boolean | null;
}

export interface MaterialRightLifecycleAnalysis {
  validation: ValidationOutcome;
  /** Original inception allocation across standard POs and material rights. */
  allocation: AllocationRow[] | null;
  /** Combined lifecycle schedule keyed by deterministic revenue-source id. */
  revenueSchedule: RevenueSchedule | null;
  revenueSources: RevenueSource[];
  materialRights: MaterialRightOutcome[];
  totals: LifecycleTotals;
  reconciliation: LifecycleReconciliation;
}

export class MaterialRightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MaterialRightError";
  }
}

export type { CheckResult };
