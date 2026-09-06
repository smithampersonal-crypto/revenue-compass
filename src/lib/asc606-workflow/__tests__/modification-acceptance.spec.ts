/**
 * Phase 5C acceptance — the DIRECTOR-APPROVED Cases 10, 11 and 12 reproduced
 * end to end through the accountant's own data path:
 *
 *   WorkflowDraft → workflow validation → modification adapter → pure engine
 *   → WorkflowAnalysisResult
 *
 * These tests prove that the workflow layer cannot distort the approved
 * accounting. They do not replace the pure-engine acceptance tests.
 *
 * They also prove that the workflow adapter cannot defeat the corrected
 * ASC 606-10-25-12 classifier, and that every mandatory accounting rationale
 * is a real blocking control rather than a decorative field.
 *
 * All companies, customers and amounts are fictional.
 */

import { describe, expect, it } from "vitest";

import { analyzeWorkflow } from "../analysis";
import { validateWorkflow } from "../validation";
import {
  createModificationDraft,
  createModifiedPoDraft,
  createPoDraft,
  createPromiseDraft,
  type ModificationDraft,
  type ModifiedPoDraft,
  type WorkflowDraft,
} from "../types";
import { scenarioADraft } from "./fixtures";

const DOLLARS = (whole: number, cents = 0) => whole * 100 + cents;

/** 2028 is a leap year: 2028-01-01 through 2028-07-01 is exactly half of it. */
const MOD_DATE = "2028-07-02";

/** Original: a single $120,000 obligation across calendar 2028. */
function base120k(): WorkflowDraft {
  const draft = scenarioADraft();
  const po = {
    ...draft.performanceObligations[0]!,
    sspInput: "120,000.00",
    serviceStart: "2028-01-01",
    serviceEnd: "2028-12-31",
  };
  return {
    ...draft,
    transactionPriceInput: "120,000.00",
    performanceObligations: [po],
  };
}

function modificationShell(overrides: Partial<ModificationDraft>): ModificationDraft {
  return {
    ...createModificationDraft(1),
    modificationDate: MOD_DATE,
    approvedAndEnforceable: true,
    approvalRationale: "Countersigned amendment retained in the contract file.",
    scopeChangeDescription: "Recorded change in scope and price.",
    considerationEffect: "increase",
    ...overrides,
  };
}

function continuingPo(overrides: Partial<ModifiedPoDraft>): ModifiedPoDraft {
  return {
    ...createModifiedPoDraft(1, "mod-1-po-1", "continuing"),
    name: "SaaS subscription",
    sourcePoId: "po-saas",
    scopeEffect: "unchanged",
    remainingGoodsDistinctFromTransferred: true,
    remainingDistinctnessRationale: "Each remaining service day is distinct.",
    recognitionMethod: "over_time_ratable",
    serviceStart: MOD_DATE,
    serviceEnd: "2028-12-31",
    recognitionRationale: "Simultaneous receipt and consumption of the hosted service.",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Case 10 — prospective
// ---------------------------------------------------------------------------

function case10Draft(): WorkflowDraft {
  const draft = base120k();
  return {
    ...draft,
    hasContractModifications: true,
    contractModifications: [
      modificationShell({
        scopeChangeDescription: "Added distinct services priced below their standalone price.",
        considerationMagnitudeInput: "18,000.00",
        priceReflectsAddedGoodsSsp: false,
        priceReflectsSspRationale: "The added services are discounted below standalone price.",
        modifiedPerformanceObligations: [
          continuingPo({
            remainingSspInput: "60,000.00",
            remainingSspBasis: "Observable renewal pricing for the remaining term.",
            totalModifiedSspInput: "120,000.00",
            totalModifiedSspBasis: "Observable renewal pricing.",
          }),
          {
            ...createModifiedPoDraft(2, "mod-1-po-2", "added"),
            name: "Added service",
            addedGoodsAreDistinct: true,
            addedGoodsDistinctnessRationale: "Separately beneficial added service.",
            remainingGoodsDistinctFromTransferred: true,
            remainingDistinctnessRationale: "Distinct from the service already transferred.",
            remainingSspInput: "30,000.00",
            remainingSspBasis: "Observable standalone price of the added service.",
            totalModifiedSspInput: "30,000.00",
            totalModifiedSspBasis: "Observable standalone price of the added service.",
            recognitionMethod: "over_time_ratable" as const,
            serviceStart: MOD_DATE,
            serviceEnd: "2028-12-31",
            recognitionRationale: "Simultaneous receipt and consumption.",
          },
        ],
      }),
    ],
  };
}

describe("Case 10 — approved workflow acceptance (prospective)", () => {
  const result = analyzeWorkflow(case10Draft());
  const mod = result.modification!;

  it("finalizes with the approved prospective amounts", () => {
    expect(result.finalized).toBe(true);
    expect(mod.classification?.treatment).toBe("prospective");
    expect(mod.totals.historicalRevenueCents).toBe(DOLLARS(60_000));
    expect(mod.totals.unrecognizedOriginalConsiderationCents).toBe(DOLLARS(60_000));
    expect(mod.totals.remainingTransactionPriceCents).toBe(DOLLARS(78_000));
    expect(mod.totals.catchUpCents).toBe(0);
    expect(mod.totals.lifecycleConsiderationCents).toBe(DOLLARS(138_000));
    expect(mod.reconciliation.reconciled).toBe(true);
  });

  it("allocates the prospective pool $52,000 / $26,000", () => {
    const rows = mod.allocationLayers?.[0]?.rows ?? [];
    expect(rows.map((row) => row.allocatedCents)).toEqual([DOLLARS(52_000), DOLLARS(26_000)]);
  });

  it("presents one contract", () => {
    expect(result.contractGroups).toHaveLength(1);
    expect(mod.groups).toHaveLength(1);
    expect(mod.groups[0]!.id).toBe("contract::original");
  });
});

// ---------------------------------------------------------------------------
// Case 11 — cumulative catch-up
// ---------------------------------------------------------------------------

function case11Draft(totalModifiedSsp: string, effect: "increase" | "decrease"): WorkflowDraft {
  const draft = base120k();
  return {
    ...draft,
    hasContractModifications: true,
    contractModifications: [
      modificationShell({
        scopeChangeDescription: "Repriced the same integrated service.",
        considerationEffect: effect,
        considerationMagnitudeInput: "30,000.00",
        modifiedPerformanceObligations: [
          continuingPo({
            scopeEffect: "reconfigured",
            remainingGoodsDistinctFromTransferred: false,
            remainingDistinctnessRationale: "One integrated service across the whole term.",
            remainingSspInput: totalModifiedSsp,
            remainingSspBasis: "Repriced renewal evidence.",
            totalModifiedSspInput: totalModifiedSsp,
            totalModifiedSspBasis: "Repriced renewal evidence.",
            serviceStart: "2028-01-01",
            serviceEnd: "2028-12-31",
          }),
        ],
      }),
    ],
  };
}

describe("Case 11 — approved workflow acceptance (cumulative catch-up)", () => {
  it("recognizes a +$15,000 catch-up on an increase to $150,000", () => {
    const result = analyzeWorkflow(case11Draft("150,000.00", "increase"));
    const mod = result.modification!;
    expect(result.finalized).toBe(true);
    expect(mod.classification?.treatment).toBe("cumulative_catch_up");
    expect(mod.catchUpEvents[0]!.revisedCumulativeCents).toBe(DOLLARS(75_000));
    expect(mod.totals.catchUpCents).toBe(DOLLARS(15_000));
    expect(mod.totals.futureRevenueCents).toBe(DOLLARS(75_000));
    expect(mod.totals.lifecycleConsiderationCents).toBe(DOLLARS(150_000));
    expect(mod.groups).toHaveLength(1);
    expect(mod.reconciliation.reconciled).toBe(true);
  });

  it("recognizes a -$15,000 catch-up on a decrease to $90,000", () => {
    const result = analyzeWorkflow(case11Draft("90,000.00", "decrease"));
    const mod = result.modification!;
    expect(result.finalized).toBe(true);
    expect(mod.classification?.treatment).toBe("cumulative_catch_up");
    expect(mod.totals.catchUpCents).toBe(-DOLLARS(15_000));
    expect(mod.totals.futureRevenueCents).toBe(DOLLARS(45_000));
    expect(mod.totals.lifecycleConsiderationCents).toBe(DOLLARS(90_000));
    expect(mod.reconciliation.reconciled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Case 12 — mixed
// ---------------------------------------------------------------------------

/**
 * Original $200,000: PO1 ($120,000, calendar 2028) and PO2 ($80,000, delivered
 * entirely after the modification date). Historical revenue is PO1 only.
 */
function case12Draft(
  policy: "updated_total_transaction_price" | "updated_remaining_transaction_price",
): WorkflowDraft {
  const draft = base120k();
  const po1 = {
    ...draft.performanceObligations[0]!,
    sspInput: "120,000.00",
  };
  const po2 = {
    ...createPoDraft(2, "po-second"),
    name: "Second service",
    classification: "single_distinct" as const,
    classificationRationale: "Distinct second service.",
    sspInput: "80,000.00",
    sspBasis: "Observable standalone price.",
    recognitionMethod: "over_time_ratable" as const,
    serviceStart: MOD_DATE,
    serviceEnd: "2028-12-31",
    recognitionRationale: "Simultaneous receipt and consumption.",
  };
  const promise2 = {
    ...createPromiseDraft(2, "pr-second"),
    description: "Second distinct service",
    capableOfBeingDistinct: true,
    distinctWithinContractContext: true,
    distinctRationale: "Separately beneficial.",
    performanceObligationId: po2.id,
  };

  const remainingSsp = policy === "updated_total_transaction_price";
  return {
    ...draft,
    transactionPriceInput: "200,000.00",
    performanceObligations: [po1, po2],
    promises: [...draft.promises, promise2],
    hasContractModifications: true,
    contractModifications: [
      modificationShell({
        scopeChangeDescription: "Expanded the integrated service and added a distinct service.",
        considerationMagnitudeInput: "50,000.00",
        priceReflectsAddedGoodsSsp: false,
        priceReflectsSspRationale: "The added service is not priced at its standalone price.",
        mixedAllocationPolicy: policy,
        mixedAllocationPolicyRationale: "Documented entity policy for mixed modifications.",
        modifiedPerformanceObligations: [
          continuingPo({
            scopeEffect: "increase",
            remainingGoodsDistinctFromTransferred: false,
            remainingDistinctnessRationale: "One integrated service across the whole term.",
            remainingSspInput: "90,000.00",
            remainingSspBasis: "Repriced remaining-term evidence.",
            totalModifiedSspInput: "180,000.00",
            totalModifiedSspBasis: "Repriced whole-obligation evidence.",
            serviceStart: "2028-01-01",
            serviceEnd: "2028-12-31",
          }),
          {
            ...createModifiedPoDraft(2, "mod-1-po-2", "continuing"),
            name: "Second service",
            sourcePoId: "po-second",
            scopeEffect: "unchanged" as const,
            remainingGoodsDistinctFromTransferred: true,
            remainingDistinctnessRationale: "Distinct from the service already transferred.",
            remainingSspInput: "60,000.00",
            remainingSspBasis: "Observable standalone price.",
            totalModifiedSspInput: "80,000.00",
            totalModifiedSspBasis: "Observable standalone price.",
            recognitionMethod: "over_time_ratable" as const,
            serviceStart: MOD_DATE,
            serviceEnd: "2028-12-31",
            recognitionRationale: "Simultaneous receipt and consumption.",
          },
          {
            ...createModifiedPoDraft(3, "mod-1-po-3", "added"),
            name: "Added distinct service",
            addedGoodsAreDistinct: true,
            addedGoodsDistinctnessRationale: "Separately beneficial added service.",
            remainingGoodsDistinctFromTransferred: true,
            remainingDistinctnessRationale: "Distinct from the service already transferred.",
            remainingSspInput: "30,000.00",
            remainingSspBasis: "Observable standalone price.",
            totalModifiedSspInput: "40,000.00",
            totalModifiedSspBasis: "Observable standalone price.",
            recognitionMethod: "over_time_ratable" as const,
            serviceStart: MOD_DATE,
            serviceEnd: "2028-12-31",
            recognitionRationale: "Simultaneous receipt and consumption.",
          },
        ],
      }),
    ],
    // The remaining-price policy layer is exercised by Case 12B only.
    ...(remainingSsp ? {} : {}),
  };
}

describe("Case 12A — approved workflow acceptance (mixed, updated TOTAL price)", () => {
  const result = analyzeWorkflow(case12Draft("updated_total_transaction_price"));
  const mod = result.modification!;

  it("finalizes with the approved mixed amounts", () => {
    expect(result.finalized).toBe(true);
    expect(mod.classification?.treatment).toBe("mixed");
    expect(mod.totals.lifecycleConsiderationCents).toBe(DOLLARS(250_000));
    expect(mod.totals.updatedTotalTransactionPriceCents).toBe(DOLLARS(250_000));
    expect(mod.reconciliation.reconciled).toBe(true);
  });

  it("allocates $150,000 / $66,666.67 / $33,333.33", () => {
    const rows = mod.allocationLayers?.[0]?.rows ?? [];
    expect(rows.map((row) => row.allocatedCents)).toEqual([
      DOLLARS(150_000),
      DOLLARS(66_666, 67),
      DOLLARS(33_333, 33),
    ]);
  });

  it("preserves $60,000 of historical revenue and recognizes a +$15,000 catch-up", () => {
    expect(mod.historical.find((row) => row.poId === "po-saas")?.revenueCents).toBe(
      DOLLARS(60_000),
    );
    expect(mod.totals.catchUpCents).toBe(DOLLARS(15_000));
  });
});

describe("Case 12B — approved workflow acceptance (mixed, updated REMAINING price)", () => {
  const result = analyzeWorkflow(case12Draft("updated_remaining_transaction_price"));
  const mod = result.modification!;

  it("allocates the $190,000 remaining price $95,000 / $63,333.33 / $31,666.67", () => {
    expect(result.finalized).toBe(true);
    expect(mod.totals.remainingTransactionPriceCents).toBe(DOLLARS(190_000));
    const rows = mod.allocationLayers?.[0]?.rows ?? [];
    expect(rows.map((row) => row.allocatedCents)).toEqual([
      DOLLARS(95_000),
      DOLLARS(63_333, 33),
      DOLLARS(31_666, 67),
    ]);
  });

  it("recognizes a +$17,500 catch-up on a $155,000 entitlement basis", () => {
    expect(mod.catchUpEvents[0]!.entitlementBasisCents).toBe(DOLLARS(155_000));
    expect(mod.totals.catchUpCents).toBe(DOLLARS(17_500));
    expect(mod.totals.lifecycleConsiderationCents).toBe(DOLLARS(250_000));
    expect(mod.reconciliation.reconciled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Workflow-level classifier boundaries
// ---------------------------------------------------------------------------

describe("the workflow adapter cannot defeat the ASC 606-10-25-12 classifier", () => {
  /** Added distinct goods priced at SSP — separate contract, unless disqualified. */
  function sspPricedDraft(): WorkflowDraft {
    const draft = case10Draft();
    const mod = draft.contractModifications[0]!;
    draft.contractModifications = [
      {
        ...mod,
        considerationMagnitudeInput: "30,000.00",
        priceReflectsAddedGoodsSsp: true,
        priceReflectsSspRationale: "The added service is priced at its standalone price.",
      },
    ];
    return draft;
  }

  it("is a separate contract when nothing disqualifies it", () => {
    const result = analyzeWorkflow(sspPricedDraft());
    expect(result.modification?.classification?.treatment).toBe("separate_contract");
  });

  it("is NOT a separate contract when a continuing obligation is reconfigured", () => {
    const draft = sspPricedDraft();
    const mod = draft.contractModifications[0]!;
    const [continuing, added] = mod.modifiedPerformanceObligations;
    draft.contractModifications = [
      {
        ...mod,
        modifiedPerformanceObligations: [
          { ...continuing!, scopeEffect: "reconfigured" as const },
          added!,
        ],
      },
    ];
    const result = analyzeWorkflow(draft);
    expect(result.modification?.classification?.treatment).not.toBe("separate_contract");
  });

  it("is NOT a separate contract when a continuing obligation's scope decreases", () => {
    const draft = sspPricedDraft();
    const mod = draft.contractModifications[0]!;
    const [continuing, added] = mod.modifiedPerformanceObligations;
    draft.contractModifications = [
      {
        ...mod,
        modifiedPerformanceObligations: [
          { ...continuing!, scopeEffect: "decrease" as const },
          added!,
        ],
      },
    ];
    const result = analyzeWorkflow(draft);
    expect(result.modification?.classification?.treatment).not.toBe("separate_contract");
  });

  it("is NOT a separate contract when an original obligation is removed", () => {
    const draft = case12Draft("updated_total_transaction_price");
    const mod = draft.contractModifications[0]!;
    draft.contractModifications = [
      {
        ...mod,
        priceReflectsAddedGoodsSsp: true,
        priceReflectsSspRationale: "Priced at standalone price.",
        removedPoIds: ["po-second"],
        modifiedPerformanceObligations: [
          {
            ...mod.modifiedPerformanceObligations[0]!,
            scopeEffect: "unchanged" as const,
            remainingGoodsDistinctFromTransferred: true,
            remainingDistinctnessRationale: "Distinct remaining service.",
          },
          mod.modifiedPerformanceObligations[2]!,
        ],
      },
    ];
    const result = analyzeWorkflow(draft);
    expect(result.modification?.classification?.treatment).not.toBe("separate_contract");
  });
});

// ---------------------------------------------------------------------------
// Rationale and event controls
// ---------------------------------------------------------------------------

function blockedBy(draft: WorkflowDraft) {
  const result = analyzeWorkflow(draft);
  return {
    finalized: result.finalized,
    schedule: result.revenueSchedule,
    issues: validateWorkflow(draft).blocking.map((issue) => issue.id),
  };
}

function mutateMod(draft: WorkflowDraft, patch: Partial<ModificationDraft>): WorkflowDraft {
  return {
    ...draft,
    contractModifications: [{ ...draft.contractModifications[0]!, ...patch }],
  };
}

describe("every mandatory accounting rationale blocks the authoritative analysis", () => {
  it("blocks a blank approval rationale", () => {
    const out = blockedBy(mutateMod(case10Draft(), { approvalRationale: "   " }));
    expect(out.finalized).toBe(false);
    expect(out.schedule).toBeNull();
    expect(out.issues).toContain("modification.approval.rationale");
  });

  it("blocks a blank added-goods distinctness rationale", () => {
    const draft = case10Draft();
    const mod = draft.contractModifications[0]!;
    const out = blockedBy(
      mutateMod(draft, {
        modifiedPerformanceObligations: [
          mod.modifiedPerformanceObligations[0]!,
          { ...mod.modifiedPerformanceObligations[1]!, addedGoodsDistinctnessRationale: "" },
        ],
      }),
    );
    expect(out.finalized).toBe(false);
    expect(out.schedule).toBeNull();
    expect(out.issues).toContain("modification.po.added_distinct_rationale");
  });

  it("blocks a blank remaining-performance distinctness rationale", () => {
    const draft = case10Draft();
    const mod = draft.contractModifications[0]!;
    const out = blockedBy(
      mutateMod(draft, {
        modifiedPerformanceObligations: mod.modifiedPerformanceObligations.map((po) => ({
          ...po,
          remainingDistinctnessRationale: "",
        })),
      }),
    );
    expect(out.finalized).toBe(false);
    expect(out.schedule).toBeNull();
    expect(out.issues).toContain("modification.po.distinct_rationale");
  });

  it("blocks a blank price-reflects-SSP rationale when the criterion is relevant", () => {
    const out = blockedBy(mutateMod(case10Draft(), { priceReflectsSspRationale: "" }));
    expect(out.finalized).toBe(false);
    expect(out.schedule).toBeNull();
    expect(out.issues).toContain("modification.criterion_b.rationale");
  });

  it("blocks a blank mixed-policy rationale", () => {
    const out = blockedBy(
      mutateMod(case12Draft("updated_total_transaction_price"), {
        mixedAllocationPolicyRationale: "",
      }),
    );
    expect(out.finalized).toBe(false);
    expect(out.schedule).toBeNull();
    expect(out.issues).toContain("modification.mixed_policy.rationale");
  });

  it("does not ask a pure scope reduction to answer criterion (b)", () => {
    const draft = base120k();
    const reduced: WorkflowDraft = {
      ...draft,
      hasContractModifications: true,
      contractModifications: [
        modificationShell({
          scopeChangeDescription: "Reduced the remaining term with no added services.",
          considerationEffect: "decrease",
          considerationMagnitudeInput: "20,000.00",
          priceReflectsAddedGoodsSsp: null,
          modifiedPerformanceObligations: [
            continuingPo({
              scopeEffect: "decrease",
              remainingSspInput: "40,000.00",
              remainingSspBasis: "Observable renewal pricing.",
              totalModifiedSspInput: "100,000.00",
              totalModifiedSspBasis: "Observable renewal pricing.",
            }),
          ],
        }),
      ],
    };
    const issues = validateWorkflow(reduced).blocking.map((issue) => issue.id);
    expect(issues).not.toContain("modification.criterion_b");
    expect(issues).not.toContain("modification.criterion_b.rationale");
    expect(analyzeWorkflow(reduced).finalized).toBe(true);
  });

  it("blocks more than one modification event", () => {
    const draft = case10Draft();
    const second: ModificationDraft = {
      ...draft.contractModifications[0]!,
      id: "mod-2",
      seq: 2,
    };
    const out = blockedBy({
      ...draft,
      contractModifications: [draft.contractModifications[0]!, second],
    });
    expect(out.finalized).toBe(false);
    expect(out.schedule).toBeNull();
  });

  it("blocks a reserved '::' identifier collision", () => {
    const draft = case10Draft();
    const mod = draft.contractModifications[0]!;
    const out = blockedBy(
      mutateMod(draft, {
        modifiedPerformanceObligations: [
          { ...mod.modifiedPerformanceObligations[0]!, id: "contract::original" },
          mod.modifiedPerformanceObligations[1]!,
        ],
      }),
    );
    expect(out.finalized).toBe(false);
    expect(out.schedule).toBeNull();
  });

  it("blocks a missing remaining standalone selling price basis", () => {
    const draft = case10Draft();
    const mod = draft.contractModifications[0]!;
    const out = blockedBy(
      mutateMod(draft, {
        modifiedPerformanceObligations: [
          { ...mod.modifiedPerformanceObligations[0]!, remainingSspBasis: "" },
          mod.modifiedPerformanceObligations[1]!,
        ],
      }),
    );
    expect(out.finalized).toBe(false);
    expect(out.schedule).toBeNull();
  });

  it("blocks a missing total-modified standalone selling price basis", () => {
    const draft = case11Draft("150,000.00", "increase");
    const mod = draft.contractModifications[0]!;
    const out = blockedBy(
      mutateMod(draft, {
        modifiedPerformanceObligations: [
          { ...mod.modifiedPerformanceObligations[0]!, totalModifiedSspBasis: "" },
        ],
      }),
    );
    expect(out.finalized).toBe(false);
    expect(out.schedule).toBeNull();
  });
});
