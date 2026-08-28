/**
 * ASC 606 engine — shared types (Phase 1).
 *
 * Conventions:
 *  - All monetary amounts are INTEGER CENTS at every public boundary
 *    ($120,000.00 === 12_000_000). No floating-point dollars.
 *  - All dates are plain calendar strings "YYYY-MM-DD" (timezone-free).
 *  - Reporting periods are calendar months keyed "YYYY-MM".
 *  - Data only: the engine has no React, DOM, network, database or AI
 *    dependency and holds no mutable global state.
 */

/** Integer cents. */
export type Cents = number;

/** Calendar date, "YYYY-MM-DD". */
export type IsoDate = string;

/** Reporting period, "YYYY-MM". */
export type MonthKey = string;

/** Over-time time-based conventions. Version 1 implements only daily_ratable. */
export type OverTimeConvention = "daily_ratable";

export type RecognitionMethod = "over_time_ratable" | "point_in_time";

export type PoClassification = "single_distinct" | "bundle_not_distinct" | "series";

/**
 * A promised good or service identified in the contract (ASC 606 Step 2 input).
 * `distinctConclusion` is never stored: it is derived from the two judgments.
 */
export interface ContractPromise {
  id: string;
  seq: number;
  description: string;
  /** Accountant judgment: capable of being distinct. */
  capableOfBeingDistinct: boolean;
  /** Accountant judgment: distinct within the context of the contract. */
  distinctWithinContractContext: boolean;
  /** Accountant's supporting explanation of the Step 2 analysis. */
  distinctRationale?: string;
  /** The performance obligation this promise was grouped into (null = unassigned). */
  performanceObligationId: string | null;
}

/** Performance obligation resulting from the accountant's Step 2 grouping. */
export interface PerformanceObligationInput {
  id: string;
  /** Deterministic ordering key; also the allocation residual tie-breaker. */
  seq: number;
  name: string;
  /** Standalone selling price, integer cents. SSP lives at the PO level only. */
  sspCents: Cents;
  /** Accountant's documentation of how SSP was determined. */
  sspBasis?: string;
  classification?: PoClassification;
  classificationRationale?: string;
  recognitionMethod: RecognitionMethod;
  /** Over time only. Inclusive. */
  serviceStart?: IsoDate;
  /** Over time only. Inclusive. */
  serviceEnd?: IsoDate;
  /** Point in time only. */
  recognitionDate?: IsoDate;
  /** Over-time convention; defaults to "daily_ratable". */
  overTimeConvention?: OverTimeConvention;
}

/** Phase 1 engine input: the contract facts needed for Steps 4 and 5. */
export interface Phase1ContractInput {
  id?: string;
  customerName?: string;
  contractNumber?: string;
  /** Fixed consideration, integer cents. USD only in Version 1. */
  transactionPriceCents: Cents;
  performanceObligations: PerformanceObligationInput[];
  /** Optional in Phase 1; used to validate promise-to-PO grouping when supplied. */
  promises?: ContractPromise[];
}

/**
 * Machine-readable calculation explanation so the UI can later render
 * "$102,857.14 x 31 days / 365 days" without recomputing anything.
 */
export interface Explanation {
  template: string;
  inputs: Record<string, number | string>;
}

export interface AllocationRow {
  poId: string;
  seq: number;
  name: string;
  sspCents: Cents;
  totalSspCents: Cents;
  /** Derived for display only; never an input to a monetary calculation. */
  relativeSspPercent: number;
  allocatedCents: Cents;
  explanation: Explanation;
}

export interface RevenueScheduleRowByPo {
  poId: string;
  month: MonthKey;
  revenueCents: Cents;
  explanation: Explanation;
}

export interface RevenueScheduleRowByMonth {
  month: MonthKey;
  perPo: Record<string, Cents>;
  totalCents: Cents;
  cumulativeCents: Cents;
}

export interface RevenueSchedule {
  byPo: RevenueScheduleRowByPo[];
  byMonth: RevenueScheduleRowByMonth[];
  totalCents: Cents;
  /** Revenue-recognition horizon (not the wider accounting horizon). */
  firstMonth: MonthKey | null;
  lastMonth: MonthKey | null;
}

export type ValidationSeverity = "blocking" | "warning";

export interface CheckResult {
  id: string;
  category: "contract" | "performance_obligations" | "allocation" | "revenue";
  severity: ValidationSeverity;
  message: string;
  passed: boolean;
  detail?: Record<string, number | string | boolean>;
}

export interface ValidationOutcome {
  status: "passed" | "attention";
  results: CheckResult[];
  blockingFailures: CheckResult[];
}

/** Phase 1 orchestration result. Contract balances and JEs arrive in Phase 3/4. */
export interface Phase1Analysis {
  validation: ValidationOutcome;
  /** Present only when no blocking validation failure exists. */
  allocation: AllocationRow[] | null;
  /** Present only when no blocking validation failure exists. */
  revenueSchedule: RevenueSchedule | null;
  totals: {
    transactionPriceCents: Cents;
    allocatedCents: Cents | null;
    revenueCents: Cents | null;
  };
}

/** Derived Step 2 conclusion. Never entered or overridden by the accountant. */
export function deriveDistinctConclusion(promise: ContractPromise): boolean {
  return promise.capableOfBeingDistinct && promise.distinctWithinContractContext;
}
