/**
 * Phase 9G-R3 — re-analysis canonical identity hardening.
 *
 * Model `semanticKey` values are model-local aliases, never canonical economic
 * identity. ARC's deterministic adapter owns identity, so a second independent
 * run that renames its own keys must reconcile onto the SAME canonical objects
 * instead of standing duplicates beside the accountant's work.
 *
 * Everything runs through the real `mergeAiAnalysis()` and the real
 * `reconcileAiEdits()`. No model, no network, no database.
 */
import { describe, expect, it } from "vitest";

import { createEmptyDraft, type VcComponentDraft, type WorkflowDraft } from "@/lib/asc606-workflow";

import { reconcileAiEdits } from "../edit-reconciliation";
import { createEmptyAiAnalysisState, mergeAiAnalysis, type AiAnalysisState } from "../merge";
import type { AiContractAnalysis } from "../schema";
import {
  DRIFT_RUN_1,
  DRIFT_RUN_2,
  driftRun1Analysis,
  driftRun2Analysis,
  RUN1,
  RUN2,
} from "./drift-fixtures";
import { guidancePackFixture } from "./merge-fixtures";

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

interface Ids {
  hostedPo: string;
  validationPo: string;
  supportPo: string;
  usageVc: string;
  slaVc: string;
}

function idsOf(state: AiAnalysisState, keys: typeof RUN1 | typeof RUN2): Ids {
  const id = (key: string) => state.objectProvenance[key]?.canonicalId ?? `MISSING:${key}`;
  return {
    hostedPo: id(keys.hostedPo),
    validationPo: id(keys.validationPo),
    supportPo: id(keys.supportPo),
    usageVc: id(keys.usageVc),
    slaVc: id(keys.slaVc),
  };
}

const SERIES_PERIODS = [
  { id: "ai-y1", seq: 1, label: "Year 1", startDate: "2026-11-01", endDate: "2027-10-31" },
  { id: "ai-y2", seq: 2, label: "Year 2", startDate: "2027-11-01", endDate: "2028-10-31" },
];

/** The accountant's own Phase L operational facts, entered on AI-created rows. */
function accountantEdits(draft: WorkflowDraft, ids: Ids): WorkflowDraft {
  const usageMeterId = draft.variableConsiderationComponents.find((row) => row.id === ids.usageVc)!
    .meters[0]!.id;
  return {
    ...draft,
    performanceObligations: draft.performanceObligations.map((po) => {
      if (po.id === ids.hostedPo) return { ...po, classification: "series" as const };
      if (po.id === ids.validationPo) {
        return {
          ...po,
          transferStatus: "transferred" as const,
          recognitionDate: "2027-03-15",
        };
      }
      if (po.id === ids.supportPo) {
        return {
          ...po,
          recognitionMethod: "over_time_ratable" as const,
          overTimeMeasure: "input_measure" as const,
          totalExpectedUnitsInput: "300",
          unitLabel: "hours",
          progressEvents: [
            { id: `${ids.supportPo}-pe-1`, seq: 1, date: "2027-01-31", unitsInput: "150" },
          ],
        };
      }
      return po;
    }),
    variableConsiderationComponents: draft.variableConsiderationComponents.map(
      (component): VcComponentDraft => {
        if (component.id === ids.usageVc) {
          return {
            ...component,
            seriesPeriods: SERIES_PERIODS.map((period) => ({ ...period })),
            usagePeriods: [
              {
                id: `${ids.usageVc}-p-2027-02`,
                month: "2027-02",
                quantities: { [usageMeterId]: "500" },
              },
            ],
          };
        }
        if (component.id === ids.slaVc) {
          return {
            ...component,
            allocationTreatment: "specific_series_period" as const,
            seriesPeriods: SERIES_PERIODS.map((period) => ({ ...period })),
            realizedEvents: [
              {
                id: `${ids.slaVc}:ai-y1`,
                seq: 1,
                date: "2027-04-30",
                amountInput: "1,500.00",
                seriesPeriodId: "ai-y1",
                description: "Service-level credit issued",
              },
            ],
            billOnRealization: false,
          };
        }
        return component;
      },
    ),
  };
}

/** Exactly the facts the accountant owns, read off the canonical run-1 rows. */
function ownedFacts(draft: WorkflowDraft, ids: Ids) {
  const po = (id: string) => draft.performanceObligations.find((row) => row.id === id)!;
  const vc = (id: string) => draft.variableConsiderationComponents.find((row) => row.id === id)!;
  return {
    hostedClassification: po(ids.hostedPo).classification,
    validationRecognitionDate: po(ids.validationPo).recognitionDate,
    validationTransferStatus: po(ids.validationPo).transferStatus,
    supportMethod: po(ids.supportPo).recognitionMethod,
    supportMeasure: po(ids.supportPo).overTimeMeasure,
    supportUnits: po(ids.supportPo).totalExpectedUnitsInput,
    supportUnitLabel: po(ids.supportPo).unitLabel,
    supportProgress: po(ids.supportPo).progressEvents,
    usagePeriods: vc(ids.usageVc).usagePeriods,
    usageSeriesPeriods: vc(ids.usageVc).seriesPeriods,
    slaAllocation: vc(ids.slaVc).allocationTreatment,
    slaSeriesPeriods: vc(ids.slaVc).seriesPeriods,
    slaRealized: vc(ids.slaVc).realizedEvents,
    slaBillOnRealization: vc(ids.slaVc).billOnRealization,
  };
}

function lineage(secondAnalysis: AiContractAnalysis = driftRun2Analysis()) {
  const first = merge(
    driftRun1Analysis(),
    createEmptyDraft(),
    createEmptyAiAnalysisState(),
    DRIFT_RUN_1,
  );
  const ids = idsOf(first.aiState, RUN1);
  const edited = accountantEdits(first.draft, ids);
  const reconciled = reconcileAiEdits({
    previousDraft: first.draft,
    nextDraft: edited,
    currentAiState: first.aiState,
  });
  const second = merge(secondAnalysis, edited, reconciled.aiState, DRIFT_RUN_2);
  return { first, ids, edited, second };
}

const L = lineage();

describe("re-analysis identity — semantic-key drift does not duplicate economic objects", () => {
  it("keeps exactly three performance obligations across the two runs", () => {
    expect(L.first.draft.performanceObligations).toHaveLength(3);
    expect(L.second.draft.performanceObligations).toHaveLength(3);
  });

  it("keeps exactly two variable-consideration components across the two runs", () => {
    expect(L.second.draft.variableConsiderationComponents).toHaveLength(2);
  });

  it("adds only the one genuinely new promise", () => {
    expect(L.first.draft.promises).toHaveLength(4);
    expect(L.second.draft.promises).toHaveLength(5);
  });

  it("maps every renamed run-2 key onto the run-1 canonical object", () => {
    expect(idsOf(L.second.aiState, RUN2)).toEqual(L.ids);
  });

  it("does not report the renamed run-1 objects as omitted by the model", () => {
    const omitted = L.second.issues.filter((issue) => issue.reasonCode === "ai_proposal_omitted");
    expect(omitted).toEqual([]);
  });

  it("gives no canonical object two owning semantic keys", () => {
    const owned = Object.values(L.second.aiState.objectProvenance).map(
      (provenance) => provenance.canonicalId,
    );
    expect(new Set(owned).size).toBe(owned.length);
  });

  it("keeps the renamed key's lineage back to the run-1 key", () => {
    const provenance = L.second.aiState.objectProvenance[RUN2.supportPo]!;
    expect(provenance.previousSemanticKeys).toContain(RUN1.supportPo);
  });
});

describe("re-analysis identity — accountant-owned facts stay on their canonical rows", () => {
  it("preserves every Phase L operational fact", () => {
    expect(ownedFacts(L.second.draft, L.ids)).toEqual(ownedFacts(L.edited, L.ids));
  });

  it("never overwrites the accountant's input measure with the model's output method", () => {
    const po = L.second.draft.performanceObligations.find((row) => row.id === L.ids.supportPo)!;
    expect(po.recognitionMethod).toBe("over_time_ratable");
    expect(po.overTimeMeasure).toBe("input_measure");
  });

  it("still refreshes AI-owned untouched values under the renamed key", () => {
    const usage = L.second.draft.variableConsiderationComponents.find(
      (row) => row.id === L.ids.usageVc,
    )!;
    expect(usage.meters[0]!.rateAmountInput).toBe("1.55");
  });

  it("re-points the renamed variable-consideration target at the canonical hosted obligation", () => {
    const sla = L.second.draft.variableConsiderationComponents.find(
      (row) => row.id === L.ids.slaVc,
    )!;
    expect(sla.targetPoId).toBe(L.ids.hostedPo);
  });

  it("assigns the genuinely new promise to the existing hosted obligation", () => {
    const newPromise = L.second.draft.promises.find(
      (row) => row.id === L.second.aiState.objectProvenance[RUN2.slaPromise]?.canonicalId,
    )!;
    expect(newPromise.performanceObligationId).toBe(L.ids.hostedPo);
  });
});

describe("re-analysis identity — reconciliation fails closed", () => {
  it("does not collapse two economically distinct usage components", () => {
    const analysis = driftRun2Analysis();
    const existing = analysis.transactionPrice.variableConsiderationComponents[0]!;
    analysis.transactionPrice.variableConsiderationComponents = [
      existing,
      {
        ...existing,
        semanticKey: "vc:priority-lane-usage",
        description: "Priority lane processing usage",
        contractualRateOrAmountInput: "4.10",
        citations: [
          {
            documentId: "doc-r1-fixture-1",
            pageStart: 7,
            pageEnd: 7,
            evidenceMode: "text" as const,
            excerpt: "priority lane",
          },
        ],
      },
      analysis.transactionPrice.variableConsiderationComponents[1]!,
    ];
    const run = lineage(analysis);
    expect(run.second.draft.variableConsiderationComponents).toHaveLength(3);
  });

  it("creates a genuinely new object rather than matching an unrelated one", () => {
    const analysis = driftRun2Analysis();
    analysis.promises = [
      ...analysis.promises,
      {
        ...analysis.promises[0]!,
        semanticKey: "promise:on-site-training",
        description: "On-site operator training",
        promiseType: "training",
        citations: [
          {
            documentId: "doc-r1-fixture-1",
            pageStart: 9,
            pageEnd: 9,
            evidenceMode: "text" as const,
            excerpt: "training",
          },
        ],
      },
    ];
    const run = lineage(analysis);
    expect(run.second.draft.promises).toHaveLength(6);
  });

  it("refuses to choose between two equally plausible candidates", () => {
    // Two run-2 support promises carry the SAME evidence and the same type as
    // the single run-1 support promise: nothing distinguishes them, so neither
    // may claim the incumbent by arbitrary order.
    const analysis = driftRun2Analysis();
    analysis.promises = analysis.promises.map((row) =>
      row.semanticKey === RUN2.slaPromise
        ? {
            ...row,
            citations: [
              {
                documentId: "doc-r1-fixture-1",
                pageStart: 4,
                pageEnd: 4,
                evidenceMode: "text" as const,
                excerpt: "support",
              },
            ],
            description: "Dedicated engineering support, 40 hours annually",
          }
        : row,
    );
    const run = lineage(analysis);
    const ambiguous = run.second.issues.filter(
      (issue) => issue.reasonCode === "unsafe_semantic_relationship",
    );
    expect(ambiguous.length).toBeGreaterThan(0);
  });

  it("still reports a genuinely absent economic object as omitted", () => {
    const analysis = driftRun2Analysis();
    analysis.promises = analysis.promises.filter(
      (row) => row.semanticKey !== RUN2.validationPromise,
    );
    analysis.performanceObligations = analysis.performanceObligations.filter(
      (row) => row.semanticKey !== RUN2.validationPo,
    );
    analysis.recognitionProposals = analysis.recognitionProposals.filter(
      (row) => row.performanceObligationKey !== RUN2.validationPo,
    );
    analysis.sspAndAllocation.items = analysis.sspAndAllocation.items.filter(
      (row) => row.appliesToKey !== RUN2.validationPo,
    );
    const run = lineage(analysis);
    const omitted = run.second.issues.filter((issue) => issue.reasonCode === "ai_proposal_omitted");
    expect(omitted.length).toBeGreaterThan(0);
    // The canonical row itself is never removed.
    expect(run.second.draft.performanceObligations).toHaveLength(3);
  });
});

describe("re-analysis identity — aliases persist for the next run", () => {
  it("reuses the same canonical objects on a third run with the run-2 keys", () => {
    const third = merge(driftRun2Analysis(), L.second.draft, L.second.aiState, "run-third");
    expect(idsOf(third.aiState, RUN2)).toEqual(L.ids);
    expect(third.draft.performanceObligations).toHaveLength(3);
  });
});
