/**
 * Phase 5C classification — ASC 606-10-25-12 / 25-13 treatment derivation only.
 *
 * The ASC 606 modification treatment is DERIVED from the accountant's
 * judgments and is never selected in the user interface.
 */

import type {
  ModificationClassification,
  ModificationEventInput,
  ModificationTreatment,
  ModifiedPerformanceObligationInput,
  SeparateContractCriterion,
} from "./types";
import { MODIFICATION_TREATMENT_LABELS, signedConsiderationChangeCents } from "./types";

/** Obligations that exist after the modification (continuing or added). */
export function activeModifiedPos(
  event: ModificationEventInput,
): ModifiedPerformanceObligationInput[] {
  return [...event.postModificationPerformanceObligations].sort((a, b) => a.seq - b.seq);
}

/** ASC 606-10-25-12(a), derived from the per-obligation added-goods judgments. */
export function addsDistinctGoodsOrServices(event: ModificationEventInput): boolean {
  const added = activeModifiedPos(event).filter((po) => po.status === "added");
  return added.length > 0 && added.every((po) => po.addedGoodsAreDistinct === true);
}

/**
 * ASC 606-10-25-12 separate-contract test.
 *
 * A modification is a separate contract ONLY when every criterion below holds.
 * Two global Yes/No judgments are not sufficient: a price-only change, a scope
 * decrease, a removal of original goods or services, or a reconfiguration of
 * continuing scope each disqualify separate treatment even when the accountant
 * concluded that distinct goods were added at their standalone selling prices.
 */
export function separateContractTest(event: ModificationEventInput): {
  passed: boolean;
  criteria: SeparateContractCriterion[];
  failures: string[];
} {
  const active = activeModifiedPos(event);
  const added = active.filter((po) => po.status === "added");
  const continuing = active.filter((po) => po.status === "continuing");
  const change = signedConsiderationChangeCents(event);
  const criteria: SeparateContractCriterion[] = [];

  const record = (id: string, label: string, passed: boolean, detail: string) =>
    criteria.push({ id, label, passed, detail });

  record(
    "added_scope",
    "The modification adds goods or services to the contract's scope.",
    added.length > 0,
    added.length > 0
      ? `${added.length} performance obligation(s) were added.`
      : "No performance obligation was added, so there is no separate contract to account for.",
  );
  record(
    "added_distinct",
    "Every added good or service is distinct (ASC 606-10-25-12(a)).",
    addsDistinctGoodsOrServices(event),
    addsDistinctGoodsOrServices(event)
      ? "Each added good or service was judged distinct."
      : "Not every added good or service is distinct.",
  );
  record(
    "consideration_increase",
    "The consideration increases by a positive amount.",
    event.considerationEffect === "increase" && change > 0,
    event.considerationEffect === "increase" && change > 0
      ? "The consideration increased."
      : "The consideration did not increase, so the modification cannot be a separate contract.",
  );
  record(
    "price_reflects_ssp",
    "The price increase reflects the standalone selling prices of the added goods or services (ASC 606-10-25-12(b)).",
    event.priceReflectsAddedGoodsSsp === true,
    event.priceReflectsAddedGoodsSsp === true
      ? "The price increase reflects the standalone selling prices of the added goods and services."
      : "The price increase does not reflect the standalone selling prices of the added goods and services.",
  );
  const noRemovals = (event.removedPoIds?.length ?? 0) === 0;
  record(
    "no_removals",
    "No original good or service is removed.",
    noRemovals,
    noRemovals
      ? "No original good or service was removed."
      : "An original good or service was removed by the modification.",
  );
  const scopeUnchanged = continuing.every((po) => po.scopeEffect === "unchanged");
  record(
    "continuing_scope_unchanged",
    "The remaining original scope is unchanged.",
    scopeUnchanged,
    scopeUnchanged
      ? "Every continuing obligation keeps its original scope and price."
      : "A continuing performance obligation was repriced or reconfigured, so the remaining original scope is affected.",
  );

  const failures = criteria.filter((c) => !c.passed).map((c) => c.detail);
  return { passed: failures.length === 0, criteria, failures };
}

export function deriveModificationTreatment(event: ModificationEventInput): ModificationTreatment {
  if (separateContractTest(event).passed) return "separate_contract";

  // The separate-contract test failed: route the ACTIVE affected obligations by
  // the distinctness of their remaining performance. Series obligations are
  // governed by the distinctness of the underlying remaining services, which is
  // exactly the judgment recorded on each obligation.
  const active = activeModifiedPos(event);
  const distinctCount = active.filter((po) => po.remainingGoodsDistinctFromTransferred).length;
  if (active.length > 0 && distinctCount === active.length) return "prospective";
  if (distinctCount === 0) return "cumulative_catch_up";
  return "mixed";
}

export function classifyModification(event: ModificationEventInput): ModificationClassification {
  const test = separateContractTest(event);
  const treatment = deriveModificationTreatment(event);
  const active = activeModifiedPos(event);
  const distinctCount = active.filter((po) => po.remainingGoodsDistinctFromTransferred).length;
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
    addsDistinctGoodsOrServices: addsDistinctGoodsOrServices(event),
    priceReflectsStandaloneSellingPrices: event.priceReflectsAddedGoodsSsp === true,
    allRemainingGoodsDistinct,
    noRemainingGoodsDistinct,
    separateContractTestPassed: test.passed,
    separateContractCriteria: test.criteria,
    separateContractFailures: test.failures,
    rationale,
    mixedAllocationPolicy: treatment === "mixed" ? (event.mixedAllocationPolicy ?? null) : null,
    mixedAllocationPolicyRationale:
      treatment === "mixed" ? (event.mixedAllocationPolicyRationale ?? null) : null,
    approvedAndEnforceable: event.approvedAndEnforceable === true,
    approvalRationale: event.approvalRationale ?? null,
  };
}
