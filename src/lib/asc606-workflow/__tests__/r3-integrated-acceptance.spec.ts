/**
 * Phase 9G-R3, Section K. Integrated acceptance for the whole R3 story.
 *
 * One contract (fictional), carried through its real life: inception, a
 * delivery, hours incurred, a realized service-level credit, persistence,
 * reload, AI re-analysis and finalization. Every step travels a production
 * boundary — analyzeWorkflow(), the real persistence validator/serializer, the
 * real AI merge engine — never a test-only helper.
 *
 * All companies, customers and amounts are fictional.
 */
import { describe, expect, it } from "vitest";

import { createEmptyAiAnalysisState, mergeAiAnalysis } from "@/lib/arc/ai/merge";
import {
  fixtureAAnalysis,
  guidancePackFixture,
  RUN_ID,
} from "@/lib/arc/ai/__tests__/merge-fixtures";
import {
  parseCanonicalInputs,
  serializeDraft,
  toCanonicalInputs,
  validateDraftForPersistence,
} from "@/lib/arc/persistence/schema";

import { analyzeWorkflow } from "../analysis";
import type { WorkflowDraft } from "../types";
import {
  genomixR3Draft,
  withRealizedCredit,
  withSupportHours,
  withValidationTransfer,
  GENOMIX_FIXED_CENTS,
  GENOMIX_HOSTED_CENTS,
  GENOMIX_SUPPORT_CENTS,
  GENOMIX_VALIDATION_CENTS,
} from "./genomix-r3-fixture";

/** The production analysis boundary; never a direct engine call. */
function analyze(draft: WorkflowDraft) {
  const result = analyzeWorkflow(draft);
  expect(result.adapterErrors).toEqual([]);
  expect(result.blockedReason).toBeNull();
  expect(result.progressive).not.toBeNull();
  return result;
}

/** Total revenue the progressive schedule recognizes for one obligation. */
function recognizedFor(result: ReturnType<typeof analyze>, poId: string): number {
  return result
    .progressive!.recognition!.schedule.byPo.filter((row) => row.poId === poId)
    .reduce((sum, row) => sum + row.revenueCents, 0);
}

/**
 * A real save/reload: the draft is validated for persistence, canonicalised,
 * serialised and parsed back — exactly the path the workspace uses. This is
 * not JSON.stringify round-tripping of an in-memory object.
 */
function saveAndReload(draft: WorkflowDraft): WorkflowDraft {
  const validation = validateDraftForPersistence(draft);
  expect(validation.ok).toBe(true);
  const stored = JSON.parse(JSON.stringify(toCanonicalInputs(draft))) as unknown;
  const parsed = parseCanonicalInputs(stored);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error("persistence round-trip failed");
  return parsed.draft;
}

/** The R3 operational facts that belong to the accountant, and to nobody else. */
function r3Facts(draft: WorkflowDraft) {
  const po = (id: string) => draft.performanceObligations.find((row) => row.id === id)!;
  const vc = (id: string) => draft.variableConsiderationComponents.find((row) => row.id === id)!;
  return {
    support: {
      overTimeMeasure: po("po-support").overTimeMeasure,
      totalExpectedUnitsInput: po("po-support").totalExpectedUnitsInput,
      unitLabel: po("po-support").unitLabel,
      progressEvents: po("po-support").progressEvents,
    },
    validation: {
      transferStatus: po("po-validation").transferStatus,
      recognitionDate: po("po-validation").recognitionDate,
    },
    sla: {
      seriesPeriods: vc("vc-sla").seriesPeriods,
      realizedEvents: vc("vc-sla").realizedEvents,
      billOnRealization: vc("vc-sla").billOnRealization,
    },
  };
}

const HOURS = [
  { id: "po-support-pe-1", seq: 1, date: "2027-03-31", unitsInput: "50" },
  { id: "po-support-pe-2", seq: 2, date: "2027-06-30", unitsInput: "30" },
];

/** The fully-progressed contract used by the later steps. */
function livedContract(): WorkflowDraft {
  return withRealizedCredit(
    withSupportHours(withValidationTransfer(genomixR3Draft(), "2027-02-15"), HOURS),
    "5,000.00",
    "q3",
    "2027-09-30",
  );
}

describe("K1 — inception", () => {
  const result = analyze(genomixR3Draft());

  it("allocates the fixed consideration across the obligations", () => {
    const byPo = new Map(result.progressive!.allocation!.map((row) => [row.poId, row]));
    expect(byPo.get("po-hosted")!.allocatedCents).toBe(GENOMIX_HOSTED_CENTS);
    expect(byPo.get("po-validation")!.allocatedCents).toBe(GENOMIX_VALIDATION_CENTS);
    expect(byPo.get("po-support")!.allocatedCents).toBe(GENOMIX_SUPPORT_CENTS);
    const total = [...byPo.values()].reduce((sum, row) => sum + row.allocatedCents, 0);
    expect(total).toBe(GENOMIX_FIXED_CENTS);
  });

  it("recognizes nothing for an obligation that has not transferred", () => {
    expect(recognizedFor(result, "po-validation")).toBe(0);
  });

  it("recognizes nothing for support before any hours are incurred", () => {
    expect(recognizedFor(result, "po-support")).toBe(0);
  });
});

describe("K2 — the delivered obligation transfers", () => {
  it("recognizes the validation obligation on the accountant's transfer date", () => {
    const draft = saveAndReload(withValidationTransfer(genomixR3Draft(), "2027-02-15"));
    const result = analyze(draft);
    expect(recognizedFor(result, "po-validation")).toBe(GENOMIX_VALIDATION_CENTS);
  });
});

describe("K3 — hours are incurred against the input measure", () => {
  it("recognizes support in proportion to the accountant's hours, never beyond", () => {
    const draft = saveAndReload(
      withSupportHours(withValidationTransfer(genomixR3Draft(), "2027-02-15"), HOURS),
    );
    const result = analyze(draft);
    const recognized = recognizedFor(result, "po-support");
    // 80 of 200 hours.
    expect(recognized).toBe((GENOMIX_SUPPORT_CENTS * 80) / 200);
    expect(recognized).toBeLessThan(GENOMIX_SUPPORT_CENTS);
  });
});

describe("K4 — a service-level credit is actually realized", () => {
  const totalRecognized = (draft: WorkflowDraft) =>
    analyze(draft).progressive!.recognition!.schedule.totalCents;

  it("reduces recognized revenue once a credit has actually arisen", () => {
    const before = withSupportHours(withValidationTransfer(genomixR3Draft(), "2027-02-15"), HOURS);
    const after = saveAndReload(livedContract());
    expect(totalRecognized(after)).toBeLessThan(totalRecognized(before));
  });

  it("keeps the contract internally reconciled before and after the credit", () => {
    expect(analyze(saveAndReload(livedContract())).progressive!.reconciliation!.balanced).toBe(
      true,
    );
    expect(
      analyze(saveAndReload(withSupportHours(genomixR3Draft(), HOURS))).progressive!
        .reconciliation!.balanced,
    ).toBe(true);
  });
});

describe("K5 — every progressive step survives a real save and reload", () => {
  const stages: ReadonlyArray<readonly [string, WorkflowDraft]> = [
    ["inception", genomixR3Draft()],
    ["transfer", withValidationTransfer(genomixR3Draft(), "2027-02-15")],
    ["hours", withSupportHours(withValidationTransfer(genomixR3Draft(), "2027-02-15"), HOURS)],
    ["realized credit", livedContract()],
  ];

  for (const [name, draft] of stages) {
    it(`reloads ${name} with identical facts and identical accounting`, () => {
      const reloaded = saveAndReload(draft);
      expect(r3Facts(reloaded)).toEqual(r3Facts(draft));
      expect(analyze(reloaded).progressive).toEqual(analyze(draft).progressive);
    });
  }

  it("canonicalises the same facts on every save", () => {
    const draft = livedContract();
    expect(serializeDraft(saveAndReload(draft))).toBe(serializeDraft(draft));
    expect(toCanonicalInputs(saveAndReload(draft))).toEqual(toCanonicalInputs(draft));
  });
});

describe("K8 — AI re-analysis never overwrites an accountant's R3 facts", () => {
  it("preserves progress events, transfer facts and realized amounts", () => {
    const draft = livedContract();
    const merged = mergeAiAnalysis({
      currentDraft: draft,
      currentAiState: createEmptyAiAnalysisState(),
      analysis: fixtureAAnalysis(),
      runId: RUN_ID,
      guidancePack: guidancePackFixture(),
      priorContext: null,
    });
    expect(r3Facts(merged.draft)).toEqual(r3Facts(draft));
  });

  it("leaves the resulting accounting for those facts unchanged", () => {
    const draft = livedContract();
    const merged = mergeAiAnalysis({
      currentDraft: draft,
      currentAiState: createEmptyAiAnalysisState(),
      analysis: fixtureAAnalysis(),
      runId: RUN_ID,
      guidancePack: guidancePackFixture(),
      priorContext: null,
    });
    expect(recognizedFor(analyze(merged.draft), "po-support")).toBe(
      recognizedFor(analyze(draft), "po-support"),
    );
    expect(recognizedFor(analyze(merged.draft), "po-validation")).toBe(
      recognizedFor(analyze(draft), "po-validation"),
    );
  });

  it("survives a save and reload after re-analysis", () => {
    const draft = livedContract();
    const merged = mergeAiAnalysis({
      currentDraft: draft,
      currentAiState: createEmptyAiAnalysisState(),
      analysis: fixtureAAnalysis(),
      runId: RUN_ID,
      guidancePack: guidancePackFixture(),
      priorContext: null,
    });
    expect(r3Facts(saveAndReload(merged.draft))).toEqual(r3Facts(draft));
  });
});
