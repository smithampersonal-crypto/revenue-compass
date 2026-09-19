/**
 * Phase 9G-R3 — final integrity patch acceptance.
 *
 * Every test starts from a REAL WorkflowDraft and travels the production path
 * (`analyzeWorkflow`, `buildWorkpaper`, `buildFinalizationSnapshot`). No test
 * re-implements accounting arithmetic: each assertion reads a field an accepted
 * engine produced, or compares two production surfaces with each other.
 */

import { describe, expect, it } from "vitest";

import {
  ARC_ENGINE_VERSION,
  buildFinalizationSnapshot,
  buildWorkpaper,
  readReconciliationSnapshot,
} from "@/lib/arc/persistence/snapshot";
import { ARC_WORKFLOW_SCHEMA_VERSION } from "@/lib/arc/persistence/schema";

import { analyzeWorkflow } from "../analysis";
import { draftRequiresProgressive } from "../r3-adapter";
import { createVcComponentDraft, type VcComponentDraft, type WorkflowDraft } from "../types";
import {
  genomixR3Draft,
  withRealizedCredit,
  withSupportHours,
  withValidationTransfer,
  GENOMIX_HOSTED_CENTS,
  GENOMIX_SUPPORT_CENTS,
  GENOMIX_FIXED_CENTS,
} from "./genomix-r3-fixture";

const METADATA = {
  engineVersion: ARC_ENGINE_VERSION,
  schemaVersion: ARC_WORKFLOW_SCHEMA_VERSION,
};

const QUARTERS = [
  { id: "q1", seq: 1, label: "Q1 2027", startDate: "2027-01-01", endDate: "2027-03-31" },
  { id: "q2", seq: 2, label: "Q2 2027", startDate: "2027-04-01", endDate: "2027-06-30" },
  { id: "q3", seq: 3, label: "Q3 2027", startDate: "2027-07-01", endDate: "2027-09-30" },
  { id: "q4", seq: 4, label: "Q4 2027", startDate: "2027-10-01", endDate: "2027-12-31" },
];

function allSupportHours(draft: WorkflowDraft): WorkflowDraft {
  return withSupportHours(draft, [
    { id: "pe-1", seq: 1, date: "2027-03-31", unitsInput: "100" },
    { id: "pe-2", seq: 2, date: "2027-06-30", unitsInput: "100" },
  ]);
}

/** Genomix with every future operational fact resolved. */
function resolvedGenomix(): WorkflowDraft {
  return allSupportHours(withValidationTransfer(genomixR3Draft(), "2027-02-15"));
}

function withBilling(
  draft: WorkflowDraft,
  events: WorkflowDraft["contractBalances"]["considerationEvents"],
): WorkflowDraft {
  return { ...draft, contractBalances: { ...draft.contractBalances, considerationEvents: events } };
}

function withCash(
  draft: WorkflowDraft,
  cashCollections: WorkflowDraft["contractBalances"]["cashCollections"],
): WorkflowDraft {
  return { ...draft, contractBalances: { ...draft.contractBalances, cashCollections } };
}

/* ------------------------------------------------ 1. finalized snapshot -- */

describe("R3: the finalized snapshot records the progressive authority", () => {
  it("copies the progressive transaction price, allocation and revenue", () => {
    const draft = resolvedGenomix();
    const progressive = analyzeWorkflow(draft).progressive!;
    const engine = progressive.reconciliation!;

    const outcome = buildFinalizationSnapshot(draft);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const totals = outcome.reconciliation.totals;
    expect(totals.transactionPriceCents).toBe(engine.transactionPriceCents);
    expect(totals.transactionPriceCents).not.toBeNull();
    expect(totals.allocatedCents).toBe(engine.allocatedCents);
    expect(totals.allocatedCents).not.toBeNull();
    expect(totals.revenueCents).toBe(progressive.recognition!.schedule.totalCents);

    const recorded = outcome.reconciliation.progressive!;
    expect(recorded.reconciled).toBe(true);
    expect(recorded.scheduledRevenueCents).toBe(engine.scheduledRevenueCents);
    expect(recorded.pendingCents).toBe(engine.pendingCents);
    expect(recorded.blockedCents).toBe(engine.blockedCents);
    expect(recorded.unresolvedCents).toBe(engine.unresolvedCents);
  });

  it("survives a JSON round-trip with those exact values", () => {
    const outcome = buildFinalizationSnapshot(resolvedGenomix());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const round = readReconciliationSnapshot(
      JSON.parse(JSON.stringify(outcome.reconciliation)) as unknown,
      METADATA,
    );
    expect(round).not.toBeNull();
    expect(round!.totals.transactionPriceCents).toBe(
      outcome.reconciliation.totals.transactionPriceCents,
    );
    expect(round!.totals.allocatedCents).toBe(outcome.reconciliation.totals.allocatedCents);
    expect(round!.progressive!.reconciled).toBe(true);
  });

  it("records the ADJUSTED price when a service-level credit is realized", () => {
    const draft = withRealizedCredit(resolvedGenomix(), "1,000.00", "q2", "2027-06-30");
    const engine = analyzeWorkflow(draft).progressive!.reconciliation!;
    const outcome = buildFinalizationSnapshot(draft);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.reconciliation.totals.transactionPriceCents).toBe(engine.transactionPriceCents);
    expect(outcome.reconciliation.totals.transactionPriceCents).toBeLessThan(GENOMIX_FIXED_CENTS);
    expect(outcome.reconciliation.totals.allocatedCents).toBe(engine.allocatedCents);
  });
});

/* ------------------------------------- 2. blocked recognition dependency -- */

describe("R3: a blocked recognition amount blocks what depends on it", () => {
  const malformed = (): WorkflowDraft =>
    withSupportHours(withValidationTransfer(genomixR3Draft(), "2027-02-15"), [
      { id: "pe-1", seq: 1, date: "2027-03-31", unitsInput: "one hundred" },
    ]);

  it("keeps the blocked obligation and its allocation visible", () => {
    const progressive = analyzeWorkflow(malformed()).progressive!;
    expect(progressive.recognition!.blocked.map((row) => row.poId)).toContain("po-support");
    expect(progressive.allocation!.find((row) => row.poId === "po-support")!.allocatedCents).toBe(
      GENOMIX_SUPPORT_CENTS,
    );
  });

  it("keeps independently determinable hosted revenue available", () => {
    const progressive = analyzeWorkflow(malformed()).progressive!;
    expect(
      progressive.recognition!.byPo.find((row) => row.poId === "po-hosted")!.scheduledCents,
    ).toBe(GENOMIX_HOSTED_CENTS);
  });

  it("produces no balances or journals from a price that excludes the blocked amount", () => {
    const draft = malformed();
    expect(analyzeWorkflow(draft).progressive!.balances).toBeNull();
    const workpaper = buildWorkpaper(draft);
    expect(workpaper.balances.analysis).toBeNull();
    expect(workpaper.balances.engineInput).toBeNull();
    expect(workpaper.balances.finalized).toBe(false);
    expect(workpaper.journals).toBeNull();
  });

  it("restores balances and journals as soon as the progress fact is corrected", () => {
    const workpaper = buildWorkpaper(resolvedGenomix());
    expect(workpaper.balances.analysis).not.toBeNull();
    expect(workpaper.journals).not.toBeNull();
    expect(workpaper.balances.finalized).toBe(true);
  });

  it("still permits a partial workpaper for a PENDING future fact", () => {
    // Nothing is malformed here: support hours simply have not been incurred.
    const workpaper = buildWorkpaper(genomixR3Draft());
    expect(workpaper.balances.analysis).not.toBeNull();
    expect(workpaper.journals).not.toBeNull();
    expect(workpaper.balances.finalized).toBe(false);
  });
});

/* ----------------------------------- 3. unusable billing and cash facts -- */

describe("R3: an unusable billing or cash fact blocks its dependent output", () => {
  const billingCases: { name: string; invoiceDate: string }[] = [
    { name: "a blank invoice date", invoiceDate: "" },
    { name: "an invalid invoice date", invoiceDate: "31/12/2027" },
  ];

  for (const testCase of billingCases) {
    it(`reports ${testCase.name} and blocks billed-versus-unbilled presentation`, () => {
      const base = resolvedGenomix();
      const draft = withBilling(
        base,
        base.contractBalances.considerationEvents.map((event) =>
          event.id === "bill-1" ? { ...event, invoiceDate: testCase.invoiceDate } : event,
        ),
      );
      const workflow = analyzeWorkflow(draft);
      expect(workflow.progressiveBlocked.map((fact) => fact.code)).toContain(
        "billing.invoice_date",
      );
      expect(workflow.finalized).toBe(false);

      // Allocation and determinable revenue are untouched.
      expect(workflow.allocation).not.toBeNull();
      expect(workflow.revenueSchedule!.totalCents).toBe(
        analyzeWorkflow(base).revenueSchedule!.totalCents,
      );

      const workpaper = buildWorkpaper(draft);
      expect(workpaper.balances.analysis).toBeNull();
      expect(workpaper.balances.finalized).toBe(false);
      expect(workpaper.journals).toBeNull();
      expect(buildFinalizationSnapshot(draft).ok).toBe(false);

      // Correcting only that fact restores the dependent output.
      expect(buildWorkpaper(base).journals).not.toBeNull();
      expect(buildWorkpaper(base).balances.finalized).toBe(true);
    });
  }

  it("never presents an invoice date manufactured from the unconditional-right date", () => {
    const base = resolvedGenomix();
    const draft = withBilling(
      base,
      base.contractBalances.considerationEvents.map((event) => ({ ...event, invoiceDate: "" })),
    );
    const workpaper = buildWorkpaper(draft);
    expect(workpaper.balances.engineInput).toBeNull();
    expect(workpaper.balances.analysis).toBeNull();
    expect(workpaper.journals).toBeNull();
    expect(workpaper.balances.blockedReason).toContain("invoice");
  });

  it("keeps a variable amount billed on realization on its own same-day rule", () => {
    // billOnRealization is a deterministic rule, not a missing fixed-billing
    // invoice date: the realized credit memo still bills and reconciles.
    const draft = withRealizedCredit(resolvedGenomix(), "1,000.00", "q2", "2027-06-30");
    const workflow = analyzeWorkflow(draft);
    expect(workflow.progressiveBlocked.map((fact) => fact.code)).not.toContain(
      "billing.invoice_date",
    );
    expect(buildWorkpaper(draft).journals).not.toBeNull();
  });

  it("blocks when a cash collection names no billing event", () => {
    const base = resolvedGenomix();
    const draft = withCash(base, [
      {
        id: "cash-1",
        seq: 1,
        considerationEventId: "",
        amountInput: "245,000.00",
        collectionDate: "2027-02-10",
        basis: "actual",
      },
    ]);
    const workflow = analyzeWorkflow(draft);
    expect(workflow.progressiveBlocked.map((fact) => fact.code)).toContain(
      "cash_collection.incomplete",
    );
    expect(workflow.allocation).not.toBeNull();
    const workpaper = buildWorkpaper(draft);
    expect(workpaper.balances.analysis).toBeNull();
    expect(workpaper.journals).toBeNull();
    expect(buildWorkpaper(base).balances.finalized).toBe(true);
  });

  it("blocks when a cash amount cannot be read", () => {
    const base = resolvedGenomix();
    const draft = withCash(base, [
      {
        id: "cash-1",
        seq: 1,
        considerationEventId: "bill-1",
        amountInput: "two hundred",
        collectionDate: "2027-02-10",
        basis: "actual",
      },
    ]);
    const workflow = analyzeWorkflow(draft);
    expect(workflow.progressiveBlocked.map((fact) => fact.code)).toContain(
      "cash_collection.incomplete",
    );
    expect(buildWorkpaper(draft).balances.finalized).toBe(false);
    expect(buildWorkpaper(draft).journals).toBeNull();
  });

  it("blocks when a collection date cannot be read", () => {
    const base = resolvedGenomix();
    const draft = withCash(base, [
      {
        id: "cash-1",
        seq: 1,
        considerationEventId: "bill-1",
        amountInput: "245,000.00",
        collectionDate: "10-02-2027",
        basis: "actual",
      },
    ]);
    expect(
      analyzeWorkflow(draft).progressiveBlocked.map((fact) => fact.code),
    ).toContain("cash_collection.incomplete");
    expect(buildWorkpaper(draft).journals).toBeNull();
  });
});

/* ------------------------------------ 4. VC measurement fails closed ----- */

function estimatedBonus(overrides: Partial<VcComponentDraft["inception"]>): VcComponentDraft {
  const base = createVcComponentDraft(1, "vc-bonus", "estimated");
  return {
    ...base,
    description: "Performance bonus",
    effect: "increase",
    estimationMethod: "expected_value",
    allocationTreatment: "specific_series_period",
    targetPoId: "po-hosted",
    relatesSpecifically: true,
    consistentWithAllocationObjective: true,
    allocationRationale: "The bonus relates specifically to the quarter it is earned in.",
    inception: {
      ...base.inception,
      effectiveDate: "2027-01-01",
      includedInput: "5,000.00",
      constraintRationale: "A portion is constrained.",
      ...overrides,
    },
    seriesPeriods: QUARTERS,
    realizedEvents: [],
    billOnRealization: true,
  };
}

function withComponent(draft: WorkflowDraft, component: VcComponentDraft): WorkflowDraft {
  return { ...draft, hasVariableConsideration: true, variableConsiderationComponents: [component] };
}

describe("R3: the accepted VC measurement engine fails closed", () => {
  it("never turns a constrained included amount into the unconstrained estimate", () => {
    const component = estimatedBonus({
      outcomes: [
        {
          id: "o1",
          seq: 1,
          description: "Bonus earned",
          amountInput: "10,000.00",
          probabilityInput: "not a probability",
          isMostLikely: false,
        },
      ],
    });
    const draft = withComponent(resolvedGenomix(), component);
    const workflow = analyzeWorkflow(draft);

    expect(workflow.progressiveBlocked.map((fact) => fact.code)).toContain(
      "vc.measurement.unusable",
    );
    expect(workflow.finalized).toBe(false);
    const layer = workflow.progressive?.vc;
    if (layer) {
      // The estimate is never silently equal to the parseable included amount.
      for (const row of layer.seriesPeriod) expect(row.amountCents).not.toBe(500_000);
    }
  });

  it("does not silently calculate a malformed most-likely assessment", () => {
    const component: VcComponentDraft = {
      ...estimatedBonus({
        outcomes: [
          {
            id: "o1",
            seq: 1,
            description: "Bonus earned",
            amountInput: "10,000.00",
            probabilityInput: "60",
            isMostLikely: false,
          },
        ],
      }),
      estimationMethod: "most_likely_amount",
    };
    const workflow = analyzeWorkflow(withComponent(resolvedGenomix(), component));
    expect(workflow.progressiveBlocked.map((fact) => fact.code)).toContain(
      "vc.measurement.unusable",
    );
    expect(workflow.finalized).toBe(false);
  });

  it("keeps mathematically independent fixed accounting available", () => {
    const component = estimatedBonus({
      outcomes: [
        {
          id: "o1",
          seq: 1,
          description: "Bonus earned",
          amountInput: "10,000.00",
          probabilityInput: "oops",
          isMostLikely: false,
        },
      ],
    });
    const workflow = analyzeWorkflow(withComponent(resolvedGenomix(), component));
    expect(workflow.allocation).not.toBeNull();
    expect(
      workflow.allocation!.find((row) => row.poId === "po-hosted")!.allocatedCents,
    ).toBeGreaterThan(0);
  });

  it("keeps a valid estimate distinct from its constrained included amount", () => {
    const component = estimatedBonus({
      includedInput: "5,000.00",
      outcomes: [
        {
          id: "o1",
          seq: 1,
          description: "Bonus earned",
          amountInput: "10,000.00",
          probabilityInput: "100",
          isMostLikely: true,
        },
      ],
    });
    const workflow = analyzeWorkflow(withComponent(resolvedGenomix(), component));
    expect(workflow.progressiveBlocked.map((fact) => fact.code)).not.toContain(
      "vc.measurement.unusable",
    );
  });
});

/* ------------------------------ 5. duplicate and orphan identity, live --- */

describe("R3: duplicate and orphan identities cannot reach the accounting", () => {
  it("rejects a realized amount pointing at a service period that does not exist", () => {
    const draft = withRealizedCredit(resolvedGenomix(), "1,000.00", "q9", "2027-06-30");
    const workflow = analyzeWorkflow(draft);
    const progressive = workflow.progressive!;

    // The orphan amount is reported and enters NO layer of the accounting.
    expect(progressive.vc.blocked.map((row) => row.code)).toContain(
      "variable_consideration.series.period_unmappable",
    );
    expect(progressive.vc.seriesPeriod).toEqual([]);
    expect(progressive.transactionPriceCents).toBe(GENOMIX_FIXED_CENTS);
    expect(progressive.state).toBe("blocked");
    expect(workflow.finalized).toBe(false);
    expect(buildWorkpaper(draft).balances.finalized).toBe(false);
    expect(buildFinalizationSnapshot(draft).ok).toBe(false);
  });

  it("rejects two realized amounts sharing one identity", () => {
    const base = withRealizedCredit(resolvedGenomix(), "1,000.00", "q2", "2027-06-30");
    const draft: WorkflowDraft = {
      ...base,
      variableConsiderationComponents: base.variableConsiderationComponents.map((component) => ({
        ...component,
        realizedEvents: [
          ...(component.realizedEvents ?? []),
          ...(component.realizedEvents ?? []).map((event) => ({ ...event, seq: 2 })),
        ],
      })),
    };
    const workflow = analyzeWorkflow(draft);
    expect(workflow.progressive).toBeNull();
    expect(workflow.finalized).toBe(false);
    expect(buildWorkpaper(draft).balances.analysis).toBeNull();
  });

  it("owns every recognized amount exactly once, per the engine's own tie-out", () => {
    const progressive = analyzeWorkflow(resolvedGenomix()).progressive!;
    const allocated = new Set(progressive.allocation!.map((row) => row.poId));
    for (const row of progressive.recognition!.byPo) expect(allocated.has(row.poId)).toBe(true);
    expect(progressive.reconciliation!.reconciled).toBe(true);
    for (const row of progressive.reconciliation!.byPo) expect(row.reconciled).toBe(true);
    expect(progressive.reconciliation!.failures).toEqual([]);
  });
});

/* ---------------------------------------------- 6. usage-only routing ---- */

/** A contract whose ONLY possible R3 trigger is its usage rule. */
function usageOnlyDraft(meterExtras: Record<string, string> = {}): WorkflowDraft {
  const base = genomixR3Draft();
  const hosted = base.performanceObligations.find((po) => po.id === "po-hosted")!;
  const component = createVcComponentDraft(1, "vc-usage", "usage_as_incurred");
  return {
    ...base,
    performanceObligations: [{ ...hosted, progressEvents: [] }],
    promises: base.promises.filter((promise) => promise.performanceObligationId === "po-hosted"),
    hasVariableConsideration: true,
    variableConsiderationComponents: [
      {
        ...component,
        description: "Overage API calls",
        effect: "increase",
        allocationTreatment: "general",
        targetPoId: "po-hosted",
        meters: [
          {
            id: "m1",
            seq: 1,
            name: "API calls",
            rateAmountInput: "1.00",
            rateQuantityInput: "100",
            unit: "calls",
            ...meterExtras,
          },
        ],
        seriesPeriods: [],
        realizedEvents: [],
        billOnRealization: false,
      },
    ],
  };
}

describe("R3: usage routing depends only on an R3-owned usage fact", () => {
  it("leaves ordinary usage on its accepted legacy path", () => {
    expect(draftRequiresProgressive(usageOnlyDraft())).toBe(false);
  });

  it("routes progressively for an included quantity, and stops when it is removed", () => {
    expect(draftRequiresProgressive(usageOnlyDraft({ includedQuantityInput: "50" }))).toBe(true);
    expect(draftRequiresProgressive(usageOnlyDraft())).toBe(false);
  });

  it("routes progressively for R3 service periods, and stops when they are removed", () => {
    const base = usageOnlyDraft();
    const withPeriods: WorkflowDraft = {
      ...base,
      variableConsiderationComponents: base.variableConsiderationComponents.map((component) => ({
        ...component,
        seriesPeriods: QUARTERS,
      })),
    };
    expect(draftRequiresProgressive(withPeriods)).toBe(true);
    expect(draftRequiresProgressive(base)).toBe(false);
  });

  it("routes progressively when usage bills on realization", () => {
    const base = usageOnlyDraft();
    const billed: WorkflowDraft = {
      ...base,
      variableConsiderationComponents: base.variableConsiderationComponents.map((component) => ({
        ...component,
        billOnRealization: true,
      })),
    };
    expect(draftRequiresProgressive(billed)).toBe(true);
    expect(draftRequiresProgressive(base)).toBe(false);
  });
});
