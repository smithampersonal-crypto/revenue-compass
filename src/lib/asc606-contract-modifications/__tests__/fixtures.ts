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
    modification: {
      id: "mod-1",
      effectiveDate: "2027-07-01",
      description: "50 additional seats",
      considerationChangeCents: 9_000_000,
      addsDistinctGoodsOrServices: true,
      priceReflectsStandaloneSellingPrices: true,
      separateContractRationale: "The added seats are priced at their standalone selling price.",
      modifiedPerformanceObligations: [
        {
          id: "po-saas",
          seq: 1,
          name: "SaaS subscription (100 seats)",
          status: "continuing",
          sourcePoId: "po-saas",
          remainingGoodsDistinct: true,
          remainingSspCents: 12_000_000,
          totalModifiedSspCents: 24_000_000,
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
          remainingGoodsDistinct: true,
          remainingSspCents: 9_000_000,
          totalModifiedSspCents: 9_000_000,
          recognitionMethod: "over_time_ratable",
          serviceStart: "2027-07-01",
          serviceEnd: "2028-12-31",
        },
      ],
    },
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
    modification: {
      id: "mod-1",
      effectiveDate: "2028-07-02",
      description: "50 additional seats at a discount",
      considerationChangeCents: 1_800_000,
      addsDistinctGoodsOrServices: true,
      priceReflectsStandaloneSellingPrices: false,
      modifiedPerformanceObligations: [
        {
          id: "mpo-saas",
          seq: 1,
          name: "SaaS subscription (100 seats)",
          status: "continuing",
          sourcePoId: "po-saas",
          remainingGoodsDistinct: true,
          remainingSspCents: 6_000_000,
          totalModifiedSspCents: 12_000_000,
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
          remainingGoodsDistinct: true,
          remainingSspCents: 3_000_000,
          totalModifiedSspCents: 3_000_000,
          recognitionMethod: "over_time_ratable",
          serviceStart: "2028-07-02",
          serviceEnd: "2028-12-31",
        },
      ],
    },
  };
}

/** Case 11 — cumulative catch-up on a single non-distinct obligation. */
export function case11CatchUp(modifiedTotalCents = 15_000_000): ContractModificationInput {
  return {
    originalTransactionPriceCents: 12_000_000,
    originalPerformanceObligations: [
      overTime("po-saas", 1, "Managed implementation", 12_000_000, "2028-01-01", "2028-12-31"),
    ],
    modification: {
      id: "mod-1",
      effectiveDate: "2028-07-02",
      description: "Expanded scope of the same implementation",
      considerationChangeCents: modifiedTotalCents - 12_000_000,
      addsDistinctGoodsOrServices: false,
      priceReflectsStandaloneSellingPrices: false,
      modifiedPerformanceObligations: [
        {
          id: "mpo-saas",
          seq: 1,
          name: "Managed implementation",
          status: "continuing",
          sourcePoId: "po-saas",
          remainingGoodsDistinct: false,
          remainingSspCents: 6_000_000,
          totalModifiedSspCents: modifiedTotalCents,
          recognitionMethod: "over_time_ratable",
          serviceStart: "2028-01-01",
          serviceEnd: "2028-12-31",
        },
      ],
    },
  };
}

/** Case 12 — mixed modification under the selected allocation policy. */
export function case12Mixed(policy: MixedAllocationPolicy): ContractModificationInput {
  const modifiedPerformanceObligations: ModifiedPerformanceObligationInput[] = [
    {
      id: "mpo-implementation",
      seq: 1,
      name: "Managed implementation",
      status: "continuing",
      sourcePoId: "po-implementation",
      remainingGoodsDistinct: false,
      remainingSspCents: 12_000_000,
      totalModifiedSspCents: 18_000_000,
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
      remainingGoodsDistinct: true,
      remainingSspCents: 8_000_000,
      totalModifiedSspCents: 8_000_000,
      recognitionMethod: "point_in_time",
      recognitionDate: "2028-10-01",
    },
    {
      id: "mpo-support",
      seq: 3,
      name: "Premium support onboarding",
      status: "added",
      sourcePoId: null,
      remainingGoodsDistinct: true,
      remainingSspCents: 4_000_000,
      totalModifiedSspCents: 4_000_000,
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
    modification: {
      id: "mod-1",
      effectiveDate: "2028-07-02",
      description: "Expanded implementation plus premium support onboarding",
      considerationChangeCents: 5_000_000,
      addsDistinctGoodsOrServices: true,
      priceReflectsStandaloneSellingPrices: false,
      mixedAllocationPolicy: policy,
      modifiedPerformanceObligations,
    },
  };
}
