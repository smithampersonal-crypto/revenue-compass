/**
 * Phase 5C classification — ASC 606-10-25-12 / 25-13 treatment derivation only.
 *
 * The ASC 606 modification treatment is DERIVED from the accountant's
 * judgments and is never selected in the user interface.
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

function considerationEffect(input: ContractModificationInput): "increase" | "decrease" | "none" {
  const explicit = input.modification.considerationEffect;
  if (explicit) return explicit;
  const change = input.modification.considerationChangeCents;
  return change > 0 ? "increase" : change < 0 ? "decrease" : "none";
}

/**
 * ASC 606-10-25-12 separate-contract test.
 *
 * A modification is a separate contract ONLY when every criterion below holds.
 * Two global Yes/No judgments are not sufficient: a price-only change, a scope
 * decrease, a removal of original goods or services, or a reconfiguration of
 * continuing scope each disqualify separate treatment even when the accountant
 * answered "adds distinct goods" and "priced at SSP" affirmatively.
 */
export function separateContractTest(input: ContractModificationInput): {
  passed: boolean;
  failures: string[];
} {
  const mod = input.modification;
  const active = activeModifiedPos(input);
  const added = active.filter((po) => po.status === "added");
  const continuing = active.filter((po) => po.status === "continuing");
  const failures: string[] = [];

  if (considerationEffect(input) !== "increase") {
    failures.push(
      "The consideration did not increase, so the modification cannot be a separate contract.",
    );
  }
  if (mod.considerationChangeCents <= 0) {
    failures.push("The change in consideration is not a positive amount.");
  }
  if (added.length === 0) {
    failures.push(
      "No performance obligation was added, so there is no separate contract to account for.",
    );
  }
  if (!mod.addsDistinctGoodsOrServices || added.some((po) => !po.remainingGoodsDistinct)) {
    failures.push("Not every added good or service is distinct.");
  }
  if (continuing.some((po) => (po.scopeEffect ?? "unchanged") !== "unchanged")) {
    failures.push(
      "A continuing performance obligation was repriced or reconfigured, so the remaining original scope is affected.",
    );
  }
  if ((mod.removedPoIds?.length ?? 0) > 0) {
    failures.push("An original good or service was removed by the modification.");
  }
  if (!mod.priceReflectsStandaloneSellingPrices) {
    failures.push(
      "The price increase does not reflect the standalone selling prices of the added goods and services.",
    );
  }

  return { passed: failures.length === 0, failures };
}

export function deriveModificationTreatment(
  input: ContractModificationInput,
): ModificationTreatment {
  if (separateContractTest(input).passed) return "separate_contract";

  // The separate-contract test failed: route the ACTIVE affected obligations by
  // the distinctness of their remaining performance. Series obligations are
  // governed by the distinctness of the underlying remaining services, which is
  // exactly the judgment recorded on each obligation.
  const active = activeModifiedPos(input);
  const distinctCount = active.filter((po) => po.remainingGoodsDistinct).length;
  if (active.length > 0 && distinctCount === active.length) return "prospective";
  if (distinctCount === 0) return "cumulative_catch_up";
  return "mixed";
}

export function classifyModification(input: ContractModificationInput): ModificationClassification {
  const test = separateContractTest(input);
  const treatment = deriveModificationTreatment(input);
  const active = activeModifiedPos(input);
  const distinctCount = active.filter((po) => po.remainingGoodsDistinct).length;
  const allRemainingGoodsDistinct = active.length > 0 && distinctCount === active.length;
  const noRemainingGoodsDistinct = distinctCount === 0;

  const rationale =
    treatment === "separate_contract"
      ? "The modification adds distinct goods or services, leaves the remaining original scope unchanged, and the price increase reflects their standalone selling prices, so it is accounted for as a separate contract."
      : treatment === "prospective"
        ? `The separate-contract test was not met (${test.failures[0]}) and the remaining goods and services are all distinct from those transferred before the modification, so the remaining consideration is allocated prospectively.`
        : treatment === "cumulative_catch_up"
          ? `The separate-contract test was not met (${test.failures[0]}) and no remaining good or service is distinct from those already transferred, so the modification is accounted for as part of the existing contract with a cumulative catch-up adjustment.`
          : `The separate-contract test was not met (${test.failures[0]}) and some remaining goods and services are distinct while others are not, so the modification is accounted for on a combined basis.`;

  return {
    treatment,
    label: MODIFICATION_TREATMENT_LABELS[treatment],
    addsDistinctGoodsOrServices: input.modification.addsDistinctGoodsOrServices,
    priceReflectsStandaloneSellingPrices: input.modification.priceReflectsStandaloneSellingPrices,
    allRemainingGoodsDistinct,
    noRemainingGoodsDistinct,
    separateContractTestPassed: test.passed,
    separateContractFailures: test.failures,
    rationale,
    mixedAllocationPolicy:
      treatment === "mixed" ? (input.modification.mixedAllocationPolicy ?? null) : null,
  };
}
