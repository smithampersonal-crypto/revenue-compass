/**
 * Phase 9G-R3 Part 2, Stage E — narrow significant-financing normalization.
 *
 * Scope is deliberately small: annual advance billing alone is not a
 * high-severity finding. R3 does NOT build a present-value engine.
 *
 *  - every transfer-to-payment interval one year or less AND the practical
 *    expedient accepted   -> no financing adjustment is required
 *  - the policy/judgment is not confirmed -> a REVIEW matter, never a reason
 *    to suppress Step 4 or Step 5 output
 *  - a genuine interval longer than one year -> falls outside this narrow
 *    treatment and fails closed for the accountant to handle
 *
 * ARC never invents an accounting-policy election.
 */

import type { CalculationState } from "./types";

export type FinancingConclusion =
  | "no_adjustment_practical_expedient"
  | "policy_not_confirmed"
  | "outside_narrow_treatment";

export interface FinancingInterval {
  id: string;
  label: string;
  /** Days between transfer of control and payment. */
  days: number;
}

export interface SignificantFinancingInput {
  intervals: readonly FinancingInterval[];
  /**
   * The entity's accepted judgment that the ASC 606-10-32-18 one-year
   * practical expedient applies. `null` means not yet confirmed.
   */
  practicalExpedientAccepted: boolean | null;
}

export interface SignificantFinancingAssessment {
  conclusion: FinancingConclusion;
  /** Never blocks Steps 4/5 in R3 — at worst it is a review matter. */
  state: CalculationState;
  adjustmentRequired: boolean;
  /** Intervals longer than one year, if any. */
  longIntervals: FinancingInterval[];
  message: string;
  /** True when the accountant must record or confirm a judgment. */
  reviewRequired: boolean;
}

const ONE_YEAR_DAYS = 365;

export function assessSignificantFinancing(
  input: SignificantFinancingInput,
): SignificantFinancingAssessment {
  const longIntervals = input.intervals.filter((interval) => interval.days > ONE_YEAR_DAYS);

  if (longIntervals.length > 0) {
    return {
      conclusion: "outside_narrow_treatment",
      state: "blocked",
      adjustmentRequired: true,
      longIntervals,
      message:
        "At least one interval between transfer and payment exceeds one year, so the practical expedient cannot be applied without further analysis.",
      reviewRequired: true,
    };
  }

  if (input.practicalExpedientAccepted === true) {
    return {
      conclusion: "no_adjustment_practical_expedient",
      state: "complete",
      adjustmentRequired: false,
      longIntervals: [],
      message:
        "Every interval between transfer of control and payment is one year or less and the practical expedient has been accepted, so no financing adjustment is required.",
      reviewRequired: false,
    };
  }

  return {
    conclusion: "policy_not_confirmed",
    state: "provisional",
    adjustmentRequired: false,
    longIntervals: [],
    message:
      "Every interval between transfer of control and payment is one year or less. Confirm whether the practical expedient is applied; no financing adjustment is calculated in the meantime.",
    reviewRequired: true,
  };
}
