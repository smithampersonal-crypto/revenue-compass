/**
 * Phase 9G-R3, Section K. Integrated acceptance for the accepted Genomix
 * benchmark, carried end to end as a REAL canonical WorkflowDraft.
 *
 * Every accounting number below is read from the authoritative
 * `analyzeWorkflow()` progressive result or from the real workpaper /
 * finalization snapshot boundary. Nothing is recomputed here, and no direct
 * `ProgressiveContractInput` substitute is used anywhere.
 *
 * All companies, customers and amounts are fictional demonstration data.
 */
import { describe, expect, it } from "vitest";

import {
  canonicalReviewTargetFingerprint,
  carryForwardReviewResolutions,
  deriveReviewItem,
  type AiReviewItem,
} from "@/lib/arc/ai";
import {
  buildFinalizationSnapshot,
  buildWorkpaper,
  parseCanonicalInputs,
  toCanonicalInputs,
  validateDraftForPersistence,
} from "@/lib/arc/persistence";

import { analyzeWorkflow } from "../analysis";
import type { WorkflowDraft } from "../types";
import {
  genomixBenchmarkDraft,
  withRealizedCredit,
  withSupportHours,
  withUsageActual,
  withValidationTransfer,
  GENOMIX_FIXED_CENTS,
  GENOMIX_HOSTED_CENTS,
  GENOMIX_SERVICE_END,
  GENOMIX_SERVICE_START,
  GENOMIX_SUPPORT_CENTS,
  GENOMIX_SUPPORT_UNITS,
  GENOMIX_VALIDATION_CENTS,
} from "./genomix-k-fixture";

/* ------------------------------------------------------------------ helpers */

type Analysis = ReturnType<typeof analyzeWorkflow>;

/** The production analysis boundary; never a direct engine call. */
function analyze(draft: WorkflowDraft): Analysis {
  const result = analyzeWorkflow(draft);
  expect(result.adapterErrors).toEqual([]);
  expect(result.blockedReason).toBeNull();
  expect(result.progressive).not.toBeNull();
  return result;
}

function progressive(draft: WorkflowDraft) {
  return analyze(draft).progressive!;
}

/** Total revenue the progressive schedule recognizes for one obligation. */
function recognizedFor(draft: WorkflowDraft, poId: string): number {
  return progressive(draft)
    .recognition!.schedule.byPo.filter((row) => row.poId === poId)
    .reduce((sum, row) => sum + row.revenueCents, 0);
}

function allocatedFor(draft: WorkflowDraft, poId: string): number {
  return progressive(draft).allocation!.find((row) => row.poId === poId)!.allocatedCents;
}

/** A real save/reload through the canonical persistence path. */
function saveAndReload(draft: WorkflowDraft): WorkflowDraft {
  const validation = validateDraftForPersistence(draft);
  expect(validation.ok).toBe(true);
  const stored = JSON.parse(JSON.stringify(toCanonicalInputs(draft))) as unknown;
  const parsed = parseCanonicalInputs(stored);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error("persistence round-trip failed");
  return parsed.draft;
}

/**
 * The complete R3 operational fact set that belongs to the accountant. Every
 * field named in the closure patch is compared, not a sample of them.
 */
function r3Facts(draft: WorkflowDraft) {
  const po = (id: string) => draft.performanceObligations.find((row) => row.id === id)!;
  const vc = (id: string) => draft.variableConsiderationComponents.find((row) => row.id === id)!;
  const support = po("po-support");
  const validation = po("po-validation");
  const sla = vc("vc-sla");
  const usage = vc("vc-usage");
  return {
    support: {
      transferStatus: support.transferStatus,
      recognitionDate: support.recognitionDate,
      overTimeMeasure: support.overTimeMeasure,
      totalExpectedUnitsInput: support.totalExpectedUnitsInput,
      unitLabel: support.unitLabel,
      progressEvents: support.progressEvents,
    },
    validation: {
      transferStatus: validation.transferStatus,
      recognitionDate: validation.recognitionDate,
    },
    sla: {
      allocationTreatment: sla.allocationTreatment,
      targetPoId: sla.targetPoId,
      inception: sla.inception,
      remeasurements: sla.remeasurements,
      hasResolution: sla.hasResolution,
      resolutionDate: sla.resolutionDate,
      resolutionAmountInput: sla.resolutionAmountInput,
      seriesPeriods: sla.seriesPeriods,
      realizedEvents: sla.realizedEvents,
      billOnRealization: sla.billOnRealization,
    },
    usage: {
      allocationTreatment: usage.allocationTreatment,
      targetPoId: usage.targetPoId,
      meters: usage.meters,
      usagePeriods: usage.usagePeriods,
      seriesPeriods: usage.seriesPeriods,
      billOnRealization: usage.billOnRealization,
    },
    billing: {
      considerationEvents: draft.contractBalances.considerationEvents,
      cashCollections: draft.contractBalances.cashCollections,
    },
  };
}

/* ---------------------------------------------------- review fingerprint set */

const REVIEW_TARGETS = [
  "po:po-validation.transferStatus",
  "po:po-validation.recognitionDate",
  "po:po-support.progressEvents",
  "po:po-hosted.servicePeriod",
  "vc:vc-sla.seriesPeriods",
  "vc:vc-sla.realizedEvents",
  "vc:vc-usage.usagePeriods",
  "vc:vc-usage.meter.rateAmountInput",
] as const;

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

/**
 * Proves the real review machinery reopens the conclusions the mutation
 * belongs to, and carries at least one unrelated approval forward.
 */
function expectSelectiveReopen(
  before: WorkflowDraft,
  after: WorkflowDraft,
  reopened: readonly string[],
): void {
  const approved = REVIEW_TARGETS.map((key) => affirm(itemFor(before, key)));
  const rederived = REVIEW_TARGETS.map((key) => itemFor(after, key));
  const carried = new Map(
    carryForwardReviewResolutions(rederived, approved).map((item) => [item.targetKey, item]),
  );
  const reopenedSet = new Set(reopened);
  let carriedForward = 0;
  for (const key of REVIEW_TARGETS) {
    const state = carried.get(key)!.state;
    if (reopenedSet.has(key)) {
      expect(`${key}:${state}`).toBe(`${key}:yellow`);
      expect(canonicalReviewTargetFingerprint(after, key)).not.toBe(
        canonicalReviewTargetFingerprint(before, key),
      );
    } else {
      expect(`${key}:${state}`).toBe(`${key}:resolved`);
      carriedForward += 1;
    }
  }
  expect(carriedForward).toBeGreaterThan(0);
}

/* --------------------------------------------------------- K1 — at inception */

describe("K1 — inception", () => {
  const draft = genomixBenchmarkDraft();

  it("prices and allocates the fixed consideration exactly as the benchmark", () => {
    const result = progressive(draft);
    expect(result.transactionPriceCents).toBe(GENOMIX_FIXED_CENTS);
    expect(allocatedFor(draft, "po-hosted")).toBe(GENOMIX_HOSTED_CENTS);
    expect(allocatedFor(draft, "po-validation")).toBe(GENOMIX_VALIDATION_CENTS);
    expect(allocatedFor(draft, "po-support")).toBe(GENOMIX_SUPPORT_CENTS);
    expect(result.allocation!.reduce((sum, row) => sum + row.allocatedCents, 0)).toBe(
      GENOMIX_FIXED_CENTS,
    );
  });

  it("schedules the hosted obligation immediately across the contractual term", () => {
    const schedule = progressive(draft).recognition!.schedule;
    const hosted = schedule.byPo.filter((row) => row.poId === "po-hosted");
    expect(hosted.length).toBeGreaterThan(0);
    expect(schedule.firstMonth).toBe(GENOMIX_SERVICE_START.slice(0, 7));
    expect(schedule.lastMonth).toBe(GENOMIX_SERVICE_END.slice(0, 7));
    expect(recognizedFor(draft, "po-hosted")).toBe(GENOMIX_HOSTED_CENTS);
  });

  it("recognizes nothing for the obligation that has not transferred", () => {
    expect(recognizedFor(draft, "po-validation")).toBe(0);
    const row = progressive(draft).reconciliation!.byPo.find(
      (entry) => entry.poId === "po-validation",
    )!;
    expect(row.pendingCents).toBe(GENOMIX_VALIDATION_CENTS);
  });

  it("recognizes nothing for support before any actual hours exist", () => {
    expect(recognizedFor(draft, "po-support")).toBe(0);
    const row = progressive(draft).reconciliation!.byPo.find(
      (entry) => entry.poId === "po-support",
    )!;
    expect(row.pendingCents).toBe(GENOMIX_SUPPORT_CENTS);
  });

  it("creates no usage consideration and no service-level credit before either occurs", () => {
    const result = progressive(draft);
    expect(result.usageAmounts).toEqual([]);
    expect(result.transactionPriceCents).toBe(GENOMIX_FIXED_CENTS);
  });

  it("shows the two contractual fixed billings and no fabricated billing", () => {
    const events = progressive(draft).billing.events;
    const fixed = events.filter((event) => event.kind === "fixed");
    expect(fixed.map((event) => event.amountCents)).toEqual([24_500_000, 24_500_000]);
    expect(fixed.map((event) => event.date)).toEqual(["2026-11-01", "2027-11-01"]);
    expect(events.filter((event) => event.kind !== "fixed")).toEqual([]);
  });

  it("presents partial but valid balances and only the known journals", () => {
    const result = analyze(draft);
    expect(result.progressiveGate.engineBlocked).toBe(false);
    expect(result.progressiveGate.dependencyBlockers).toEqual([]);
    expect(result.progressiveGate.balancesPresentable).toBe(true);
    const journals = result.progressive!.journals!;
    expect(journals.balanced).toBe(true);
    expect(journals.entries.length).toBeGreaterThan(0);
    // Nothing is journalised for activity that has not happened.
    for (const entry of journals.entries) {
      expect(entry.sourceId ?? "").not.toContain("vc-usage");
      expect(entry.sourceId ?? "").not.toContain("vc-sla");
    }
    expect(journals.pendingEvents.length).toBeGreaterThan(0);
  });

  it("gives the workpaper and the progressive result the same accounting", () => {
    expect(buildWorkpaper(draft).workflow.progressive).toEqual(analyze(draft).progressive);
  });

  it("cannot be finalized at inception", () => {
    expect(progressive(draft).state).not.toBe("complete");
    expect(buildFinalizationSnapshot(draft).ok).toBe(false);
  });
});

/* ------------------------------------------------------- K2..K5 — mutations */

const BASE = genomixBenchmarkDraft();
const TRANSFER_DATE = "2027-03-15";
const HOURS = [
  { id: "po-support-pe-1", seq: 1, date: "2027-01-31", unitsInput: "150" },
  { id: "po-support-pe-2", seq: 2, date: "2028-10-31", unitsInput: "150" },
];

/** Obligations whose accounting a mutation must leave completely alone. */
function untouched(before: WorkflowDraft, after: WorkflowDraft, poIds: readonly string[]): void {
  for (const poId of poIds) {
    expect(`${poId}:${recognizedFor(after, poId)}`).toBe(`${poId}:${recognizedFor(before, poId)}`);
    expect(`${poId}:${allocatedFor(after, poId)}`).toBe(`${poId}:${allocatedFor(before, poId)}`);
  }
}

describe("K2 — mutation 1: the validation service actually transfers", () => {
  const after = withValidationTransfer(BASE, TRANSFER_DATE);

  it("recognizes validation on the accountant's own transfer date", () => {
    expect(recognizedFor(after, "po-validation")).toBe(GENOMIX_VALIDATION_CENTS);
    const month = progressive(after).recognition!.schedule.byPo.find(
      (row) => row.poId === "po-validation" && row.revenueCents > 0,
    )!;
    expect(month.month).toBe(TRANSFER_DATE.slice(0, 7));
  });

  it("changes nothing about hosted, support or usage", () => {
    untouched(BASE, after, ["po-hosted", "po-support"]);
    expect(progressive(after).usageAmounts).toEqual([]);
  });

  it("survives a real save and reload with identical facts and accounting", () => {
    const reloaded = saveAndReload(after);
    expect(r3Facts(reloaded)).toEqual(r3Facts(after));
    expect(analyze(reloaded).progressive).toEqual(analyze(after).progressive);
  });

  it("reopens only the transfer conclusion and carries other approvals forward", () => {
    expectSelectiveReopen(BASE, after, [
      "po:po-validation.transferStatus",
      "po:po-validation.recognitionDate",
    ]);
  });
});

describe("K3 — mutation 2: actual support hours are incurred", () => {
  const before = withValidationTransfer(BASE, TRANSFER_DATE);
  const after = withSupportHours(before, [HOURS[0]!]);

  it("recognizes support in proportion to the hours actually incurred", () => {
    expect(recognizedFor(after, "po-support")).toBe(
      (GENOMIX_SUPPORT_CENTS * 150) / GENOMIX_SUPPORT_UNITS,
    );
    expect(recognizedFor(after, "po-support")).toBeLessThan(GENOMIX_SUPPORT_CENTS);
  });

  it("changes nothing about hosted, validation or usage", () => {
    untouched(before, after, ["po-hosted", "po-validation"]);
    expect(progressive(after).usageAmounts).toEqual([]);
  });

  it("survives a real save and reload with identical facts and accounting", () => {
    const reloaded = saveAndReload(after);
    expect(r3Facts(reloaded)).toEqual(r3Facts(after));
    expect(analyze(reloaded).progressive).toEqual(analyze(after).progressive);
  });

  it("reopens only the support-progress conclusion", () => {
    expectSelectiveReopen(before, after, ["po:po-support.progressEvents"]);
  });
});

describe("K4 — mutation 3: real Tier 2 usage is measured", () => {
  const before = withSupportHours(withValidationTransfer(BASE, TRANSFER_DATE), [HOURS[0]!]);
  const after = withUsageActual(before, "2027-02", "500");
  const USAGE_CENTS = 500 * 1_200;

  it("prices the actual usage deterministically at the contractual rate", () => {
    const amounts = progressive(after).usageAmounts;
    expect(amounts).toHaveLength(1);
    expect(amounts[0]!.month).toBe("2027-02");
    expect(amounts[0]!.totalCents).toBe(USAGE_CENTS);
    expect(progressive(after).transactionPriceCents).toBe(GENOMIX_FIXED_CENTS + USAGE_CENTS);
  });

  it("creates usage consideration only for the month actually measured", () => {
    const months = progressive(after).usageAmounts.map((row) => row.month);
    expect(months).toEqual(["2027-02"]);
  });

  it("bills the usage only under the accepted contractual rule", () => {
    const variable = progressive(after).billing.events.filter(
      (event) => event.componentId === "vc-usage",
    );
    expect(variable).toHaveLength(1);
    expect(variable[0]!.amountCents).toBe(USAGE_CENTS);
    expect(variable[0]!.month).toBe("2027-02");
  });

  it("leaves validation, support and the service-level credit untouched", () => {
    untouched(before, after, ["po-validation", "po-support"]);
    expect(
      progressive(after).billing.events.filter((event) => event.componentId === "vc-sla"),
    ).toEqual([]);
  });

  it("survives a real save and reload with identical facts and accounting", () => {
    const reloaded = saveAndReload(after);
    expect(r3Facts(reloaded)).toEqual(r3Facts(after));
    expect(analyze(reloaded).progressive).toEqual(analyze(after).progressive);
  });

  it("reopens only the usage conclusion", () => {
    expectSelectiveReopen(before, after, ["vc:vc-usage.usagePeriods"]);
  });
});

describe("K5 — mutation 4: a service-level credit is actually realized", () => {
  const before = withUsageActual(
    withSupportHours(withValidationTransfer(BASE, TRANSFER_DATE), [HOURS[0]!]),
    "2027-02",
    "500",
  );
  const after = withRealizedCredit(before, "1,500.00", "y1", "2027-04-30");

  it("reduces the transaction price by exactly the realized credit", () => {
    expect(progressive(after).transactionPriceCents).toBe(
      progressive(before).transactionPriceCents - 150_000,
    );
  });

  it("changes only the targeted service period's obligation", () => {
    untouched(before, after, ["po-validation", "po-support"]);
    expect(recognizedFor(after, "po-hosted")).toBeLessThan(recognizedFor(before, "po-hosted"));
  });

  it("presents any reversal as balanced journal lines with non-negative amounts", () => {
    const journals = progressive(after).journals!;
    expect(journals.balanced).toBe(true);
    for (const entry of journals.entries) {
      for (const line of entry.lines) {
        expect(line.debitCents).toBeGreaterThanOrEqual(0);
        expect(line.creditCents).toBeGreaterThanOrEqual(0);
      }
      expect(entry.totalDebitsCents).toBe(entry.totalCreditsCents);
    }
  });

  it("issues a credit memo only because bill-on-realization requires it", () => {
    const credit = progressive(after).billing.events.filter(
      (event) => event.componentId === "vc-sla",
    );
    expect(credit).toHaveLength(1);
    expect(credit[0]!.amountCents).toBe(-150_000);
    expect(credit[0]!.date).toBe("2027-04-30");
  });

  it("survives a real save and reload with identical facts and accounting", () => {
    const reloaded = saveAndReload(after);
    expect(r3Facts(reloaded)).toEqual(r3Facts(after));
    expect(analyze(reloaded).progressive).toEqual(analyze(after).progressive);
  });

  it("reopens only the realized-credit conclusion", () => {
    expectSelectiveReopen(before, after, ["vc:vc-sla.realizedEvents"]);
  });
});

/* ------------------------------------------- K6 — the complete R3 fact set */

describe("K6 — every R3 operational fact survives the canonical round-trip", () => {
  const stages: ReadonlyArray<readonly [string, WorkflowDraft]> = [
    ["inception", BASE],
    ["validation transfer", withValidationTransfer(BASE, TRANSFER_DATE)],
    ["support hours", withSupportHours(withValidationTransfer(BASE, TRANSFER_DATE), HOURS)],
    ["usage actual", withUsageActual(BASE, "2027-02", "500")],
    ["realized credit", withRealizedCredit(BASE, "1,500.00", "y1", "2027-04-30")],
  ];

  for (const [name, draft] of stages) {
    it(`preserves every accountant-owned fact at ${name}`, () => {
      expect(r3Facts(saveAndReload(draft))).toEqual(r3Facts(draft));
    });
  }

  it("canonicalises the same facts on every save", () => {
    const draft = stages[4]![1];
    expect(toCanonicalInputs(saveAndReload(draft))).toEqual(toCanonicalInputs(draft));
  });
});

/* -------------------------------------------------- K7 — the resolved state */

/** The contract once every operational fact the engine models is known. */
export function genomixResolvedDraft(): WorkflowDraft {
  return withRealizedCredit(
    withUsageActual(
      withSupportHours(withValidationTransfer(genomixBenchmarkDraft(), TRANSFER_DATE), HOURS),
      "2027-02",
      "500",
    ),
    "1,500.00",
    "y1",
    "2027-04-30",
  );
}

describe("K7 — finalization of the fully resolved contract", () => {
  const draft = genomixResolvedDraft();

  it("reaches a complete progressive state with nothing blocked or pending", () => {
    const result = analyze(draft);
    expect(result.progressive!.state).toBe("complete");
    expect(result.progressive!.blocked).toEqual([]);
    expect(result.progressive!.billing.state).toBe("complete");
    expect(result.progressiveGate.dependencyBlockers).toEqual([]);
  });

  it("reconciles price, allocation, revenue, balances and journals", () => {
    const result = progressive(draft);
    const reconciliation = result.reconciliation!;
    expect(reconciliation.reconciled).toBe(true);
    expect(reconciliation.pendingCents).toBe(0);
    expect(reconciliation.blockedCents).toBe(0);
    expect(reconciliation.allocatedCents).toBe(reconciliation.transactionPriceCents);
    expect(reconciliation.scheduledRevenueCents).toBe(reconciliation.transactionPriceCents);
    expect(result.journals!.balanced).toBe(true);
    expect(result.balances).not.toBeNull();
  });

  it("produces a complete workpaper", () => {
    const workpaper = buildWorkpaper(draft);
    expect(workpaper.balances.finalized).toBe(true);
    expect(workpaper.journals).not.toBeNull();
    expect(workpaper.workflow.progressive).toEqual(analyze(draft).progressive);
  });

  it("builds a finalization snapshot whose totals are the authoritative totals", () => {
    const snapshot = buildFinalizationSnapshot(draft);
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    const authoritative = analyze(draft).progressive!;
    expect(snapshot.reconciliation.progressive).toEqual(authoritative.reconciliation);
    expect(snapshot.reconciliation.totals.transactionPriceCents).toBe(
      authoritative.transactionPriceCents,
    );
    expect(snapshot.engineOutputs.workflow.progressive).toEqual(authoritative);
  });

  it("preserves those totals across a snapshot round-trip", () => {
    const snapshot = buildFinalizationSnapshot(draft);
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    const stored = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot;
    expect(stored.reconciliation).toEqual(snapshot.reconciliation);
    expect(stored.engineOutputs.workflow.progressive).toEqual(
      snapshot.engineOutputs.workflow.progressive,
    );
  });
});
