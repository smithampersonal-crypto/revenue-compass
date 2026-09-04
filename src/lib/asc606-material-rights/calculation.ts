/**
 * Deterministic material-right measurement.
 *
 * Estimated material-right SSP = economic benefit x exercise probability,
 * using the engine's canonical exact half-up ratio rule. No floating-point
 * accounting arithmetic: the probability is carried as integer basis points.
 */

import { proportionOfCents, type Cents } from "@/lib/asc606";
import { BPS_SCALE, type BasisPoints } from "./types";

export { BPS_SCALE };

/**
 * Estimated standalone selling price of a material right.
 * $24,000.00 x 80.00% = $19,200.00.
 */
export function materialRightSspCents(
  benefitAmountCents: Cents,
  exerciseProbabilityBps: BasisPoints,
  label = "material-right SSP",
): Cents {
  return proportionOfCents(benefitAmountCents, exerciseProbabilityBps, BPS_SCALE, label);
}

/** Display helper only (presentation, never accounting): 8000 -> "80.00%". */
export function formatBasisPoints(bps: BasisPoints): string {
  const negative = bps < 0;
  const abs = Math.abs(bps);
  return `${negative ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}%`;
}
