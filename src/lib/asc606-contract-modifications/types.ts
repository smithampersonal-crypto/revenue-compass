/**
 * Phase 5C contract-modification subsystem — shared types.
 *
 * Conventions match the approved engines: integer cents at every public
 * boundary, "YYYY-MM-DD" calendar dates, "YYYY-MM" reporting periods, no
 * React/DOM/network/database/AI dependency and no mutable global accounting
 * state.
 *
 * The accountant owns every judgment expressed here (approval and
 * enforceability, the scope effect of the modification on each continuing
 * obligation, whether added goods or services are distinct, whether the
 * remaining goods or services are distinct from those already transferred, the
 * standalone selling prices and the recognition pattern). The ASC 606
 * treatment is DERIVED, never selected.
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
  | "separate_contract"
  | "prospective"
  | "cumulative_catch_up"
  | "mixed";

/** Accountant-selected allocation policy, required only for a mixed modification. */
export type MixedAllocationPolicy =
  | "updated_total_transaction_price"
  | "updated_remaining_transaction_price";

export const MODIFICATION_TREATMENT_LABELS: Record<ModificationTreatment, string> = {
  separate_contract: "Separate contract — ASC 606-10-25-12",
  prospective: "Prospective — ASC 606-10-25-13(a)",
  cumulative_catch_up: "Cumulative catch-up — ASC 606-10-25-13(b)",
  mixed: "Mixed — ASC 606-10-25-13(c)",
};

export const MIXED_POLICY_LABELS: Record<MixedAllocationPolicy, string> = {
  updated_total_transaction_price: "Allocate the updated TOTAL transaction price",
  updated_remaining_transaction_price: "Allocate the updated REMAINING transaction price",
};

/** Status of a performance obligation after the modification. */
export type ModifiedPoStatus = "continuing" | "added" | "removed";

/** Accountant judgment: how the modification changes a continuing obligation. */
export type ScopeEffect = "unchanged" | "increase" | "decrease" | "reconfigured";

/** Accountant judgment: direction of the change in fixed consideration. */
export type ConsiderationEffect = "increase" | "decrease" | "none";

/** Reserved identity namespace; user-entered IDs may never contain it. */
export const RESERVED_ID_NAMESPACE = "::";

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
  /**
   * Continuing obligations only. A continuing obligation whose scope is NOT
   * "unchanged" has been repriced or restructured, which disqualifies
   * ASC 606-10-25-12 separate treatment. Never defaulted by the workflow.
   */
  scopeEffect: ScopeEffect | null;
  /** Added obligations only — ASC 606-10-25-12(a). */
  addedGoodsAreDistinct: boolean | null;
  addedGoodsDistinctnessRationale?: string;
  /** ASC 606-10-25-13 routing judgment. */
  remainingGoodsDistinctFromTransferred: boolean;
  remainingDistinctnessRationale?: string;
  /** SSP of the goods or services REMAINING to be transferred at the modification date. */
  remainingSspCents: Cents | null;
  remainingSspBasis?: string;
  /** SSP of the obligation as modified, measured for the whole obligation. */
  totalModifiedSspCents: Cents | null;
  totalModifiedSspBasis?: string;
  recognitionMethod: RecognitionMethod;
  serviceStart?: IsoDate;
  serviceEnd?: IsoDate;
  recognitionDate?: IsoDate;
  recognitionRationale?: string;
}

/** One approved contract-modification event. Version 1 calculates exactly one. */
export interface ModificationEventInput {
  id: string;
  seq: number;
  /** Effective date D. Historical accounting is immutable through D − 1. */
  modificationDate: IsoDate;
  /** Gating judgment: has the modification been approved and is it enforceable? */
  approvedAndEnforceable: boolean | null;
  approvalRationale?: string;
  scopeChangeDescription: string;
  considerationEffect: ConsiderationEffect;
  /** Non-negative magnitude; the effect supplies the sign. */
  considerationMagnitudeCents: Cents;
  /** ASC 606-10-25-12(b). */
  priceReflectsAddedGoodsSsp: boolean | null;
  priceReflectsSspRationale?: string;
  /** Required only when the derived treatment is "mixed". */
  mixedAllocationPolicy?: MixedAllocationPolicy | null;
  mixedAllocationPolicyRationale?: string;
  /** Original obligations that no longer exist after the modification. */
  removedPoIds?: string[];
  postModificationPerformanceObligations: ModifiedPerformanceObligationInput[];
}

export interface ContractModificationInput {
  /** ORIGINAL contract transaction price (Step 3), integer cents. */
  originalTransactionPriceCents: Cents;
  originalPerformanceObligations: PerformanceObligationInput[];
  hasContractModifications: boolean;
  contractModifications: ModificationEventInput[];
}

/** Signed change in fixed consideration derived from the accountant's effect. */
export function signedConsiderationChangeCents(event: ModificationEventInput): Cents {
  if (event.considerationEffect === "none") return 0;
  const magnitude = Math.abs(event.considerationMagnitudeCents);
  return event.considerationEffect === "decrease" ? -magnitude : magnitude;
}

/** The single event Version 1 calculates, or null when unsupported/absent. */
export function soleModificationEvent(
  input: ContractModificationInput,
): ModificationEventInput | null {
  if (!input.hasContractModifications) return null;
  if (input.contractModifications.length !== 1) return null;
  return input.contractModifications[0] ?? null;
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export interface SeparateContractCriterion {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface ModificationClassification {
  treatment: ModificationTreatment;
  label: string;
  /** ASC 606-10-25-12 criterion (a), derived from the added obligations. */
  addsDistinctGoodsOrServices: boolean;
  /** ASC 606-10-25-12 criterion (b). */
  priceReflectsStandaloneSellingPrices: boolean;
  /** True when every remaining good or service is distinct. */
  allRemainingGoodsDistinct: boolean;
  /** True when no remaining good or service is distinct. */
  noRemainingGoodsDistinct: boolean;
  /** ASC 606-10-25-12 test outcome, every criterion, and the failed ones. */
  separateContractTestPassed: boolean;
  separateContractCriteria: SeparateContractCriterion[];
  separateContractFailures: string[];
  rationale: string;
  mixedAllocationPolicy: MixedAllocationPolicy | null;
  mixedAllocationPolicyRationale: string | null;
  approvedAndEnforceable: boolean;
  approvalRationale: string | null;
}

export type ModificationAllocationBasis =
  | "added_goods_remaining_ssp"
  | "remaining_ssp"
  | "total_modified_ssp";

export interface ModificationAllocationLayer {
  basis: ModificationAllocationBasis;
  label: string;
  /** Accountant evidence supporting the standalone selling prices used. */
  sspEvidence: { poId: string; name: string; sspCents: Cents; basis: string | null }[];
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
  /** Accountant-facing obligation name; never an opaque ID. */
  poName: string;
  sourcePoId: string;
  sourceId: string;
  effectiveDate: IsoDate;
  month: MonthKey;
  /** Entitlement the revised measure of progress is applied to. */
  entitlementBasisCents: Cents;
  progressDays: number;
  totalDays: number;
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
  kind: "original" | "historical" | "separate_contract" | "prospective" | "catch_up" | "mixed";
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
  /** Prospective / mixed remaining-price pool; null otherwise. */
  remainingTransactionPriceCents: Cents | null;
  /** Catch-up / mixed total-price base; null otherwise. */
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
  /** The event that was accounted for; null when blocked. */
  event: ModificationEventInput | null;
  /** Day before the effective date; null when blocked. */
  historicalCutoffDate: IsoDate | null;
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
