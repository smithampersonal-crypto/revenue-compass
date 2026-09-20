/**
 * Phase 9G-R3, Section G/J. The REAL Phase 9G review machinery, exercised
 * against the R3 progressive facts.
 *
 * Nothing here is a parallel R3 fingerprint helper: every assertion travels
 * `classifyReviewTarget` / `canonicalReviewTargetFingerprint` (the production
 * target vocabulary and material projections) and, for carry-forward,
 * `deriveReviewItem` / `carryForwardReviewResolutions` — the same functions the
 * server uses to decide whether an accountant's approval still stands.
 *
 * The principle under test: changing ONE R3 material fact reopens only the
 * conclusion that fact belongs to. Every unrelated approval survives.
 */
import { describe, expect, it } from "vitest";

import {
  createVcComponentDraft,
  createVcMeterDraft,
  type VcComponentDraft,
  type WorkflowDraft,
} from "@/lib/asc606-workflow";
import {
  genomixR3Draft,
  withRealizedCredit,
  withSupportHours,
  withValidationTransfer,
} from "@/lib/asc606-workflow/__tests__/genomix-r3-fixture";

import {
  canonicalReviewTargetFingerprint,
  classifyReviewTarget,
  type TargetClassification,
} from "../edit-reconciliation";
import {
  carryForwardReviewResolutions,
  deriveReviewItem,
  type AiReviewItem,
} from "../review-state";

const USAGE_ID = "vc-usage";
const METER_ID = `${USAGE_ID}-m1`;

/** The Genomix draft plus a usage component, so meter facts are exercised too. */
function draftWithUsage(): WorkflowDraft {
  const base = genomixR3Draft();
  const usage: VcComponentDraft = {
    ...createVcComponentDraft(2, USAGE_ID, "usage_as_incurred"),
    description: "Tier 2 analysis usage",
    allocationTreatment: "specific_po",
    targetPoId: "po-hosted",
    relatesSpecifically: true,
    consistentWithAllocationObjective: true,
    allocationRationale: "Usage relates specifically to the hosted platform.",
    billOnRealization: true,
    meters: [
      {
        ...createVcMeterDraft(1, METER_ID),
        name: "Tier 2 analyses",
        rateAmountInput: "4.00",
        rateQuantityInput: "1",
        unit: "analyses",
        includedQuantityInput: "1000",
      },
    ],
    usagePeriods: [
      { id: `${USAGE_ID}-p1`, month: "2027-02", quantities: { [METER_ID]: "1500" } },
    ],
  };
  return {
    ...base,
    variableConsiderationComponents: [...base.variableConsiderationComponents, usage],
  };
}

/**
 * Every R3 review target the UI binds to, with the classification the
 * production vocabulary must give it. A target that silently fell through to
 * an undefined property read would classify as `exact_scalar` with a null
 * value, so this table is what stops that happening.
 */
const R3_TARGET_VOCABULARY: ReadonlyArray<readonly [string, TargetClassification]> = [
  // Performance-obligation recognition (G1).
  ["po:po-support.recognitionMethod", "material_group"],
  ["po:po-support.overTimeMeasure", "material_group"],
  ["po:po-support.totalExpectedUnitsInput", "material_group"],
  // The synthetic key the earlier UI used is an explicit, deliberate synonym.
  ["po:po-support.totalExpectedUnits", "material_group"],
  ["po:po-support.unitLabel", "material_group"],
  ["po:po-support.progressEvents", "material_group"],
  ["po:po-validation.transferStatus", "material_group"],
  ["po:po-validation.recognitionDate", "material_group"],
  ["po:po-hosted.servicePeriod", "composite"],
  // Variable-consideration estimation, allocation and operational facts (G2-G4).
  ["vc:vc-sla.inception", "material_group"],
  ["vc:vc-sla.remeasurements", "material_group"],
  ["vc:vc-sla.resolutionAmountInput", "material_group"],
  ["vc:vc-sla.allocationTreatment", "material_group"],
  ["vc:vc-sla.targetPoId", "material_group"],
  ["vc:vc-sla.allocation", "composite"],
  ["vc:vc-sla.seriesPeriods", "material_group"],
  ["vc:vc-sla.realizedEvents", "material_group"],
  ["vc:vc-sla.billOnRealization", "material_group"],
  [`vc:${USAGE_ID}.usagePeriods`, "material_group"],
  [`vc:${USAGE_ID}.meter.rateAmountInput`, "composite"],
  [`vc:${USAGE_ID}.meter.includedQuantityInput`, "composite"],
];

/** Every target above, used as the "nothing unrelated moved" control set. */
const ALL_TARGETS = R3_TARGET_VOCABULARY.map(([key]) => key);

function fingerprints(draft: WorkflowDraft): Map<string, string | null> {
  return new Map(ALL_TARGETS.map((key) => [key, canonicalReviewTargetFingerprint(draft, key)]));
}

/** Asserts that exactly the named targets moved, and nothing else did. */
function expectOnlyChanged(
  before: WorkflowDraft,
  after: WorkflowDraft,
  changed: readonly string[],
): void {
  const a = fingerprints(before);
  const b = fingerprints(after);
  const expectedChanged = new Set(changed);
  for (const key of ALL_TARGETS) {
    if (expectedChanged.has(key)) {
      expect(`${key}:${a.get(key) === b.get(key) ? "unchanged" : "changed"}`).toBe(
        `${key}:changed`,
      );
    } else {
      expect(`${key}:${a.get(key) === b.get(key) ? "unchanged" : "changed"}`).toBe(
        `${key}:unchanged`,
      );
    }
  }
}

function patchPo(draft: WorkflowDraft, id: string, values: Record<string, unknown>): WorkflowDraft {
  return {
    ...draft,
    performanceObligations: draft.performanceObligations.map((po) =>
      po.id === id ? { ...po, ...values } : po,
    ),
  };
}

function patchVc(draft: WorkflowDraft, id: string, values: Record<string, unknown>): WorkflowDraft {
  return {
    ...draft,
    variableConsiderationComponents: draft.variableConsiderationComponents.map((component) =>
      component.id === id ? { ...component, ...values } : component,
    ),
  };
}

const SUPPORT_RECOGNITION = [
  "po:po-support.recognitionMethod",
  "po:po-support.overTimeMeasure",
  "po:po-support.totalExpectedUnitsInput",
  "po:po-support.totalExpectedUnits",
  "po:po-support.unitLabel",
  "po:po-support.progressEvents",
];
const VALIDATION_RECOGNITION = [
  "po:po-validation.transferStatus",
  "po:po-validation.recognitionDate",
];
const SLA_OPERATIONAL = [
  "vc:vc-sla.seriesPeriods",
  "vc:vc-sla.realizedEvents",
  "vc:vc-sla.billOnRealization",
];
const SLA_ESTIMATION = [
  "vc:vc-sla.inception",
  "vc:vc-sla.remeasurements",
  "vc:vc-sla.resolutionAmountInput",
];
const SLA_ALLOCATION = [
  "vc:vc-sla.allocationTreatment",
  "vc:vc-sla.targetPoId",
  "vc:vc-sla.allocation",
];
const USAGE_OPERATIONAL = [
  `vc:${USAGE_ID}.usagePeriods`,
  `vc:${USAGE_ID}.meter.rateAmountInput`,
  `vc:${USAGE_ID}.meter.includedQuantityInput`,
];

describe("R3 target vocabulary is deliberately classified", () => {
  const draft = draftWithUsage();

  for (const [key, classification] of R3_TARGET_VOCABULARY) {
    it(`classifies ${key} as ${classification} and can read it canonically`, () => {
      expect(classifyReviewTarget(draft, key)).toBe(classification);
      expect(canonicalReviewTargetFingerprint(draft, key)).not.toBeNull();
    });
  }

  it("binds the synthetic total-units key to exactly the same conclusion", () => {
    expect(canonicalReviewTargetFingerprint(draft, "po:po-support.totalExpectedUnits")).toBe(
      canonicalReviewTargetFingerprint(draft, "po:po-support.totalExpectedUnitsInput"),
    );
  });
});

describe("one R3 performance-obligation fact reopens only its own conclusion", () => {
  const base = draftWithUsage();

  it("transfer status", () => {
    expectOnlyChanged(
      base,
      patchPo(base, "po-validation", { transferStatus: "transferred" }),
      VALIDATION_RECOGNITION,
    );
  });

  it("recognition date", () => {
    expectOnlyChanged(
      base,
      withValidationTransfer(base, "2027-03-15"),
      VALIDATION_RECOGNITION,
    );
  });

  it("measure of progress", () => {
    expectOnlyChanged(
      base,
      patchPo(base, "po-support", { overTimeMeasure: "time_based" }),
      SUPPORT_RECOGNITION,
    );
  });

  it("input-measure denominator", () => {
    expectOnlyChanged(
      base,
      patchPo(base, "po-support", { totalExpectedUnitsInput: "250" }),
      SUPPORT_RECOGNITION,
    );
  });

  it("unit label", () => {
    expectOnlyChanged(
      base,
      patchPo(base, "po-support", { unitLabel: "engineer hours" }),
      SUPPORT_RECOGNITION,
    );
  });

  it("one actual progress event", () => {
    expectOnlyChanged(
      base,
      withSupportHours(base, [{ id: "pe-1", seq: 1, date: "2027-02-28", unitsInput: "50" }]),
      SUPPORT_RECOGNITION,
    );
  });

  it("a support edit never touches the hosted or validation obligation", () => {
    const changed = patchPo(base, "po-support", { totalExpectedUnitsInput: "250" });
    expect(canonicalReviewTargetFingerprint(changed, "po:po-hosted.servicePeriod")).toBe(
      canonicalReviewTargetFingerprint(base, "po:po-hosted.servicePeriod"),
    );
    expect(canonicalReviewTargetFingerprint(changed, "po:po-validation.transferStatus")).toBe(
      canonicalReviewTargetFingerprint(base, "po:po-validation.transferStatus"),
    );
  });
});

describe("one R3 variable-consideration fact reopens only its own conclusion", () => {
  const base = withSupportHours(draftWithUsage(), [
    { id: "pe-1", seq: 1, date: "2027-02-28", unitsInput: "50" },
    { id: "pe-2", seq: 2, date: "2027-03-31", unitsInput: "30" },
  ]);
  const sla = base.variableConsiderationComponents.find((c) => c.id === "vc-sla")!;
  const usage = base.variableConsiderationComponents.find((c) => c.id === USAGE_ID)!;

  it("a service-period date", () => {
    expectOnlyChanged(
      base,
      patchVc(base, "vc-sla", {
        seriesPeriods: (sla.seriesPeriods ?? []).map((period) =>
          period.id === "q3" ? { ...period, endDate: "2027-09-29" } : period,
        ),
      }),
      SLA_OPERATIONAL,
    );
  });

  it("a realized service-level amount", () => {
    expectOnlyChanged(base, withRealizedCredit(base, "5,000.00", "q3", "2027-09-30"), SLA_OPERATIONAL);
  });

  it("the bill-on-realization judgment", () => {
    expectOnlyChanged(base, patchVc(base, "vc-sla", { billOnRealization: false }), SLA_OPERATIONAL);
  });

  it("a remeasurement", () => {
    expectOnlyChanged(
      base,
      patchVc(base, "vc-sla", {
        remeasurements: [
          {
            id: "vc-sla-a2",
            seq: 2,
            effectiveDate: "2027-07-01",
            outcomes: [],
            includedInput: "4,000.00",
            constraintRationale: "A service level was missed in the second quarter.",
            evidence: "",
          },
        ],
      }),
      SLA_ESTIMATION,
    );
  });

  it("a resolution amount", () => {
    expectOnlyChanged(
      base,
      patchVc(base, "vc-sla", {
        hasResolution: true,
        resolutionDate: "2027-12-31",
        resolutionAmountInput: "6,000.00",
      }),
      SLA_ESTIMATION,
    );
  });

  it("the allocation target", () => {
    expectOnlyChanged(base, patchVc(base, "vc-sla", { targetPoId: "po-support" }), SLA_ALLOCATION);
  });

  it("the allocation treatment", () => {
    expectOnlyChanged(
      base,
      patchVc(base, "vc-sla", { allocationTreatment: "specific_po" }),
      SLA_ALLOCATION,
    );
  });

  it("a meter rate", () => {
    expectOnlyChanged(
      base,
      patchVc(base, USAGE_ID, {
        meters: usage.meters.map((meter) => ({ ...meter, rateAmountInput: "5.00" })),
      }),
      USAGE_OPERATIONAL,
    );
  });

  it("an included usage quantity", () => {
    expectOnlyChanged(
      base,
      patchVc(base, USAGE_ID, {
        meters: usage.meters.map((meter) => ({ ...meter, includedQuantityInput: "2000" })),
      }),
      USAGE_OPERATIONAL,
    );
  });

  it("one actual usage quantity", () => {
    expectOnlyChanged(
      base,
      patchVc(base, USAGE_ID, {
        usagePeriods: usage.usagePeriods.map((period) => ({
          ...period,
          quantities: { [METER_ID]: "1600" },
        })),
      }),
      USAGE_OPERATIONAL,
    );
  });

  it("a service-level edit never touches the usage component", () => {
    const changed = patchVc(base, "vc-sla", { billOnRealization: false });
    for (const key of USAGE_OPERATIONAL) {
      expect(canonicalReviewTargetFingerprint(changed, key)).toBe(
        canonicalReviewTargetFingerprint(base, key),
      );
    }
  });
});

describe("nested R3 events are identified by identity, never by array position", () => {
  const base = withSupportHours(draftWithUsage(), [
    { id: "pe-1", seq: 1, date: "2027-02-28", unitsInput: "50" },
    { id: "pe-2", seq: 2, date: "2027-03-31", unitsInput: "30" },
  ]);
  const support = base.performanceObligations.find((po) => po.id === "po-support")!;
  const sla = base.variableConsiderationComponents.find((c) => c.id === "vc-sla")!;
  const key = "po:po-support.progressEvents";

  it("reordering progress events changes nothing", () => {
    const reordered = patchPo(base, "po-support", {
      progressEvents: [...(support.progressEvents ?? [])].reverse(),
    });
    expect(canonicalReviewTargetFingerprint(reordered, key)).toBe(
      canonicalReviewTargetFingerprint(base, key),
    );
  });

  it("reordering declared service periods changes nothing", () => {
    const reordered = patchVc(base, "vc-sla", {
      seriesPeriods: [...(sla.seriesPeriods ?? [])].reverse(),
    });
    expect(canonicalReviewTargetFingerprint(reordered, "vc:vc-sla.seriesPeriods")).toBe(
      canonicalReviewTargetFingerprint(base, "vc:vc-sla.seriesPeriods"),
    );
  });

  it("changing one event's units reopens the conclusion", () => {
    const edited = patchPo(base, "po-support", {
      progressEvents: (support.progressEvents ?? []).map((event) =>
        event.id === "pe-2" ? { ...event, unitsInput: "31" } : event,
      ),
    });
    expect(canonicalReviewTargetFingerprint(edited, key)).not.toBe(
      canonicalReviewTargetFingerprint(base, key),
    );
  });

  it("deleting an event reopens the conclusion", () => {
    const deleted = patchPo(base, "po-support", {
      progressEvents: (support.progressEvents ?? []).filter((event) => event.id !== "pe-1"),
    });
    expect(canonicalReviewTargetFingerprint(deleted, key)).not.toBe(
      canonicalReviewTargetFingerprint(base, key),
    );
  });

  it("adding an event reopens the conclusion", () => {
    const added = patchPo(base, "po-support", {
      progressEvents: [
        ...(support.progressEvents ?? []),
        { id: "pe-3", seq: 3, date: "2027-04-30", unitsInput: "10" },
      ],
    });
    expect(canonicalReviewTargetFingerprint(added, key)).not.toBe(
      canonicalReviewTargetFingerprint(base, key),
    );
  });

  it("re-adding the same event under a new identity is a real change", () => {
    const renamed = patchPo(base, "po-support", {
      progressEvents: (support.progressEvents ?? []).map((event) =>
        event.id === "pe-2" ? { ...event, id: "pe-2b" } : event,
      ),
    });
    expect(canonicalReviewTargetFingerprint(renamed, key)).not.toBe(
      canonicalReviewTargetFingerprint(base, key),
    );
  });
});

/* -------------------------------------------- persisted review carry-forward */

function itemFor(draft: WorkflowDraft, targetKey: string): AiReviewItem {
  const item = deriveReviewItem({
    targetKey,
    section: "step_5",
    reasonCode: "accountant_affirmation_required",
    reason: "This progressive accounting conclusion needs your affirmation.",
    guidanceIds: [],
    citations: [],
    value: canonicalReviewTargetFingerprint(draft, targetKey),
    material: canonicalReviewTargetFingerprint(draft, targetKey),
  });
  if (item === null) throw new Error(`no review item derived for ${targetKey}`);
  return item;
}

function affirm(item: AiReviewItem): AiReviewItem {
  return {
    ...item,
    state: "resolved",
    resolution: {
      kind: "affirmed",
      at: "2027-06-30T00:00:00.000Z",
      method: "individual",
      reviewFingerprint: item.reviewFingerprint,
    },
    affirmedAt: "2027-06-30T00:00:00.000Z",
    affirmedMethod: "individual",
  };
}

describe("persisted approvals carry forward across a real R3 fact change", () => {
  const base = draftWithUsage();
  const keys = [
    "po:po-support.progressEvents",
    "po:po-validation.transferStatus",
    "vc:vc-sla.seriesPeriods",
    `vc:${USAGE_ID}.usagePeriods`,
  ];

  it("reopens only the conclusion whose own material fact changed", () => {
    const approved = keys.map((key) => affirm(itemFor(base, key)));
    const changed = withSupportHours(base, [
      { id: "pe-1", seq: 1, date: "2027-02-28", unitsInput: "50" },
    ]);
    const rederived = keys.map((key) => itemFor(changed, key));

    const carried = carryForwardReviewResolutions(rederived, approved);
    const byTarget = new Map(carried.map((item) => [item.targetKey, item]));

    expect(byTarget.get("po:po-support.progressEvents")!.state).toBe("yellow");
    expect(byTarget.get("po:po-support.progressEvents")!.resolution).toBeNull();
    for (const key of keys.filter((k) => k !== "po:po-support.progressEvents")) {
      expect(`${key}:${byTarget.get(key)!.state}`).toBe(`${key}:resolved`);
    }
  });

  it("carries every approval forward when no material fact moved", () => {
    const approved = keys.map((key) => affirm(itemFor(base, key)));
    const rederived = keys.map((key) => itemFor(base, key));
    for (const item of carryForwardReviewResolutions(rederived, approved)) {
      expect(`${item.targetKey}:${item.state}`).toBe(`${item.targetKey}:resolved`);
    }
  });

  it("does not carry an approval that is not bound to its own fingerprint", () => {
    const tampered = keys.map((key) => {
      const item = affirm(itemFor(base, key));
      return { ...item, resolution: { ...item.resolution!, reviewFingerprint: "not-the-hash" } };
    });
    const rederived = keys.map((key) => itemFor(base, key));
    for (const item of carryForwardReviewResolutions(rederived, tampered as AiReviewItem[])) {
      expect(`${item.targetKey}:${item.state}`).toBe(`${item.targetKey}:yellow`);
    }
  });
});
