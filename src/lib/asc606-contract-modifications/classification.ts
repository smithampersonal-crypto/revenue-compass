/**
 * Phase 5C classification — the ASC 606 modification treatment is DERIVED
 * from the accountant's judgments and never selected in the user interface.
 */

import type {
  ContractModificationInput,
  ModificationClassification,
  ModificationTreatment,
} from "./types";
import { MODIFICATION_TREATMENT_LABELS } from "./types";

/** Obligations that exist after the modification (continuing or added). */
export function activeModifiedPos(input: ContractModificationInput) {
  return [...input.modification.modifiedPerformanceObligations].sort((a, b) => a.seq - b.seq);
}

export function deriveModificationTreatment(input: ContractModificationInput): ModificationTreatment {
  const { addsDistinctGoodsOrServices, priceReflectsStandaloneSellingPrices } = input.modification;
  if (addsDistinctGoodsOrServices && priceReflectsStandaloneSellingPrices) {
    return "separate_contract";
  }
  const active = activeModifiedPos(input);
  const distinctCount = active.filter((po) => po.remainingGoodsDistinct).length;
  if (active.length > 0 && distinctCount === active.length) return "prospective";
  if (distinctCount === 0) return "cumulative_catch_up";
  return "mixed";
}

export function classifyModification(input: ContractModificationInput): ModificationClassification {
  const treatment = deriveModificationTreatment(input);
  const active = activeModifiedPos(input);
  const distinctCount = active.filter((po) => po.remainingGoodsDistinct).length;
  const allRemainingGoodsDistinct = active.length > 0 && distinctCount === active.length;
  const noRemainingGoodsDistinct = distinctCount === 0;

  const rationale =
    treatment === "separate_contract"
      ? "The modification adds distinct goods or services and the price increase reflects their standalone selling prices, so it is accounted for as a separate contract."
      : treatment === "prospective"
        ? "The remaining goods and services are all distinct from those transferred before the modification, so the remaining consideration is allocated prospectively."
        : treatment === "cumulative_catch_up"
          ? "No remaining good or service is distinct from those already transferred, so the modification is accounted for as part of the existing contract with a cumulative catch-up adjustment."
          : "Some remaining goods and services are distinct and some are not, so the modification is accounted for on a combined basis.";

  return {
    treatment,
    label: MODIFICATION_TREATMENT_LABELS[treatment],
    addsDistinctGoodsOrServices: input.modification.addsDistinctGoodsOrServices,
    priceReflectsStandaloneSellingPrices: input.modification.priceReflectsStandaloneSellingPrices,
    allRemainingGoodsDistinct,
    noRemainingGoodsDistinct,
    rationale,
    mixedAllocationPolicy:
      treatment === "mixed" ? (input.modification.mixedAllocationPolicy ?? null) : null,
  };
}
