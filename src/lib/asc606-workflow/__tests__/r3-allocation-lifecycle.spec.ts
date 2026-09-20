/**
 * Phase 9G-R3 (D) — CHRONOLOGICAL ALLOCATION-STATE AUTHORITY, proved through
 * the REAL production path.
 *
 * Every allocation state, at inception and after every dated remeasurement or
 * resolution, must stay nonnegative. A later favorable change never repairs an
 * earlier invalid state. The rule itself is the accepted Phase 5B rule: this
 * suite proves the R3 route reuses it (shared `planAllocationLifecycle`) and
 * reaches the same conclusion as `analyzeVariableConsideration()`.
 */

import { describe, expect, it } from "vitest";

import { analyzeVariableConsideration } from "@/lib/asc606-variable-consideration";
import type {
  EstimatedComponentInput,
  VcAssessmentInput,
  VcContractInput,
} from "@/lib/asc606-variable-consideration";

import { analyzeWorkflow } from "../analysis";
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

const FIXED_CENTS = 49_000_000;
const HOSTED_SSP_CENTS = 44_600_000;
const VALIDATION_SSP_CENTS = 4_400_000;
const SERVICE_START = "2027-01-01";
const SERVICE_END = "2027-12-31";
const VALIDATION_DATE = "2027-03-15";

const GENERAL_POOL_CODE = "vc.allocation.general_pool.nonnegative";
const PO_CODE = "vc.allocation.po.nonnegative";

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
        description: "Assessed outcome",
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

interface PenaltyOptions {
  id?: string;
  seq?: number;
  treatment: "general" | "specific_po";
  effect: "increase" | "decrease";
  targetPoId?: string;
  inception: string;
  remeasurements?: { date: string; amount: string }[];
  resolution?: { date: string; amount: string };
}

function penaltyComponent(options: PenaltyOptions): VcComponentDraft {
  const id = options.id ?? "vc-penalty";
  const base = createVcComponentDraft(options.seq ?? 1, id, "estimated");
  const component: VcComponentDraft = {
    ...base,
    description: "Service-level penalty",
    effect: options.effect,
    estimationMethod: "most_likely_amount",
    allocationTreatment: options.treatment,
    allocationRationale:
      "The amount is allocated on the basis the allocation objective supports for this contract.",
    inception: assessment(`${id}-a1`, 1, SERVICE_START, options.inception),
    remeasurements: (options.remeasurements ?? []).map((row, index) =>
      assessment(`${id}-r${index + 1}`, index + 1, row.date, row.amount),
    ),
  };
  if (options.treatment === "specific_po") {
    component.targetPoId = options.targetPoId ?? "po-validation";
    component.relatesSpecifically = true;
    component.consistentWithAllocationObjective = true;
  }
  if (options.resolution) {
    component.hasResolution = true;
    component.resolutionDate = options.resolution.date;
    component.resolutionAmountInput = options.resolution.amount;
    component.resolutionRationale = "The final amount is now known.";
  }
  return component;
}


function draftWith(...components: VcComponentDraft[]): WorkflowDraft {
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
    contract: { ...base.contract, customerName: "Helix Analytics", contractNumber: "R3-ALLOC" },
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
    variableConsiderationComponents: [...components, usageTrigger()],
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

/* ------------------------------- the accepted Phase 5B engine, same facts */

function acceptedAssessment(
  id: string,
  seq: number,
  effectiveDate: string,
  cents: number,
): VcAssessmentInput {
  return {
    id,
    seq,
    effectiveDate,
    includedCents: cents,
    constraintRationale:
      "The amount is supported by contemporaneous evidence and is not expected to reverse.",
    outcomes: [
      { id: `${id}-o1`, seq: 1, amountCents: cents, isMostLikely: true, description: "Assessed" },
    ],
  };
}

interface AcceptedSpec {
  id?: string;
  seq?: number;
  treatment: "general" | "specific_po";
  effect: "increase" | "decrease";
  targetPoId?: string;
  inceptionCents: number;
  remeasurements?: { date: string; cents: number }[];
  resolution?: { date: string; cents: number };
}

function acceptedComponent(spec: AcceptedSpec): EstimatedComponentInput {
  const id = spec.id ?? "vc-penalty";
  const component: EstimatedComponentInput = {
    id,
    seq: spec.seq ?? 1,
    description: "Service-level penalty",
    effect: spec.effect,
    estimationMethod: "most_likely_amount",
    allocationTreatment: spec.treatment,
    allocationRationale:
      "The amount is allocated on the basis the allocation objective supports for this contract.",
    inception: acceptedAssessment(`${id}-a1`, 1, SERVICE_START, spec.inceptionCents),
    remeasurements: (spec.remeasurements ?? []).map((row, index) =>
      acceptedAssessment(`${id}-r${index + 1}`, index + 1, row.date, row.cents),
    ),
  };
  if (spec.treatment === "specific_po") {
    component.targetPoId = spec.targetPoId ?? "po-validation";
    component.relatesSpecificallyToPo = true;
    component.consistentWithAllocationObjective = true;
  }
  if (spec.resolution) {
    component.resolution = {
      id: `${id}:resolution`,
      date: spec.resolution.date,
      actualCents: spec.resolution.cents,
      rationale: "The final amount is now known.",
    };
  }
  return component;
}

function acceptedAnalysis(...specs: AcceptedSpec[]) {

  const input: VcContractInput = {
    fixedConsiderationCents: FIXED_CENTS,
    standardPerformanceObligations: [
      {
        id: "po-hosted",
        seq: 1,
        name: "Hosted SaaS platform",
        sspCents: HOSTED_SSP_CENTS,
        recognitionMethod: "over_time_ratable",
        serviceStart: SERVICE_START,
        serviceEnd: SERVICE_END,
      },
      {
        id: "po-validation",
        seq: 2,
        name: "Validation services",
        sspCents: VALIDATION_SSP_CENTS,
        recognitionMethod: "point_in_time",
        recognitionDate: VALIDATION_DATE,
      },
    ],
    materialRights: [],
    estimatedComponents: specs.map(acceptedComponent),
    usageComponents: [],
  };
  return analyzeVariableConsideration(input);
}

function acceptedBlockingIds(analysis: ReturnType<typeof analyzeVariableConsideration>): string[] {
  return analysis.validation.blockingFailures.map((failure) => failure.id);
}

function blockedCodes(workflow: ReturnType<typeof analyzeWorkflow>): string[] {
  return (workflow.progressive?.blocked ?? []).map((row) => row.code);
}

/** No authoritative accounting may survive an invalid allocation lifecycle. */
function expectNoAuthoritativeAccounting(workflow: ReturnType<typeof analyzeWorkflow>): void {
  expect(workflow.progressive!.state).toBe("blocked");
  expect(workflow.progressive!.allocation).toBeNull();
  expect(workflow.progressive!.recognition).toBeNull();
  expect(workflow.progressive!.balances).toBeNull();
  expect(workflow.progressive!.journals).toBeNull();
  expect(workflow.finalized).toBe(false);
}

/* ------------------------------------------------------------------ tests */

describe("R3: chronological allocation states reuse the accepted Phase 5B authority", () => {
  it("A. blocks a specific-PO allocation that goes negative and later recovers", () => {
    const draft = draftWith(
      penaltyComponent({
        treatment: "specific_po",
        effect: "decrease",
        inception: "10,000.00",
        remeasurements: [{ date: "2027-06-30", amount: "60,000.00" }],
        resolution: { date: "2027-09-30", amount: "10,000.00" },
      }),
    );
    expect(draftRequiresProgressive(draft)).toBe(true);

    const workflow = analyzeWorkflow(draft);
    expect(blockedCodes(workflow)).toContain(PO_CODE);
    expectNoAuthoritativeAccounting(workflow);
    // The source lifecycle is retained for diagnosis, not deleted.
    expect(workflow.progressive!.vc.datedChanges.length).toBeGreaterThan(0);

    // The accepted engine reaches exactly the same conclusion.
    expect(
      acceptedBlockingIds(
        acceptedAnalysis({
          treatment: "specific_po",
          effect: "decrease",
          inceptionCents: 1_000_000,
          remeasurements: [{ date: "2027-06-30", cents: 6_000_000 }],
          resolution: { date: "2027-09-30", cents: 1_000_000 },
        }),
      ),
    ).toContain(PO_CODE);
  });

  it("B. blocks a negative specific-PO allocation at inception even when a resolution repairs it", () => {
    const draft = draftWith(
      penaltyComponent({
        treatment: "specific_po",
        effect: "decrease",
        inception: "60,000.00",
        resolution: { date: "2027-09-30", amount: "0.00" },
      }),
    );
    const workflow = analyzeWorkflow(draft);
    expect(blockedCodes(workflow)).toContain(PO_CODE);
    expectNoAuthoritativeAccounting(workflow);

    expect(
      acceptedBlockingIds(
        acceptedAnalysis({
          treatment: "specific_po",
          effect: "decrease",
          inceptionCents: 6_000_000,
          resolution: { date: "2027-09-30", cents: 0 },
        }),
      ),
    ).toContain(PO_CODE);
  });

  it("C. blocks a running general pool that becomes negative and later recovers", () => {
    // The June penalty drives the running general pool negative; the August
    // bonus restores a positive final pool. The lifecycle is still invalid.
    const penalty = penaltyComponent({
      treatment: "general",
      effect: "decrease",
      inception: "100,000.00",
      remeasurements: [{ date: "2027-06-30", amount: "700,000.00" }],
    });
    const bonus = penaltyComponent({
      id: "vc-bonus",
      seq: 2,
      treatment: "general",
      effect: "increase",
      inception: "1,000.00",
      remeasurements: [{ date: "2027-08-31", amount: "250,000.00" }],
    });
    const workflow = analyzeWorkflow(draftWith(penalty, bonus));
    expect(blockedCodes(workflow)).toContain(GENERAL_POOL_CODE);
    expect(workflow.progressive!.blocked.some((row) => row.message.includes("2027-06-30"))).toBe(
      true,
    );
    expectNoAuthoritativeAccounting(workflow);

    expect(
      acceptedBlockingIds(
        acceptedAnalysis(
          {
            treatment: "general",
            effect: "decrease",
            inceptionCents: 10_000_000,
            remeasurements: [{ date: "2027-06-30", cents: 70_000_000 }],
          },
          {
            id: "vc-bonus",
            seq: 2,
            treatment: "general",
            effect: "increase",
            inceptionCents: 100_000,
            remeasurements: [{ date: "2027-08-31", cents: 25_000_000 }],
          },
        ),
      ),
    ).toContain(GENERAL_POOL_CODE);
  });


  it("D1. blocks when the resolution itself drives the general pool negative", () => {
    const draft = draftWith(
      penaltyComponent({
        treatment: "general",
        effect: "decrease",
        inception: "100,000.00",
        resolution: { date: "2027-09-30", amount: "600,000.00" },
      }),
    );
    const workflow = analyzeWorkflow(draft);
    expect(blockedCodes(workflow)).toContain(GENERAL_POOL_CODE);
    expectNoAuthoritativeAccounting(workflow);
    expect(
      acceptedBlockingIds(
        acceptedAnalysis({
          treatment: "general",
          effect: "decrease",
          inceptionCents: 10_000_000,
          resolution: { date: "2027-09-30", cents: 60_000_000 },
        }),
      ),
    ).toContain(GENERAL_POOL_CODE);
  });

  it("D2. blocks when the resolution itself drives a specific-PO allocation negative", () => {
    const draft = draftWith(
      penaltyComponent({
        treatment: "specific_po",
        effect: "decrease",
        inception: "10,000.00",
        resolution: { date: "2027-09-30", amount: "60,000.00" },
      }),
    );
    const workflow = analyzeWorkflow(draft);
    expect(blockedCodes(workflow)).toContain(PO_CODE);
    expectNoAuthoritativeAccounting(workflow);
    expect(
      acceptedBlockingIds(
        acceptedAnalysis({
          treatment: "specific_po",
          effect: "decrease",
          inceptionCents: 1_000_000,
          resolution: { date: "2027-09-30", cents: 6_000_000 },
        }),
      ),
    ).toContain(PO_CODE);
  });

  it("E. keeps a signed reversal valid while every allocation state stays nonnegative", () => {
    const draft = draftWith(
      penaltyComponent({
        treatment: "specific_po",
        effect: "increase",
        inception: "20,000.00",
        remeasurements: [{ date: "2027-06-30", amount: "5,000.00" }],
      }),
    );
    const workflow = analyzeWorkflow(draft);
    expect(blockedCodes(workflow)).not.toContain(PO_CODE);
    expect(blockedCodes(workflow)).not.toContain(GENERAL_POOL_CODE);
    expect(workflow.progressive!.allocation).not.toBeNull();
    expect(workflow.progressive!.recognition).not.toBeNull();

    // A legitimate revenue reversal is NOT forbidden: the June catch-up is
    // negative while the allocated consideration stays positive.
    const june = workflow
      .progressive!.recognition!.schedule.byPo.filter(
        (row) => row.poId === "po-hosted" && row.month === "2027-06",
      )
      .reduce((total, row) => total + row.revenueCents, 0);
    const may = workflow
      .progressive!.recognition!.schedule.byPo.filter(
        (row) => row.poId === "po-hosted" && row.month === "2027-05",
      )
      .reduce((total, row) => total + row.revenueCents, 0);
    expect(june).toBeLessThan(may);
    expect(
      workflow.progressive!.allocation!.find((row) => row.poId === "po-hosted")!.allocatedCents,
    ).toBeGreaterThan(0);

    const accepted = acceptedAnalysis({
      treatment: "specific_po",
      effect: "increase",
      inceptionCents: 2_000_000,
      remeasurements: [{ date: "2027-06-30", cents: 500_000 }],
    });
    expect(acceptedBlockingIds(accepted)).toHaveLength(0);
  });

  it("parity: the same lifecycle blocks, or does not block, on both routes", () => {
    const cases: {
      label: string;
      draft: PenaltyOptions;
      accepted: AcceptedSpec;
      blocked: boolean;
    }[] = [
      {
        label: "valid increase then remeasurement",
        draft: {
          treatment: "general",
          effect: "increase",
          inception: "12,000.00",
          remeasurements: [{ date: "2027-07-01", amount: "24,000.00" }],
        },
        accepted: {
          treatment: "general",
          effect: "increase",
          inceptionCents: 1_200_000,
          remeasurements: [{ date: "2027-07-01", cents: 2_400_000 }],
        },
        blocked: false,
      },
      {
        label: "resolution drives the general pool negative",
        draft: {
          treatment: "general",
          effect: "decrease",
          inception: "100,000.00",
          resolution: { date: "2027-09-30", amount: "600,000.00" },
        },
        accepted: {
          treatment: "general",
          effect: "decrease",
          inceptionCents: 10_000_000,
          resolution: { date: "2027-09-30", cents: 60_000_000 },
        },
        blocked: true,
      },
      {
        label: "intermediate negative obligation",
        draft: {
          treatment: "specific_po",
          effect: "decrease",
          inception: "10,000.00",
          remeasurements: [{ date: "2027-06-30", amount: "60,000.00" }],
        },
        accepted: {
          treatment: "specific_po",
          effect: "decrease",
          inceptionCents: 1_000_000,
          remeasurements: [{ date: "2027-06-30", cents: 6_000_000 }],
        },
        blocked: true,
      },
    ];

    for (const testCase of cases) {
      const workflow = analyzeWorkflow(draftWith(penaltyComponent(testCase.draft)));
      const accepted = acceptedAnalysis(testCase.accepted);
      const allocationIds = acceptedBlockingIds(accepted).filter((id) =>
        id.startsWith("vc.allocation."),
      );
      const r3Codes = blockedCodes(workflow).filter((code) => code.startsWith("vc.allocation."));
      expect(r3Codes.length > 0, `${testCase.label}: R3 conclusion`).toBe(testCase.blocked);
      expect(allocationIds.length > 0, `${testCase.label}: Phase 5B conclusion`).toBe(
        testCase.blocked,
      );
      expect(new Set(r3Codes), `${testCase.label}: same reason`).toEqual(new Set(allocationIds));
    }

  });
});
