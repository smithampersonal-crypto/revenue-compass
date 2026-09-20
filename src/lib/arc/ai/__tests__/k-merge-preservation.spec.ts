/**
 * Phase 9G-R3, Section K9 / G5. AI re-analysis never overwrites an
 * accountant's own R3 operational facts — proved on a REAL two-run (and
 * three-run) AI lineage, not against a synthetic empty provenance state.
 *
 * Part 1 keeps the canonical-Genomix comparison: a workpaper whose rows the
 * accountant owns from the start survives a merge untouched.
 *
 * Part 2 is the ownership proof the acceptance gate asks for. Run 1 lets the
 * real merge CREATE the performance obligation and the variable-consideration
 * components, so those objects carry genuine AI object provenance. The
 * accountant then records R3 operational actuals on those AI-created objects
 * through the production edit-reconciliation path, and a materially changed
 * second analysis is merged on top of the resulting state. Every expectation
 * below follows provenance, never the object an R3 fact happens to live on.
 *
 * Everything runs through the real `mergeAiAnalysis()`, the real
 * `reconcileAiEdits()`, the real review machinery and the authoritative
 * `analyzeWorkflow()`. No schema or prompt version is involved.
 */
import { describe, expect, it } from "vitest";

import {
  analyzeWorkflow,
  createEmptyDraft,
  type VcComponentDraft,
  type WorkflowDraft,
} from "@/lib/asc606-workflow";
import { draftRequiresProgressive } from "@/lib/asc606-workflow/r3-adapter";
import {
  genomixBenchmarkDraft,
  r3OperationalFacts,
  withRealizedCredit,
  withSupportHours,
  withUsageActual,
  withValidationTransfer,
} from "@/lib/asc606-workflow/__tests__/genomix-k-fixture";

import { canonicalReviewTargetFingerprint, reconcileAiEdits } from "../edit-reconciliation";
import { createEmptyAiAnalysisState, mergeAiAnalysis, type AiAnalysisState } from "../merge";
import {
  carryForwardReviewResolutions,
  deriveReviewItem,
  type AiReviewItem,
} from "../review-state";
import type { AiContractAnalysis } from "../schema";
import { fixtureAAnalysis, guidancePackFixture, RUN_ID } from "./merge-fixtures";
import { genomixR1Analysis, R1_RUN_ID } from "./r1-fixtures";

const OPERATIONAL_TARGETS = [
  "po:po-validation.transferStatus",
  "po:po-validation.recognitionDate",
  "po:po-support.overTimeMeasure",
  "po:po-support.totalExpectedUnitsInput",
  "po:po-support.unitLabel",
  "po:po-support.progressEvents",
  "vc:vc-sla.seriesPeriods",
  "vc:vc-sla.realizedEvents",
  "vc:vc-sla.billOnRealization",
  "vc:vc-usage.usagePeriods",
  "vc:vc-usage.meter.rateAmountInput",
  "vc:vc-usage.meter.includedQuantityInput",
] as const;

/** The contract as the accountant has actually lived it. */
function livedContract(): WorkflowDraft {
  return withRealizedCredit(
    withUsageActual(
      withSupportHours(withValidationTransfer(genomixBenchmarkDraft(), "2027-03-15"), [
        { id: "po-support-pe-1", seq: 1, date: "2027-01-31", unitsInput: "150" },
      ]),
      "2027-02",
      "500",
    ),
    "1,500.00",
    "y1",
    "2027-04-30",
  );
}

function reanalyze(draft: WorkflowDraft): WorkflowDraft {
  return mergeAiAnalysis({
    currentDraft: draft,
    currentAiState: createEmptyAiAnalysisState(),
    analysis: fixtureAAnalysis(),
    runId: RUN_ID,
    guidancePack: guidancePackFixture(),
    priorContext: null,
  }).draft;
}

describe("K9 — AI re-analysis preserves every accountant-owned R3 fact", () => {
  const draft = livedContract();
  const merged = reanalyze(draft);

  it("leaves the complete operational fact set canonically unchanged", () => {
    expect(r3OperationalFacts(merged)).toEqual(r3OperationalFacts(draft));
  });

  it("leaves every operational review conclusion's material fingerprint unchanged", () => {
    for (const key of OPERATIONAL_TARGETS) {
      expect(`${key}:${canonicalReviewTargetFingerprint(merged, key)}`).toBe(
        `${key}:${canonicalReviewTargetFingerprint(draft, key)}`,
      );
    }
  });

  it("still measures support progress from the accountant's own hours", () => {
    // The AI fixture may propose its own obligations and prices, so the
    // absolute allocation can legitimately move. What may never move is the
    // measure of progress: it comes from hours the accountant recorded.
    const ratio = (candidate: WorkflowDraft) => {
      const result = analyzeWorkflow(candidate);
      expect(result.blockedReason).toBeNull();
      const allocated = result.progressive!.allocation!.find(
        (row) => row.poId === "po-support",
      )!.allocatedCents;
      const recognized = result
        .progressive!.recognition!.schedule.byPo.filter((row) => row.poId === "po-support")
        .reduce((sum, row) => sum + row.revenueCents, 0);
      return recognized / allocated;
    };
    // 150 of 300 contracted hours.
    expect(ratio(draft)).toBeCloseTo(0.5, 5);
    expect(ratio(merged)).toBeCloseTo(0.5, 5);
  });

  it("keeps the authoritative analysis running through analyzeWorkflow()", () => {
    const result = analyzeWorkflow(merged);
    expect(result.adapterErrors).toEqual([]);
    expect(result.progressive).not.toBeNull();
  });

  it("is stable under a second re-analysis", () => {
    expect(r3OperationalFacts(reanalyze(merged))).toEqual(r3OperationalFacts(draft));
  });
});

/* ======================================================================== *
 * G5 — a real AI lineage: AI-created objects, accountant actuals on top,   *
 * then a materially changed second and third analysis.                     *
 * ======================================================================== */

const RUN_2 = "run-00000000-0000-4000-8000-000000000012";
const RUN_3 = "run-00000000-0000-4000-8000-000000000013";

/** Canonical IDs the real merge derives from the R1 Genomix semantic keys. */
const AI_PO_KEY = "po:saas-platform";
const AI_USAGE_KEY = "vc:sample-overage";
const AI_SLA_KEY = "vc:sla-service-credit";

const ACCOUNTANT_PO_NAME = "Hosted platform — accountant's own description";

function merge(
  analysis: AiContractAnalysis,
  currentDraft: WorkflowDraft,
  currentAiState: AiAnalysisState,
  runId: string,
) {
  return mergeAiAnalysis({
    currentDraft,
    currentAiState,
    analysis,
    runId,
    guidancePack: guidancePackFixture(),
    priorContext: null,
  });
}

/** Run 1: the first AI analysis of the contract, from a genuinely empty state. */
function runOne() {
  return merge(genomixR1Analysis(), createEmptyDraft(), createEmptyAiAnalysisState(), R1_RUN_ID);
}

/**
 * The second analysis materially changes fields the AI still owns: the
 * contract-derived usage rate and the obligation description. It is not a
 * no-op re-run of the first analysis.
 */
function secondAnalysis(): AiContractAnalysis {
  const analysis = genomixR1Analysis();
  analysis.transactionPrice.variableConsiderationComponents[0]!.contractualRateOrAmountInput =
    "1.55";
  analysis.performanceObligations[0]!.description = "Hosted genomics platform subscription (2027)";
  analysis.promises[0]!.description = "Hosted genomics platform access";
  return analysis;
}

const SERIES_PERIODS = [
  { id: "ai-y1", seq: 1, label: "Year 1", startDate: "2026-11-01", endDate: "2027-10-31" },
  { id: "ai-y2", seq: 2, label: "Year 2", startDate: "2027-11-01", endDate: "2028-10-31" },
];

/**
 * The accountant's subsequent operational work, entered on the objects the AI
 * created. Only the draft is edited here; ownership is derived afterwards by
 * the production reconciliation path, never hand-written into the sidecar.
 */
function accountantEdits(draft: WorkflowDraft, ids: LineageIds): WorkflowDraft {
  const usageMeterId = draft.variableConsiderationComponents.find((row) => row.id === ids.usage)!
    .meters[0]!.id;
  return {
    ...draft,
    performanceObligations: draft.performanceObligations.map((po) =>
      po.id === ids.po
        ? {
            ...po,
            // An explicit override of an otherwise AI-owned field.
            name: ACCOUNTANT_PO_NAME,
            // Operational facts only the accountant can know.
            overTimeMeasure: "input_measure" as const,
            totalExpectedUnitsInput: "300",
            unitLabel: "hours",
            progressEvents: [
              { id: `${ids.po}-pe-1`, seq: 1, date: "2027-01-31", unitsInput: "150" },
            ],
            transferStatus: "not_yet_transferred" as const,
          }
        : po,
    ),
    variableConsiderationComponents: draft.variableConsiderationComponents.map(
      (component): VcComponentDraft => {
        if (component.id === ids.usage) {
          return {
            ...component,
            meters: component.meters.map((meter) =>
              meter.id === usageMeterId ? { ...meter, includedQuantityInput: "0" } : meter,
            ),
            usagePeriods: [
              { id: `${ids.usage}-p-2027-02`, month: "2027-02", quantities: { [usageMeterId]: "500" } },
            ],
            seriesPeriods: SERIES_PERIODS.map((period) => ({ ...period })),
            billOnRealization: true,
          };
        }
        if (component.id === ids.sla) {
          return {
            ...component,
            allocationTreatment: "specific_series_period" as const,
            seriesPeriods: SERIES_PERIODS.map((period) => ({ ...period })),
            realizedEvents: [
              {
                id: `${ids.sla}:ai-y1`,
                seq: 1,
                date: "2027-04-30",
                amountInput: "1,500.00",
                seriesPeriodId: "ai-y1",
                description: "Service-level credit issued",
              },
            ],
            billOnRealization: true,
          };
        }
        return component;
      },
    ),
  };
}

interface LineageIds {
  po: string;
  usage: string;
  sla: string;
}

function lineageIds(state: AiAnalysisState): LineageIds {
  return {
    po: state.objectProvenance[AI_PO_KEY]!.canonicalId,
    usage: state.objectProvenance[AI_USAGE_KEY]!.canonicalId,
    sla: state.objectProvenance[AI_SLA_KEY]!.canonicalId,
  };
}

/** Exactly the facts the accountant owns on the AI-created objects. */
function ownedFacts(draft: WorkflowDraft, ids: LineageIds) {
  const po = draft.performanceObligations.find((row) => row.id === ids.po)!;
  const usage = draft.variableConsiderationComponents.find((row) => row.id === ids.usage)!;
  const sla = draft.variableConsiderationComponents.find((row) => row.id === ids.sla)!;
  return {
    po: {
      name: po.name,
      overTimeMeasure: po.overTimeMeasure,
      totalExpectedUnitsInput: po.totalExpectedUnitsInput,
      unitLabel: po.unitLabel,
      progressEvents: po.progressEvents,
      transferStatus: po.transferStatus,
      recognitionDate: po.recognitionDate,
    },
    usage: {
      includedQuantityInput: usage.meters[0]!.includedQuantityInput,
      usagePeriods: usage.usagePeriods,
      seriesPeriods: usage.seriesPeriods,
      billOnRealization: usage.billOnRealization,
    },
    sla: {
      allocationTreatment: sla.allocationTreatment,
      seriesPeriods: sla.seriesPeriods,
      realizedEvents: sla.realizedEvents,
      billOnRealization: sla.billOnRealization,
    },
  };
}

/** The real lineage, built once: run 1 → accountant edit → run 2 → run 3. */
function lineage() {
  const first = runOne();
  const ids = lineageIds(first.aiState);
  const edited = accountantEdits(first.draft, ids);
  const reconciled = reconcileAiEdits({
    previousDraft: first.draft,
    nextDraft: edited,
    currentAiState: first.aiState,
  });
  const second = merge(secondAnalysis(), edited, reconciled.aiState, RUN_2);
  const third = merge(secondAnalysis(), second.draft, second.aiState, RUN_3);
  return { first, ids, edited, reconciled, second, third };
}

const L = lineage();

function meterRate(draft: WorkflowDraft, ids: LineageIds): string {
  return draft.variableConsiderationComponents.find((row) => row.id === ids.usage)!.meters[0]!
    .rateAmountInput;
}

describe("G5 — run 1 creates genuinely AI-owned objects", () => {
  it("records real object provenance for the AI performance obligation and components", () => {
    for (const key of [AI_PO_KEY, AI_USAGE_KEY, AI_SLA_KEY]) {
      const provenance = L.first.aiState.objectProvenance[key];
      expect(`${key}:${provenance?.state}`).toBe(`${key}:ai_generated_untouched`);
      expect(provenance!.lastAiRunId).toBe(R1_RUN_ID);
      expect(provenance!.userModified).toBe(false);
    }
  });

  it("writes the contract-derived usage rate the AI owns", () => {
    expect(meterRate(L.first.draft, L.ids)).toBe("1.35");
  });
});

describe("G5 — run 2 distinguishes accountant ownership from AI ownership", () => {
  it("is not a no-op: the untouched AI-owned usage rate is refreshed", () => {
    expect(meterRate(L.second.draft, L.ids)).toBe("1.55");
  });

  it("leaves every accountant-owned R3 operational fact unchanged", () => {
    expect(ownedFacts(L.second.draft, L.ids)).toEqual(ownedFacts(L.edited, L.ids));
  });

  it("preserves an explicit accountant override of an otherwise AI-owned field", () => {
    expect(L.second.draft.performanceObligations.find((row) => row.id === L.ids.po)!.name).toBe(
      ACCOUNTANT_PO_NAME,
    );
  });

  it("keeps canonical object identity across the two runs", () => {
    expect(lineageIds(L.second.aiState)).toEqual(L.ids);
  });
});

describe("G5 — the resulting provenance is truthful", () => {
  const provenanceOf = (key: string) => L.second.aiState.fieldProvenance[key]?.state ?? null;

  it("keeps the untouched AI-owned rate AI-owned, refreshed by the second run", () => {
    const key = `vc:${L.ids.usage}.meter.rateAmountInput`;
    expect(provenanceOf(key)).toBe("ai_generated_untouched");
    expect(L.second.aiState.fieldProvenance[key]!.lastAiRunId).toBe(RUN_2);
  });

  it("records the accountant's override with user-edited semantics", () => {
    expect(provenanceOf(`po:${L.ids.po}.name`)).toBe("ai_difference_preserved_user_override");
  });

  it("never reclassifies an R3 operational actual as newly AI-generated", () => {
    const operational = [
      `po:${L.ids.po}.overTimeMeasure`,
      `po:${L.ids.po}.totalExpectedUnitsInput`,
      `po:${L.ids.po}.unitLabel`,
      `po:${L.ids.po}.progressEvents`,
      `po:${L.ids.po}.transferStatus`,
      `vc:${L.ids.usage}.usagePeriods`,
      `vc:${L.ids.usage}.seriesPeriods`,
      `vc:${L.ids.usage}.billOnRealization`,
      `vc:${L.ids.usage}.meter.includedQuantityInput`,
      `vc:${L.ids.sla}.seriesPeriods`,
      `vc:${L.ids.sla}.realizedEvents`,
      `vc:${L.ids.sla}.billOnRealization`,
    ];
    for (const key of operational) {
      const state = provenanceOf(key);
      expect(`${key}:${state}`).not.toBe(`${key}:ai_generated_untouched`);
    }
  });

  it("marks the AI objects the accountant worked on as user-modified", () => {
    for (const key of [AI_PO_KEY, AI_USAGE_KEY, AI_SLA_KEY]) {
      expect(`${key}:${L.second.aiState.objectProvenance[key]!.userModified}`).toBe(`${key}:true`);
    }
  });
});

describe("G5 — review behaviour after a real re-analysis", () => {
  // Conclusions that rest only on facts the accountant owns. The usage
  // measurement conclusion is deliberately NOT here: under the accepted
  // material grouping it rests on the recorded quantities AND the
  // contract-derived meter rate, so the AI's rate change must reopen it.
  const operationalTargets = (ids: LineageIds) => [
    `po:${ids.po}.progressEvents`,
    `po:${ids.po}.transferStatus`,
    `vc:${ids.sla}.realizedEvents`,
  ];


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

  it("leaves every accountant operational fingerprint unchanged", () => {
    for (const key of operationalTargets(L.ids)) {
      expect(`${key}:${canonicalReviewTargetFingerprint(L.second.draft, key)}`).toBe(
        `${key}:${canonicalReviewTargetFingerprint(L.edited, key)}`,
      );
    }
  });

  it("reopens only the conclusions the AI actually changed", () => {
    const usageKey = `vc:${L.ids.usage}.usagePeriods`;
    const keys = [...operationalTargets(L.ids), usageKey];
    const approved = keys.map((key) => affirm(itemFor(L.edited, key)));
    const rederived = keys.map((key) => itemFor(L.second.draft, key));
    const carried = new Map(
      carryForwardReviewResolutions(rederived, approved).map((item) => [item.targetKey, item]),
    );
    // The usage conclusion reopens because its AI-owned rate moved...
    expect(`${usageKey}:${carried.get(usageKey)!.state}`).toBe(`${usageKey}:yellow`);
    // ...and nothing else does: an AI description change reopens no
    // accountant-owned operational conclusion.
    for (const key of operationalTargets(L.ids)) {
      expect(`${key}:${carried.get(key)!.state}`).toBe(`${key}:resolved`);
    }
  });
});


describe("G5 — a third re-analysis keeps ownership stable", () => {
  it("still carries every accountant-owned fact", () => {
    expect(ownedFacts(L.third.draft, L.ids)).toEqual(ownedFacts(L.edited, L.ids));
  });

  it("keeps the AI-owned rate at the value the AI last proposed", () => {
    expect(meterRate(L.third.draft, L.ids)).toBe("1.55");
  });

  it("keeps canonical object identity and the accountant's override", () => {
    expect(lineageIds(L.third.aiState)).toEqual(L.ids);
    expect(L.third.draft.performanceObligations.find((row) => row.id === L.ids.po)!.name).toBe(
      ACCOUNTANT_PO_NAME,
    );
  });
});

describe("G5 — accounting authority after re-analysis", () => {
  it("stays on the accepted R3 progressive authority path", () => {
    expect(draftRequiresProgressive(L.second.draft)).toBe(true);
    const result = analyzeWorkflow(L.second.draft);
    expect(result.adapterErrors).toEqual([]);
    expect(result.progressive).not.toBeNull();
  });

  it("reflects the legitimately changed AI-owned rate in usage consideration", () => {
    const usageAt = (draft: WorkflowDraft) =>
      analyzeWorkflow(draft).progressive!.usageAmounts.reduce(
        (sum, row) => sum + Number(row.totalCents),
        0,
      );

    // 500 accountant-recorded samples, at the rate the contract analysis owns.
    expect(usageAt(L.edited)).toBe(67_500);
    expect(usageAt(L.second.draft)).toBe(77_500);
  });
});
