/** Fictional Phase 5C acceptance contracts (Cases 9-12). No real customers. */

import type { PerformanceObligationInput } from "@/lib/asc606";

import type {
  ContractModificationInput,
  MixedAllocationPolicy,
  ModifiedPerformanceObligationInput,
} from "../types";

const overTime = (
  id: string,
  seq: number,
  name: string,
  sspCents: number,
  serviceStart: string,
  serviceEnd: string,
): PerformanceObligationInput => ({
  id,
  seq,
  name,
  sspCents,
  recognitionMethod: "over_time_ratable",
  serviceStart,
  serviceEnd,
});

const pointInTime = (
  id: string,
  seq: number,
  name: string,
  sspCents: number,
  recognitionDate: string,
): PerformanceObligationInput => ({
  id,
  seq,
  name,
  sspCents,
  recognitionMethod: "point_in_time",
  recognitionDate,
});

const EVIDENCE = "Observable standalone renewal pricing for comparable customers.";

/** Case 9 — separate contract: 50 added seats priced at their SSP. */
export function case9SeparateContract(): ContractModificationInput {
  return {
    originalTransactionPriceCents: 24_000_000,
    originalPerformanceObligations: [
      overTime(
        "po-saas",
        1,
        "SaaS subscription (100 seats)",
        24_000_000,
        "2027-01-01",
        "2028-12-31",
      ),
    ],
    hasContractModifications: true,
    contractModifications: [
      {
        id: "mod-1",
        seq: 1,
        modificationDate: "2027-07-01",
        approvedAndEnforceable: true,
        approvalRationale: "Countersigned order form dated 2027-06-20.",
        scopeChangeDescription: "50 additional seats",
        considerationEffect: "increase",
        considerationMagnitudeCents: 9_000_000,
        priceReflectsAddedGoodsSsp: true,
        priceReflectsSspRationale: "The added seats are priced at the published per-seat rate.",
        postModificationPerformanceObligations: [
          {
            id: "po-saas",
            seq: 1,
            name: "SaaS subscription (100 seats)",
            status: "continuing",
            sourcePoId: "po-saas",
            scopeEffect: "unchanged",
            addedGoodsAreDistinct: null,
            remainingGoodsDistinctFromTransferred: true,
            remainingSspCents: 12_000_000,
            remainingSspBasis: EVIDENCE,
            totalModifiedSspCents: 24_000_000,
            totalModifiedSspBasis: EVIDENCE,
            recognitionMethod: "over_time_ratable",
            serviceStart: "2027-07-01",
            serviceEnd: "2028-12-31",
          },
          {
            id: "po-added-seats",
            seq: 2,
            name: "SaaS subscription (50 added seats)",
            status: "added",
            sourcePoId: null,
            scopeEffect: null,
            addedGoodsAreDistinct: true,
            addedGoodsDistinctnessRationale: "The added seats are separately beneficial.",
            remainingGoodsDistinctFromTransferred: true,
            remainingSspCents: 9_000_000,
            remainingSspBasis: EVIDENCE,
            totalModifiedSspCents: 9_000_000,
            totalModifiedSspBasis: EVIDENCE,
            recognitionMethod: "over_time_ratable",
            serviceStart: "2027-07-01",
            serviceEnd: "2028-12-31",
          },
        ],
      },
    ],
  };
}

/** Case 10 — prospective: added distinct seats priced below SSP. */
export function case10Prospective(): ContractModificationInput {
  return {
    originalTransactionPriceCents: 12_000_000,
    originalPerformanceObligations: [
      overTime(
        "po-saas",
        1,
        "SaaS subscription (100 seats)",
        12_000_000,
        "2028-01-01",
        "2028-12-31",
      ),
    ],
    hasContractModifications: true,
    contractModifications: [
      {
        id: "mod-1",
        seq: 1,
        modificationDate: "2028-07-02",
        approvedAndEnforceable: true,
        approvalRationale: "Countersigned amendment dated 2028-06-25.",
        scopeChangeDescription: "50 additional seats at a discount",
        considerationEffect: "increase",
        considerationMagnitudeCents: 1_800_000,
        priceReflectsAddedGoodsSsp: false,
        priceReflectsSspRationale: "The added seats are discounted below their standalone price.",
        postModificationPerformanceObligations: [
          {
            id: "mpo-saas",
            seq: 1,
            name: "SaaS subscription (100 seats)",
            status: "continuing",
            sourcePoId: "po-saas",
            scopeEffect: "unchanged",
            addedGoodsAreDistinct: null,
            remainingGoodsDistinctFromTransferred: true,
            remainingDistinctnessRationale: "Each remaining service day is distinct.",
            remainingSspCents: 6_000_000,
            remainingSspBasis: EVIDENCE,
            totalModifiedSspCents: 12_000_000,
            totalModifiedSspBasis: EVIDENCE,
            recognitionMethod: "over_time_ratable",
            serviceStart: "2028-07-02",
            serviceEnd: "2028-12-31",
          },
          {
            id: "mpo-added-seats",
            seq: 2,
            name: "SaaS subscription (50 added seats)",
            status: "added",
            sourcePoId: null,
            scopeEffect: null,
            addedGoodsAreDistinct: true,
            addedGoodsDistinctnessRationale: "The added seats are separately beneficial.",
            remainingGoodsDistinctFromTransferred: true,
            remainingDistinctnessRationale: "The added seats are distinct from service already transferred.",
            remainingSspCents: 3_000_000,
            remainingSspBasis: EVIDENCE,
            totalModifiedSspCents: 3_000_000,
            totalModifiedSspBasis: EVIDENCE,
            recognitionMethod: "over_time_ratable",
            serviceStart: "2028-07-02",
            serviceEnd: "2028-12-31",
          },
        ],
      },
    ],
  };
}

/** Case 11 — cumulative catch-up on a single non-distinct obligation. */
export function case11CatchUp(modifiedTotalCents = 15_000_000): ContractModificationInput {
  const change = modifiedTotalCents - 12_000_000;
  return {
    originalTransactionPriceCents: 12_000_000,
    originalPerformanceObligations: [
      overTime("po-saas", 1, "Managed implementation", 12_000_000, "2028-01-01", "2028-12-31"),
    ],
    hasContractModifications: true,
    contractModifications: [
      {
        id: "mod-1",
        seq: 1,
        modificationDate: "2028-07-02",
        approvedAndEnforceable: true,
        approvalRationale: "Countersigned change order dated 2028-06-28.",
        scopeChangeDescription: "Expanded scope of the same implementation",
        considerationEffect: change === 0 ? "none" : change > 0 ? "increase" : "decrease",
        considerationMagnitudeCents: Math.abs(change),
        priceReflectsAddedGoodsSsp: false,
        postModificationPerformanceObligations: [
          {
            id: "mpo-saas",
            seq: 1,
            name: "Managed implementation",
            status: "continuing",
            sourcePoId: "po-saas",
            scopeEffect: "increase",
            addedGoodsAreDistinct: null,
            remainingGoodsDistinctFromTransferred: false,
            remainingDistinctnessRationale:
              "The expanded work is part of the same integrated implementation service.",
            remainingSspCents: 6_000_000,
            remainingSspBasis: EVIDENCE,
            totalModifiedSspCents: modifiedTotalCents,
            totalModifiedSspBasis: EVIDENCE,
            recognitionMethod: "over_time_ratable",
            serviceStart: "2028-01-01",
            serviceEnd: "2028-12-31",
          },
        ],
      },
    ],
  };
}

/** Case 12 — mixed modification under the selected allocation policy. */
export function case12Mixed(policy: MixedAllocationPolicy): ContractModificationInput {
  const postModificationPerformanceObligations: ModifiedPerformanceObligationInput[] = [
    {
      id: "mpo-implementation",
      seq: 1,
      name: "Managed implementation",
      status: "continuing",
      sourcePoId: "po-implementation",
      scopeEffect: "increase",
      addedGoodsAreDistinct: null,
      remainingGoodsDistinctFromTransferred: false,
      remainingDistinctnessRationale:
        "The expanded work is part of the same integrated implementation service.",
      remainingSspCents: 12_000_000,
      remainingSspBasis: EVIDENCE,
      totalModifiedSspCents: 18_000_000,
      totalModifiedSspBasis: EVIDENCE,
      recognitionMethod: "over_time_ratable",
      serviceStart: "2028-01-01",
      serviceEnd: "2028-12-31",
    },
    {
      id: "mpo-training",
      seq: 2,
      name: "Onsite training",
      status: "continuing",
      sourcePoId: "po-training",
      scopeEffect: "unchanged",
      addedGoodsAreDistinct: null,
      remainingGoodsDistinctFromTransferred: true,
      remainingDistinctnessRationale: "The training session is distinct from work already performed.",
      remainingSspCents: 8_000_000,
      remainingSspBasis: EVIDENCE,
      totalModifiedSspCents: 8_000_000,
      totalModifiedSspBasis: EVIDENCE,
      recognitionMethod: "point_in_time",
      recognitionDate: "2028-10-01",
    },
    {
      id: "mpo-support",
      seq: 3,
      name: "Premium support onboarding",
      status: "added",
      sourcePoId: null,
      scopeEffect: null,
      addedGoodsAreDistinct: true,
      addedGoodsDistinctnessRationale: "Support onboarding is separately beneficial.",
      remainingGoodsDistinctFromTransferred: true,
      remainingDistinctnessRationale: "Support onboarding is distinct from work already performed.",
      remainingSspCents: 4_000_000,
      remainingSspBasis: EVIDENCE,
      totalModifiedSspCents: 4_000_000,
      totalModifiedSspBasis: EVIDENCE,
      recognitionMethod: "point_in_time",
      recognitionDate: "2028-11-01",
    },
  ];

  return {
    originalTransactionPriceCents: 20_000_000,
    originalPerformanceObligations: [
      overTime(
        "po-implementation",
        1,
        "Managed implementation",
        12_000_000,
        "2028-01-01",
        "2028-12-31",
      ),
      pointInTime("po-training", 2, "Onsite training", 8_000_000, "2028-10-01"),
    ],
    hasContractModifications: true,
    contractModifications: [
      {
        id: "mod-1",
        seq: 1,
        modificationDate: "2028-07-02",
        approvedAndEnforceable: true,
        approvalRationale: "Countersigned change order dated 2028-06-30.",
        scopeChangeDescription: "Expanded implementation plus premium support onboarding",
        priceReflectsSspRationale:
          "The combined price change does not equal the standalone selling price of the added onboarding.",
        considerationEffect: "increase",
        considerationMagnitudeCents: 5_000_000,
        priceReflectsAddedGoodsSsp: false,
        mixedAllocationPolicy: policy,
        mixedAllocationPolicyRationale: "Documented entity policy for mixed modifications.",
        postModificationPerformanceObligations,
      },
    ],
  };
}
