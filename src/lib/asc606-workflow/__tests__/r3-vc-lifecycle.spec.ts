/**
 * Phase 9G-R3 — the dated variable-consideration lifecycle, proved through the
 * REAL production path.
 *
 * Every test below builds a WorkflowDraft an accountant could have entered and
 * runs analyzeWorkflow(). Where an amount must be checked, it is compared
 * against the ACCEPTED Phase 5B engine output rather than arithmetic written
 * out here, so the two can never disagree.
 *
 * Proved here:
 *  1. inception, each dated remeasurement and the resolution are preserved as
 *     dated facts; the sequence is never flattened to one current amount;
 *  2. a remeasurement produces the accepted cumulative catch-up in its own
 *     effective month and never rewrites earlier months;
 *  3. a resolution is economically authoritative: it moves the transaction
 *     price and the dated revenue, for general and specific-PO treatments and
 *     with the economic sign preserved;
 *  4. the accepted component-level validation governs the R3 route;
 *  5. an entered fixed billing event's invoice date is never fabricated by the
 *     engine itself.
 */

import { describe, expect, it } from "vitest";

import { monthKeyOf, type RecognizableUnit } from "@/lib/asc606";
import { allocateSignedAmount, recognizeDynamicUnit } from "@/lib/asc606-variable-consideration";

import { analyzeWorkflow } from "../analysis";
import { analyzeContractBalanceWorkflow } from "../contract-balances";
import { draftRequiresProgressive } from "../r3-adapter";
import {
  createEmptyDraft,
  createPoDraft,
  createPromiseDraft,
  createVcAssessmentDraft,
  createVcComponentDraft,
  type VcAssessmentDraft,
  type VcComponentDraft,
  type WorkflowDraft,
} from "../types";
import { answerAllStep1 } from "./fixtures";
import { genomixR3Draft } from "./genomix-r3-fixture";

const FIXED_CENTS = 49_000_000;
const HOSTED_SSP_CENTS = 44_600_000;
const VALIDATION_SSP_CENTS = 4_400_000;
const SERVICE_START = "2027-01-01";
const SERVICE_END = "2027-12-31";
const VALIDATION_DATE = "2027-03-15";

/* --------------------------------------------------------------- fixtures */

function assessment(
  id: string,
  seq: number,
  effectiveDate: string,
  amount: string,
): VcAssessmentDraft {
  return {
    ...createVcAssessmentDraft(seq, id),
    effectiveDate,
    includedInput: amount,
    constraintRationale:
      "The amount is supported by contemporaneous evidence and is not expected to reverse.",
    outcomes: [
      {
        id: `${id}-o1`,
        seq: 1,
        description: "Milestone achieved",
        amountInput: amount,
        probabilityInput: "100",
        isMostLikely: true,
      },
    ],
  };
}

/** A usage rule with no actuals: an R3-owned fact that routes the contract. */
function usageTrigger(): VcComponentDraft {
  const base = createVcComponentDraft(2, "vc-usage", "usage_as_incurred");
  return {
    ...base,
    description: "Overage usage",
    targetPoId: "po-hosted",
    allocationRationale: "Usage relates specifically to the period in which it arises.",
    billOnRealization: true,
    meters: [
      {
        id: "meter-1",
        seq: 1,
        name: "API calls",
        rateAmountInput: "1.00",
        rateQuantityInput: "1",
        unit: "call",
      },
    ],
    usagePeriods: [],
  };
}

interface EstimatedOptions {
  treatment: "general" | "specific_po";
  effect?: "increase" | "decrease";
  inception: string;
  remeasurements?: { date: string; amount: string }[];
  resolution?: { date: string; amount: string };
}

function estimatedComponent(options: EstimatedOptions): VcComponentDraft {
  const base = createVcComponentDraft(1, "vc-bonus", "estimated");
  const component: VcComponentDraft = {
    ...base,
    description: "Performance bonus",
    effect: options.effect ?? "increase",
    estimationMethod: "most_likely_amount",
    allocationTreatment: options.treatment,
    allocationRationale:
      "The bonus is allocated on the basis the allocation objective supports for this contract.",
    inception: assessment("vc-bonus-a1", 1, SERVICE_START, options.inception),
    remeasurements: (options.remeasurements ?? []).map((row, index) =>
      assessment(`vc-bonus-r${index + 1}`, index + 1, row.date, row.amount),
    ),
  };
  if (options.treatment === "specific_po") {
    component.targetPoId = "po-hosted";
    component.relatesSpecifically = true;
    component.consistentWithAllocationObjective = true;
  }
  if (options.resolution) {
    component.hasResolution = true;
    component.resolutionDate = options.resolution.date;
    component.resolutionAmountInput = options.resolution.amount;
    component.resolutionRationale = "The final amount is now known and invoiced.";
  }
  return component;
}

function draftWith(component: VcComponentDraft): WorkflowDraft {
  const base = answerAllStep1(createEmptyDraft());
  const hosted = {
    ...createPoDraft(1, "po-hosted"),
    name: "Hosted SaaS platform",
    classification: "series" as const,
    classificationRationale: "A series of distinct daily services.",
    sspInput: "446,000.00",
    sspBasis: "Observable renewal pricing.",
    recognitionMethod: "over_time_ratable" as const,
    overTimeMeasure: "time_based" as const,
    serviceStart: SERVICE_START,
    serviceEnd: SERVICE_END,
    recognitionRationale: "The customer simultaneously receives and consumes the service.",
  };
  const validation = {
    ...createPoDraft(2, "po-validation"),
    name: "Validation services",
    classification: "single_distinct" as const,
    classificationRationale: "A distinct validation service.",
    sspInput: "44,000.00",
    sspBasis: "Expected cost plus a margin.",
    recognitionMethod: "point_in_time" as const,
    transferStatus: "transferred" as const,
    recognitionDate: VALIDATION_DATE,
    recognitionRationale: "Control transfers on acceptance of the report.",
  };
  const pos = [hosted, validation];
  return {
    ...base,
    contract: { ...base.contract, customerName: "Helix Analytics", contractNumber: "R3-VC" },
    transactionPriceInput: "490,000.00",
    promises: pos.map((po, index) => ({
      ...createPromiseDraft(index + 1, `pr-${po.id}`),
      description: po.name,
      capableOfBeingDistinct: true,
      distinctWithinContractContext: true,
      distinctRationale: "The customer can benefit from the promise on its own.",
      performanceObligationId: po.id,
    })),
    performanceObligations: pos,
    hasVariableConsideration: true,
    variableConsiderationComponents: [component, usageTrigger()],
    contractBalances: {
      ...base.contractBalances,
      considerationEvents: [
        {
          id: "bill-1",
          seq: 1,
          amountInput: "490,000.00",
          unconditionalRightDate: SERVICE_START,
          invoiceDate: SERVICE_START,
        },
      ],
      cashCollections: [],
    },
  };
}

const hostedUnit: RecognizableUnit = {
  id: "po-hosted",
  seq: 1,
  name: "Hosted SaaS platform",
  recognitionMethod: "over_time_ratable",
  serviceStart: SERVICE_START,
  serviceEnd: SERVICE_END,
};

const validationUnit: RecognizableUnit = {
  id: "po-validation",
  seq: 2,
  name: "Validation services",
  recognitionMethod: "point_in_time",
  recognitionDate: VALIDATION_DATE,
};

const allocatables = [
  { id: "po-hosted", seq: 1, name: "Hosted SaaS platform", sspCents: HOSTED_SSP_CENTS },
  { id: "po-validation", seq: 2, name: "Validation services", sspCents: VALIDATION_SSP_CENTS },
];

/** Revenue actually scheduled for one obligation, by month, as R3 produced it. */
function scheduledByMonth(
  workflow: ReturnType<typeof analyzeWorkflow>,
  poId: string,
): Record<string, number> {
  const rows: Record<string, number> = {};
  for (const row of workflow.progressive!.recognition!.schedule.byPo) {
    if (row.poId !== poId) continue;
    rows[row.month] = (rows[row.month] ?? 0) + row.revenueCents;
  }
  return rows;
}

/** The accepted engine's own answer for the same unit and dated changes. */
function acceptedByMonth(
  unit: RecognizableUnit,
  inceptionAllocatedCents: number,
  changes: { id: string; date: string; amountCents: number }[],
): Record<string, number> {
  const rows: Record<string, number> = {};
  for (const row of recognizeDynamicUnit({ unit, inceptionAllocatedCents, changes })) {
    rows[row.month] = (rows[row.month] ?? 0) + row.revenueCents;
  }
  return rows;
}

function allocatedFor(workflow: ReturnType<typeof analyzeWorkflow>, poId: string): number {
  return workflow.progressive!.allocation!.find((row) => row.poId === poId)!.allocatedCents;
}

/* -------------------------------------- 1. dated lifecycle is preserved -- */

describe("R3: the full dated variable-consideration lifecycle", () => {
  it("routes a contract carrying an R3 usage fact through the progressive engine", () => {
    expect(
      draftRequiresProgressive(
        draftWith(
          estimatedComponent({
            treatment: "general",
            inception: "12,000.00",
          }),
        ),
      ),
    ).toBe(true);
  });

  it("keeps every dated assessment of a specific-PO component distinct", () => {
    const workflow = analyzeWorkflow(
      draftWith(
        estimatedComponent({
          treatment: "specific_po",
          inception: "12,000.00",
          remeasurements: [{ date: "2027-07-01", amount: "24,000.00" }],
        }),
      ),
    );
    const lifecycle = workflow.progressive!.vc.datedChanges;
    expect(lifecycle).toHaveLength(1);
    expect(lifecycle[0]).toMatchObject({
      effectiveDate: "2027-07-01",
      targetPoId: "po-hosted",
      changeCents: 1_200_000,
      isResolution: false,
    });
  });

  it("recognizes a specific-PO remeasurement with the accepted dated economics", () => {
    const workflow = analyzeWorkflow(
      draftWith(
        estimatedComponent({
          treatment: "specific_po",
          inception: "12,000.00",
          remeasurements: [{ date: "2027-07-01", amount: "24,000.00" }],
        }),
      ),
    );

    // Transaction price and allocation carry the CURRENT $24,000.
    expect(workflow.progressive!.transactionPriceCents).toBe(FIXED_CENTS + 2_400_000);
    const hostedAllocated = allocatedFor(workflow, "po-hosted");

    const accepted = acceptedByMonth(hostedUnit, hostedAllocated - 1_200_000, [
      { id: "c1", date: "2027-07-01", amountCents: 1_200_000 },
    ]);
    const actual = scheduledByMonth(workflow, "po-hosted");
    expect(actual).toEqual(accepted);

    // January to June are still based on the ORIGINAL $12,000 assessment.
    const original = acceptedByMonth(hostedUnit, hostedAllocated - 1_200_000, []);
    for (const month of ["2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06"]) {
      expect(actual[month]).toBe(original[month]);
    }
    // July carries the cumulative catch-up; later months only the remainder.
    expect(actual["2027-07"]!).toBeGreaterThan(original["2027-07"]!);
    expect(actual["2027-08"]!).toBeGreaterThan(original["2027-08"]!);
    expect(actual["2027-08"]!).toBeLessThan(actual["2027-07"]!);
  });

  it("recognizes a general remeasurement across obligations with the accepted economics", () => {
    const workflow = analyzeWorkflow(
      draftWith(
        estimatedComponent({
          treatment: "general",
          inception: "12,000.00",
          remeasurements: [{ date: "2027-07-01", amount: "24,000.00" }],
        }),
      ),
    );
    expect(workflow.progressive!.transactionPriceCents).toBe(FIXED_CENTS + 2_400_000);

    const change = allocateSignedAmount(1_200_000, allocatables);
    for (const unit of [hostedUnit, validationUnit]) {
      const share = change.find((row) => row.poId === unit.id)!.amountCents;
      const allocated = allocatedFor(workflow, unit.id);
      expect(scheduledByMonth(workflow, unit.id)).toEqual(
        acceptedByMonth(unit, allocated - share, [
          { id: "c1", date: "2027-07-01", amountCents: share },
        ]),
      );
    }
  });
});

/* -------------------------------------- 2. resolution is authoritative --- */

describe("R3: resolution is economically authoritative", () => {
  it("moves the transaction price and dated revenue for a general component", () => {
    const workflow = analyzeWorkflow(
      draftWith(
        estimatedComponent({
          treatment: "general",
          inception: "10,000.00",
          resolution: { date: "2027-09-30", amount: "12,000.00" },
        }),
      ),
    );
    expect(workflow.progressive!.transactionPriceCents).toBe(FIXED_CENTS + 1_200_000);
    const resolution = workflow.progressive!.vc.datedChanges;
    expect(resolution).toHaveLength(1);
    expect(resolution.every((change) => change.isResolution)).toBe(true);
    expect(resolution.reduce((total, change) => total + change.changeCents, 0)).toBe(200_000);

    const share = allocateSignedAmount(200_000, allocatables);
    for (const unit of [hostedUnit, validationUnit]) {
      const amount = share.find((row) => row.poId === unit.id)!.amountCents;
      const allocated = allocatedFor(workflow, unit.id);
      expect(scheduledByMonth(workflow, unit.id)).toEqual(
        acceptedByMonth(unit, allocated - amount, [
          { id: "r", date: "2027-09-30", amountCents: amount },
        ]),
      );
    }
  });

  it("keeps a specific-PO resolution with its own obligation", () => {
    const workflow = analyzeWorkflow(
      draftWith(
        estimatedComponent({
          treatment: "specific_po",
          inception: "10,000.00",
          resolution: { date: "2027-09-30", amount: "12,000.00" },
        }),
      ),
    );
    expect(workflow.progressive!.transactionPriceCents).toBe(FIXED_CENTS + 1_200_000);

    const hostedAllocated = allocatedFor(workflow, "po-hosted");
    expect(scheduledByMonth(workflow, "po-hosted")).toEqual(
      acceptedByMonth(hostedUnit, hostedAllocated - 200_000, [
        { id: "r", date: "2027-09-30", amountCents: 200_000 },
      ]),
    );
    // The other obligation is untouched by the specific resolution.
    const validationAllocated = allocatedFor(workflow, "po-validation");
    expect(scheduledByMonth(workflow, "po-validation")).toEqual({
      [monthKeyOf(VALIDATION_DATE)]: validationAllocated,
    });
  });

  it("preserves the economic sign of a decrease through resolution", () => {
    const workflow = analyzeWorkflow(
      draftWith(
        estimatedComponent({
          treatment: "specific_po",
          effect: "decrease",
          inception: "10,000.00",
          resolution: { date: "2027-09-30", amount: "12,000.00" },
        }),
      ),
    );
    expect(workflow.progressive!.transactionPriceCents).toBe(FIXED_CENTS - 1_200_000);
    expect(workflow.progressive!.vc.datedChanges[0]!.changeCents).toBe(-200_000);
  });
});

/* -------------------------------------- 3. accepted component validation - */

describe("R3: the accepted component-level validation governs the progressive route", () => {
  const blockedCases: { name: string; component: VcComponentDraft }[] = [
    {
      name: "a resolution dated before the latest remeasurement",
      component: estimatedComponent({
        treatment: "general",
        inception: "10,000.00",
        remeasurements: [{ date: "2027-07-01", amount: "12,000.00" }],
        resolution: { date: "2027-03-01", amount: "12,000.00" },
      }),
    },
    {
      name: "an unreadable resolution amount",
      component: estimatedComponent({
        treatment: "general",
        inception: "10,000.00",
        resolution: { date: "2027-09-30", amount: "not money" },
      }),
    },
    {
      name: "a negative resolution amount",
      component: estimatedComponent({
        treatment: "general",
        inception: "10,000.00",
        resolution: { date: "2027-09-30", amount: "-1,000.00" },
      }),
    },
    {
      name: "assessment dates that are not strictly increasing",
      component: estimatedComponent({
        treatment: "general",
        inception: "10,000.00",
        remeasurements: [
          { date: "2027-07-01", amount: "12,000.00" },
          { date: "2027-07-01", amount: "14,000.00" },
        ],
      }),
    },
  ];

  for (const testCase of blockedCases) {
    it(`fails closed on ${testCase.name}`, () => {
      const workflow = analyzeWorkflow(draftWith(testCase.component));
      expect(workflow.progressiveBlocked.map((fact) => fact.code)).toContain(
        "vc.lifecycle.unusable",
      );
      expect(workflow.progressiveGate?.state ?? "blocked").not.toBe("complete");
      expect(workflow.finalized).toBe(false);
    });
  }

  it("fails closed when a specific-PO exception lacks both judgments", () => {
    const component = estimatedComponent({ treatment: "specific_po", inception: "10,000.00" });
    const workflow = analyzeWorkflow(
      draftWith({ ...component, consistentWithAllocationObjective: null }),
    );
    expect(workflow.progressiveBlocked.map((fact) => fact.code)).toContain("vc.lifecycle.unusable");
    expect(workflow.finalized).toBe(false);
  });

  it("fails closed on a malformed later assessment without falling back to inception", () => {
    const component = estimatedComponent({
      treatment: "general",
      inception: "10,000.00",
      remeasurements: [{ date: "2027-07-01", amount: "12,000.00" }],
    });
    const broken: VcComponentDraft = {
      ...component,
      estimationMethod: "expected_value",
      remeasurements: component.remeasurements.map((assessmentDraft) => ({
        ...assessmentDraft,
        outcomes: assessmentDraft.outcomes.map((outcome) => ({
          ...outcome,
          probabilityInput: "40",
        })),
      })),
    };
    const workflow = analyzeWorkflow(draftWith(broken));
    expect(workflow.progressiveBlocked.map((fact) => fact.code)).toContain("vc.lifecycle.unusable");
    // The prior included amount is NOT silently used as the current estimate.
    expect(workflow.progressive?.transactionPriceCents ?? null).not.toBe(FIXED_CENTS + 1_000_000);
    expect(workflow.finalized).toBe(false);
  });

  it("keeps a valid assessment sequence green", () => {
    const workflow = analyzeWorkflow(
      draftWith(
        estimatedComponent({
          treatment: "general",
          inception: "10,000.00",
          remeasurements: [{ date: "2027-07-01", amount: "12,000.00" }],
          resolution: { date: "2027-09-30", amount: "14,000.00" },
        }),
      ),
    );
    expect(workflow.progressiveBlocked).toEqual([]);
    expect(workflow.progressive!.transactionPriceCents).toBe(FIXED_CENTS + 1_400_000);
  });
});

/* -------------------------------------- 4. no fabricated invoice timing -- */

describe("R3: a fixed billing event's invoice date is never fabricated", () => {
  function withoutFirstInvoiceDate(draft: WorkflowDraft): WorkflowDraft {
    return {
      ...draft,
      contractBalances: {
        ...draft.contractBalances,
        considerationEvents: draft.contractBalances.considerationEvents.map((event, index) =>
          index === 0 ? { ...event, invoiceDate: "" as const } : event,
        ),
      },
    };
  }

  it("blocks the engine's own balances and journals, keeping allocation and revenue", () => {
    const draft = withoutFirstInvoiceDate(genomixR3Draft());
    const workflow = analyzeWorkflow(draft);

    expect(workflow.progressive!.allocation).not.toBeNull();
    expect(workflow.progressive!.recognition!.schedule.totalCents).toBeGreaterThan(0);
    // The engine itself produced NO Phase 3 result from a substituted date.
    expect(workflow.progressive!.balances).toBeNull();
    expect(workflow.progressive!.journals).toBeNull();
    expect(workflow.progressiveGate!.balancesPresentable).toBe(false);
    expect(workflow.progressiveGate!.journalsPresentable).toBe(false);
    expect(analyzeContractBalanceWorkflow(draft).analysis).toBeNull();
  });

  it("restores the balances and journals as soon as the invoice date is entered", () => {
    const workflow = analyzeWorkflow(genomixR3Draft());
    expect(workflow.progressive!.balances).not.toBeNull();
    expect(workflow.progressive!.journals).not.toBeNull();
    expect(workflow.progressiveGate!.balancesPresentable).toBe(true);
  });
});
