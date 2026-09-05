/**
 * Deterministic measurement of estimated variable consideration.
 *
 * Two methods are supported, exactly as ASC 606-10-32-8 describes them:
 *  - most_likely_amount: the single outcome the accountant selected.
 *  - expected_value: one aggregate rational calculation
 *      sum(amount_i x probability_i) / 10,000
 *    rounded half-up ONCE at the component estimate, never per outcome.
 *
 * Probabilities are integer basis points, so no probability ever travels
 * through floating point. Accountants enter positive magnitudes; the component
 * effect (increase / decrease) supplies the sign deterministically.
 */

import { bigIntToCents, roundRatioHalfUp, type Cents } from "@/lib/asc606";
import { BPS_SCALE } from "@/lib/asc606-material-rights";
import {
  VariableConsiderationError,
  type ConstraintConclusion,
  type EstimatedComponentInput,
  type EstimationMethod,
  type VcAssessmentInput,
  type VcEffect,
  type VcOutcomeInput,
} from "./types";

/** Applies the accountant's increase/decrease judgment to a magnitude. */
export function signedAmount(magnitudeCents: Cents, effect: VcEffect): Cents {
  return effect === "decrease" ? -magnitudeCents : magnitudeCents;
}

/** Exact half-up rounding of a signed proportion; ties round away from zero. */
export function signedProportionOfCents(
  amountCents: Cents,
  numerator: number,
  denominator: number,
  label = "proportion",
): Cents {
  if (!Number.isInteger(numerator) || numerator < 0) {
    throw new VariableConsiderationError(`${label} numerator must be a nonnegative integer`);
  }
  if (!Number.isInteger(denominator) || denominator <= 0) {
    throw new VariableConsiderationError(`${label} denominator must be a positive integer`);
  }
  const negative = amountCents < 0;
  const magnitude = roundRatioHalfUp(
    BigInt(Math.abs(amountCents)) * BigInt(numerator),
    BigInt(denominator),
  );
  return bigIntToCents(negative ? -magnitude : magnitude, label);
}

/**
 * Unconstrained estimate MAGNITUDE for one dated assessment.
 * Throws only on structurally impossible input; validation blocks first.
 */
export function unconstrainedMagnitudeCents(
  assessment: VcAssessmentInput,
  method: EstimationMethod,
  label = "variable consideration",
): Cents {
  const outcomes = assessment.outcomes ?? [];
  if (method === "most_likely_amount") {
    const selected = outcomes.filter((o) => o.isMostLikely === true);
    if (selected.length !== 1) {
      throw new VariableConsiderationError(
        `${label} requires exactly one most-likely outcome (found ${selected.length})`,
      );
    }
    return selected[0]!.amountCents;
  }

  let weighted = 0n;
  for (const outcome of outcomes) {
    const bps = outcome.probabilityBps ?? 0;
    weighted += BigInt(outcome.amountCents) * BigInt(bps);
  }
  // One half-up rounding for the whole component estimate.
  return bigIntToCents(roundRatioHalfUp(weighted, BigInt(BPS_SCALE)), label);
}

/** Total probability of an expected-value assessment, in basis points. */
export function totalProbabilityBps(outcomes: readonly VcOutcomeInput[]): number {
  let total = 0;
  for (const outcome of outcomes) total += outcome.probabilityBps ?? 0;
  return total;
}

/** Derived constraint conclusion; never entered by the accountant. */
export function constraintConclusion(
  unconstrainedMagnitude: Cents,
  includedMagnitude: Cents,
): ConstraintConclusion {
  if (includedMagnitude === 0) return "excluded";
  if (includedMagnitude === unconstrainedMagnitude) return "fully_included";
  return "partially_included";
}

/** Dated assessments of a component in effective order: inception first. */
export function orderedAssessments(component: EstimatedComponentInput): VcAssessmentInput[] {
  return [component.inception, ...(component.remeasurements ?? [])];
}
