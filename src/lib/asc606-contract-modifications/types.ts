/**
 * Phase 5C contract-modification subsystem — shared types.
 *
 * Conventions match the approved engines: integer cents at every public
 * boundary, "YYYY-MM-DD" calendar dates, "YYYY-MM" reporting periods, no
 * React/DOM/network/database/AI dependency and no mutable global accounting
 * state.
 *
 * The accountant owns every judgment expressed here (the modification facts,
 * the separate-contract criteria, whether each remaining good or service is
 * distinct, the standalone selling prices and the recognition pattern). The
 * ASC 606 treatment is DERIVED, never selected.
 */

import type {
  AllocationRow,
  Cents,
  CheckResult,
  IsoDate,
  MonthKey,
  PerformanceObligationInput,
  RecognitionMethod,
  RevenueSchedule,
  ValidationOutcome,
} from "@/lib/asc606";
import type { RevenueSource } from "@/lib/asc606-material-rights";

/** Derived ASC 606 modification treatment. Never entered by the accountant. */
export type ModificationTreatment =
  "separate_contract" | "prospective" | "cumulative_catch_up" | "mixed";

/** Accountant-selected allocation policy, required only for a mixed modification. */
export type MixedAllocationPolicy = "total_transaction_price" | "remaining_transaction_price";

export const MODIFICATION_TREATMENT_LABELS: Record<ModificationTreatment, string> = {
  separate_contract: "Separate contract — ASC 606-10-25-12",
  prospective: "Prospective — ASC 606-10-25-13(a)",
  cumulative_catch_up: "Cumulative catch-up — ASC 606-10-25-13(b)",
  mixed: "Mixed — ASC 606-10-25-13(c)",
};

export const MIXED_POLICY_LABELS: Record<MixedAllocationPolicy, string> = {
  total_transaction_price: "Policy A — allocate the updated total transaction price",
  remaining_transaction_price: "Policy B — allocate the updated remaining transaction price",
};

/** Status of an original performance obligation after the modification. */
export type ModifiedPoStatus = "continuing" | "added" | "removed";

/**
 * A performance obligation as it exists AFTER the modification.
 * `sourcePoId` links a continuing obligation to its original obligation.
 */
export interface ModifiedPerformanceObligationInput {
  id: string;
  seq: number;
  name: string;
  status: Exclude<ModifiedPoStatus, "removed">;
  /** Original PO this obligation continues; null for an added obligation. */
  sourcePoId: string | null;
  /** Accountant judgment: is the remaining good or service distinct? */
  remainingGoodsDistinct: boolean;
  distinctRationale?: string;
  /** SSP of the goods or services REMAINING to be transferred at the modification date. */
  remainingSspCents: Cents;
  /** SSP of the obligation as modified, measured for the whole obligation. */
  totalModifiedSspCents: Cents;
  sspBasis?: string;
  recognitionMethod: RecognitionMethod;
  serviceStart?: IsoDate;
  serviceEnd?: IsoDate;
  recognitionDate?: IsoDate;
  recognitionRationale?: string;
}

/** The single approved modification event supported in Version 1. */
export interface ModificationEventInput {
  id: string;
  /** Effective date D. Historical accounting is immutable through D − 1. */
  effectiveDate: IsoDate;
  description: string;
  /** Signed change in fixed consideration (a reduction is negative). */
  considerationChangeCents: Cents;
  /** Accountant judgment: the added goods or services are distinct. */
  addsDistinctGoodsOrServices: boolean;
  /** Accountant judgment: the price increase reflects standalone selling prices. */
  priceReflectsStandaloneSellingPrices: boolean;
  separateContractRationale?: string;
  /** Required only when the derived treatment is "mixed". */
  mixedAllocationPolicy?: MixedAllocationPolicy;
  /** Original obligations that no longer exist after the modification. */
  removedPoIds?: string[];
  modifiedPerformanceObligations: ModifiedPerformanceObligationInput[];
}

export interface ContractModificationInput {
  /** ORIGINAL contract transaction price (Step 3), integer cents. */
  originalTransactionPriceCents: Cents;
  originalPerformanceObligations: PerformanceObligationInput[];
  modification: ModificationEventInput;
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export interface ModificationClassification {
  treatment: ModificationTreatment;
  label: string;
  /** ASC 606-10-25-12 criterion (a). */
  addsDistinctGoodsOrServices: boolean;
  /** ASC 606-10-25-12 criterion (b). */
  priceReflectsStandaloneSellingPrices: boolean;
  /** True when every remaining good or service is distinct. */
  allRemainingGoodsDistinct: boolean;
  /** True when no remaining good or service is distinct. */
  noRemainingGoodsDistinct: boolean;
  rationale: string;
  mixedAllocationPolicy: MixedAllocationPolicy | null;
}

export type ModificationAllocationBasis =
  "added_goods_remaining_ssp" | "remaining_ssp" | "total_modified_ssp";

export interface ModificationAllocationLayer {
  basis: ModificationAllocationBasis;
  label: string;
  /** Amount allocated in this layer. */
  transactionPriceCents: Cents;
  rows: AllocationRow[];
}

/** Preserved, immutable historical revenue for one original obligation. */
export interface HistoricalPoRevenue {
  poId: string;
  name: string;
  revenueCents: Cents;
  /** Recognition-progress numerator/denominator through D − 1 (over time only). */
  progressDays: number | null;
  totalDays: number | null;
}

export interface ModificationCatchUpEvent {
  id: string;
  poId: string;
  sourcePoId: string;
  sourceId: string;
  effectiveDate: IsoDate;
  month: MonthKey;
  /** Entitlement the revised measure of progress is applied to. */
  entitlementBasisCents: Cents;
  revisedCumulativeCents: Cents;
  previouslyRecognizedCents: Cents;
  /** Signed catch-up adjustment recognized on the effective date. */
  amountCents: Cents;
}

/** A distinct presentation group. Separate-contract treatment creates two. */
export interface ContractPresentationGroup {
  id: string;
  label: string;
  transactionPriceCents: Cents;
  revenueSchedule: RevenueSchedule;
  revenueSources: RevenueSource[];
  unscheduledRevenueCents: Cents;
}

export interface AccountingSegment {
  id: string;
  label: string;
  groupId: string;
  kind: "original" | "historical" | "separate_contract" | "post_modification";
  startDate: IsoDate | null;
  endDate: IsoDate | null;
  considerationCents: Cents;
}

export interface ModificationTotals {
  originalTransactionPriceCents: Cents;
  considerationChangeCents: Cents;
  lifecycleConsiderationCents: Cents;
  historicalRevenueCents: Cents;
  unrecognizedOriginalConsiderationCents: Cents;
  /** Prospective / mixed Policy B pool; null otherwise. */
  remainingTransactionPriceCents: Cents | null;
  /** Catch-up / mixed Policy A base; null otherwise. */
  updatedTotalTransactionPriceCents: Cents | null;
  catchUpCents: Cents;
  futureRevenueCents: Cents;
  scheduledRevenueCents: Cents;
}

export interface ModificationReconciliation {
  historicalPlusCatchUpPlusFutureCents: Cents | null;
  differenceCents: Cents | null;
  reconciled: boolean | null;
}

export interface ContractModificationAnalysis {
  validation: ValidationOutcome;
  classification: ModificationClassification | null;
  allocationLayers: ModificationAllocationLayer[] | null;
  historical: HistoricalPoRevenue[];
  catchUpEvents: ModificationCatchUpEvent[];
  /** Combined lifecycle schedule across every presentation group. */
  revenueSchedule: RevenueSchedule | null;
  revenueSources: RevenueSource[];
  groups: ContractPresentationGroup[];
  segments: AccountingSegment[];
  totals: ModificationTotals;
  reconciliation: ModificationReconciliation;
}

export class ContractModificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractModificationError";
  }
}

export type { CheckResult };
