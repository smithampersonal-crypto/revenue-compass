/**
 * Phase 9G-R3 — authority-closure acceptance.
 *
 * Every test below travels the REAL production path: a WorkflowDraft the
 * accountant could have entered, through analyzeWorkflow() and the balance
 * workpaper. Nothing is calculated in the test.
 *
 * What is proved here:
 *  1. one workflow-owned determination of what progressive accounting may be
 *     presented, shared by the results panel and the workpaper;
 *  2. the accepted measurement path owns every dated VC assessment;
 *  3. ARC's canonical strict calendar validation is the only date rule;
 *  4. an engine-level usage block can never reconcile as complete;
 *  5. canonical source-data validation survives the progressive workpaper.
 */

import { describe, expect, it } from "vitest";

import { analyzeWorkflow } from "../analysis";
import { analyzeContractBalanceWorkflow } from "../contract-balances";
import { draftRequiresProgressive } from "../r3-adapter";
import { createVcComponentDraft, type WorkflowDraft } from "../types";
import { previewVcCurrentMeasurement } from "../vc-measurement";

import {
  GENOMIX_HOSTED_CENTS,
  genomixR3Draft,
  withSupportHours,
  withValidationTransfer,
} from "./genomix-r3-fixture";

/** A Genomix contract whose operational facts have all actually happened. */
function resolvedGenomix(): WorkflowDraft {
  return withSupportHours(withValidationTransfer(genomixR3Draft(), "2027-03-31"), [
    { id: "pe-1", seq: 1, date: "2027-03-31", unitsInput: "200" },
  ]);
}

function withBilling(
  draft: WorkflowDraft,
  events: WorkflowDraft["contractBalances"]["considerationEvents"],
): WorkflowDraft {
  return {
    ...draft,
    contractBalances: { ...draft.contractBalances, considerationEvents: events },
  };
}

function withCash(
  draft: WorkflowDraft,
  collections: WorkflowDraft["contractBalances"]["cashCollections"],
): WorkflowDraft {
  return {
    ...draft,
    contractBalances: { ...draft.contractBalances, cashCollections: collections },
  };
}

/* ------------------------------------- 1. one shared dependency gate ----- */

describe("R3: one workflow-owned determination of presentable accounting", () => {
  it("presents balances and journals when every fact is usable", () => {
    const workflow = analyzeWorkflow(resolvedGenomix());
    expect(workflow.progressiveGate!.balancesPresentable).toBe(true);
    expect(workflow.progressiveGate!.journalsPresentable).toBe(true);
    expect(workflow.progressiveGate!.state).toBe("complete");
    expect(analyzeContractBalanceWorkflow(resolvedGenomix()).analysis).not.toBeNull();
  });

  const cases: { name: string; code: string; mutate: (draft: WorkflowDraft) => WorkflowDraft }[] = [
    {
      name: "a fixed billing event with a blank invoice date",
      code: "billing.invoice_date",
      mutate: (draft) =>
        withBilling(
          draft,
          draft.contractBalances.considerationEvents.map((event, index) =>
            index === 0 ? { ...event, invoiceDate: "" as const } : event,
          ),
        ),
    },
    {
      name: "a fixed billing event with an impossible invoice date",
      code: "billing.invoice_date",
      mutate: (draft) =>
        withBilling(
          draft,
          draft.contractBalances.considerationEvents.map((event, index) =>
            index === 0 ? { ...event, invoiceDate: "2027-02-30" } : event,
          ),
        ),
    },
    {
      name: "a cash collection with no billing event",
      code: "cash_collection",
      mutate: (draft) =>
        withCash(draft, [
          {
            id: "cash-1",
            seq: 1,
            considerationEventId: null,
            amountInput: "245,000.00",
            collectionDate: "2027-02-01",
          },
        ]),
    },
    {
      name: "a cash collection with an unusable amount",
      code: "cash_collection",
      mutate: (draft) =>
        withCash(draft, [
          {
            id: "cash-1",
            seq: 1,
            considerationEventId: "bill-1",
            amountInput: "not money",
            collectionDate: "2027-02-01",
          },
        ]),
    },
  ];

  for (const testCase of cases) {
    it(`blocks the same dependent output everywhere for ${testCase.name}`, () => {
      const broken = testCase.mutate(resolvedGenomix());
      const workflow = analyzeWorkflow(broken);

      // The source fact stays visible.
      expect(workflow.progressiveBlocked.some((fact) => fact.code.startsWith(testCase.code))).toBe(
        true,
      );

      // Allocation and determinable revenue are untouched.
      const hosted = workflow.allocation!.find((row) => row.poId === "po-hosted")!;
      expect(hosted.allocatedCents).toBe(GENOMIX_HOSTED_CENTS);
      expect(workflow.revenueSchedule).not.toBeNull();

      // The dependent output is blocked, identically, on every surface.
      expect(workflow.progressiveGate!.balancesPresentable).toBe(false);
      expect(workflow.progressiveGate!.journalsPresentable).toBe(false);
      expect(workflow.progressiveGate!.state).not.toBe("complete");
      expect(workflow.finalized).toBe(false);

      const workpaper = analyzeContractBalanceWorkflow(broken);
      expect(workpaper.analysis).toBeNull();
      expect(workpaper.finalized).toBe(false);
      expect(workpaper.blockedReason).toBe(workflow.progressiveGate!.blockedReason);

      // Correcting ONLY that fact restores the dependent output.
      const restored = analyzeWorkflow(resolvedGenomix());
      expect(restored.progressiveGate!.balancesPresentable).toBe(true);
      expect(restored.progressiveGate!.journalsPresentable).toBe(true);
    });
  }
});

/* ----------------------------- 2. strict ISO calendar validation --------- */

describe("R3: ARC's canonical strict calendar validation", () => {
  const invoiceDated = (date: string): WorkflowDraft =>
    withBilling(
      resolvedGenomix(),
      resolvedGenomix().contractBalances.considerationEvents.map((event, index) =>
        index === 0 ? { ...event, invoiceDate: date } : event,
      ),
    );

  const usable = (date: string) =>
    !analyzeWorkflow(invoiceDated(date)).progressiveBlocked.some(
      (fact) => fact.code === "billing.invoice_date",
    );

  it("accepts real calendar dates and rejects impossible ones", () => {
    expect(usable("2027-02-28")).toBe(true);
    expect(usable("2028-02-29")).toBe(true);
    expect(usable("2027-02-29")).toBe(false);
    expect(usable("2027-02-30")).toBe(false);
    expect(usable("2027-13-01")).toBe(false);
    expect(usable("2027-04-31")).toBe(false);
  });
});

/* ------------------------- 3. every VC assessment through the engine ----- */

/** An estimated component with an inception assessment and remeasurements. */
function estimatedComponent(
  remeasurements: {
    id: string;
    seq: number;
    effectiveDate: string;
    amountInput: string;
    probabilityInput: string;
    includedInput: string;
  }[],
  overrides: Partial<ReturnType<typeof createVcComponentDraft>> = {},
) {
  const base = createVcComponentDraft(1, "vc-bonus", "estimated");
  return {
    ...base,
    description: "Performance bonus",
    effect: "increase" as const,
    estimationMethod: "expected_value" as const,
    allocationTreatment: "general" as const,
    relatesSpecifically: false,
    consistentWithAllocationObjective: true,
    inception: {
      ...base.inception,
      effectiveDate: "2027-01-01",
      includedInput: "5,000.00",
      constraintRationale:
        "Only half of the estimate is included because the milestone depends on a third party.",
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
    },
    remeasurements: remeasurements.map((assessment) => ({
      id: assessment.id,
      seq: assessment.seq,
      effectiveDate: assessment.effectiveDate,
      includedInput: assessment.includedInput,
      constraintRationale:
        "The estimate was revised and part of it remains constrained by the same third-party dependency.",
      evidence: "Revised milestone forecast.",
      outcomes: [
        {
          id: `${assessment.id}-o1`,
          seq: 1,
          description: "Bonus earned",
          amountInput: assessment.amountInput,
          probabilityInput: assessment.probabilityInput,
          isMostLikely: true,
        },
      ],
    })),
    ...overrides,
  };
}

const VALID_REMEASUREMENT = {
  id: "rm-1",
  seq: 1,
  effectiveDate: "2027-06-30",
  amountInput: "20,000.00",
  probabilityInput: "100",
  includedInput: "15,000.00",
};

describe("R3: the accepted measurement path owns every dated assessment", () => {
  it("keeps the inception estimate and its constrained amount distinct", () => {
    const measurement = previewVcCurrentMeasurement(estimatedComponent([]));
    expect(measurement.issues).toEqual([]);
    expect(measurement.unconstrainedCents).toBe(1_000_000);
    expect(measurement.includedCents).toBe(500_000);
    expect(measurement.remeasured).toBe(false);
  });

  it("makes a valid later remeasurement the current measurement", () => {
    const measurement = previewVcCurrentMeasurement(estimatedComponent([VALID_REMEASUREMENT]));
    expect(measurement.issues).toEqual([]);
    // The CURRENT unconstrained estimate, not the inception estimate.
    expect(measurement.unconstrainedCents).toBe(2_000_000);
    expect(measurement.includedCents).toBe(1_500_000);
    expect(measurement.remeasured).toBe(true);
    // The remeasurement keeps its own date: history is not rewritten.
    expect(measurement.effectiveDate).toBe("2027-06-30");
  });

  const invalid: { name: string; component: () => ReturnType<typeof estimatedComponent> }[] = [
    {
      name: "malformed expected-value probabilities",
      component: () =>
        estimatedComponent([{ ...VALID_REMEASUREMENT, probabilityInput: "not a percentage" }]),
    },
    {
      name: "an included amount above the estimate",
      component: () => estimatedComponent([{ ...VALID_REMEASUREMENT, includedInput: "25,000.00" }]),
    },
    {
      name: "an unusable effective date",
      component: () =>
        estimatedComponent([{ ...VALID_REMEASUREMENT, effectiveDate: "2027-02-30" }]),
    },
    {
      name: "a non-chronological assessment sequence",
      component: () =>
        estimatedComponent([{ ...VALID_REMEASUREMENT, effectiveDate: "2026-06-30" }]),
    },
    {
      name: "a blank included amount on the latest assessment",
      component: () => estimatedComponent([{ ...VALID_REMEASUREMENT, includedInput: "" }]),
    },
    {
      name: "a malformed most-likely assessment",
      component: () =>
        estimatedComponent([VALID_REMEASUREMENT], {
          estimationMethod: "most_likely_amount",
          remeasurements: [],
          inception: {
            ...estimatedComponent([]).inception,
            outcomes: estimatedComponent([]).inception.outcomes.map((outcome) => ({
              ...outcome,
              isMostLikely: false,
            })),
          },
        }),
    },
  ];

  for (const testCase of invalid) {
    it(`fails closed on ${testCase.name}`, () => {
      const measurement = previewVcCurrentMeasurement(testCase.component());
      expect(measurement.issues.length).toBeGreaterThan(0);
      // No number is produced, and the earlier assessment is never substituted.
      expect(measurement.unconstrainedCents).toBeNull();
      expect(measurement.includedCents).toBeNull();
    });
  }
});

/* --------------------------------- 4. usage blocks are never complete ---- */

/** A contract whose ONLY R3 trigger is its usage rule. */
function usageOnlyDraft(quantities: Record<string, string>): WorkflowDraft {
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
            includedQuantityInput: "50",
          },
        ],
        seriesPeriods: [
          { id: "q1", seq: 1, label: "Q1 2027", startDate: "2027-01-01", endDate: "2027-03-31" },
        ],
        realizedEvents: [],
        billOnRealization: false,
        usagePeriods: [{ id: "up-1", month: "2027-03", quantities }],
      },
    ],
  };
}

describe("R3: an engine-level usage block can never reconcile as complete", () => {
  it("reports a quantity for a meter that no longer exists and refuses to complete", () => {
    const orphan = usageOnlyDraft({ m1: "1000", "m-deleted": "500" });
    expect(draftRequiresProgressive(orphan)).toBe(true);

    const workflow = analyzeWorkflow(orphan);
    expect(
      workflow.progressiveBlocked.some((fact) => fact.code === "usage.actual.orphan_meter"),
    ).toBe(true);
    expect(workflow.finalized).toBe(false);
    expect(workflow.progressiveGate!.state).not.toBe("complete");
    expect(workflow.progressiveGate!.balancesPresentable).toBe(false);
    expect(workflow.progressiveGate!.journalsPresentable).toBe(false);
    expect(analyzeContractBalanceWorkflow(orphan).analysis).toBeNull();

    // Correcting the meter reference restores the calculation.
    const corrected = analyzeWorkflow(usageOnlyDraft({ m1: "1000" }));
    expect(
      corrected.progressiveBlocked.some((fact) => fact.code === "usage.actual.orphan_meter"),
    ).toBe(false);
    expect(corrected.progressiveGate!.balancesPresentable).toBe(true);
  });
});

/* ----------------- 5. canonical validation survives the workpaper -------- */

describe("R3: canonical source-data validation is never discarded", () => {
  it("keeps a canonical billing-source failure blocking in the balance workpaper", () => {
    const draft = withBilling(
      resolvedGenomix(),
      resolvedGenomix().contractBalances.considerationEvents.map((event, index) =>
        index === 0
          ? { ...event, amountSource: "usage_period" as const, sourceComponentId: "" }
          : event,
      ),
    );
    const workpaper = analyzeContractBalanceWorkflow(draft);
    expect(
      workpaper.validation.blocking.some((issue) => issue.id.startsWith("billing.event")),
    ).toBe(true);
    expect(workpaper.finalized).toBe(false);
  });

  it("does not reintroduce a rule R3 deliberately supersedes", () => {
    const workpaper = analyzeContractBalanceWorkflow(resolvedGenomix());
    expect(workpaper.validation.issues.some((issue) => issue.id === "billing.events.exists")).toBe(
      false,
    );
    expect(workpaper.finalized).toBe(true);
  });
});
