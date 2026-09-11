import { describe, expect, it } from "vitest";

import {
  analyzeContractBalanceWorkflow,
  analyzeWorkflow,
  createEmptyDraft,
} from "@/lib/asc606-workflow";
import { analyzeGroupedJournalEntries, analyzeJournalEntries } from "@/lib/asc606-journals";
import { createDemoDraftIfKnown } from "@/lib/demo-scenarios";

import {
  ARC_ENGINE_VERSION,
  buildFinalizationSnapshot,
  readReconciliationSnapshot,
} from "../snapshot";
import { describeRevisionStatus, finalizeGate } from "../revision-history";
import { ARC_WORKFLOW_SCHEMA_VERSION } from "../schema";
import type { SaveStatus } from "../save-status";

const SAVED: SaveStatus = { kind: "saved" } as SaveStatus;

describe("finalization snapshot", () => {
  it("refuses to build a snapshot from an incomplete analysis", () => {
    const outcome = buildFinalizationSnapshot(createEmptyDraft());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.issues.length).toBeGreaterThan(0);
  });

  it("records engine and schema versions with the snapshot", () => {
    const draft = createDemoDraftIfKnown("horizon");
    expect(draft).not.toBeNull();
    const outcome = buildFinalizationSnapshot(draft!);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.engineOutputs.engineVersion).toBe(ARC_ENGINE_VERSION);
    expect(outcome.reconciliation.schemaVersion).toBe(ARC_WORKFLOW_SCHEMA_VERSION);
  });

  it("copies engine reconciliation verbatim and performs no arithmetic of its own", () => {
    const draft = createDemoDraftIfKnown("horizon")!;
    const engine = analyzeWorkflow(draft);
    const outcome = buildFinalizationSnapshot(draft);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.reconciliation.totals.transactionPriceCents).toBe(
      engine.analysis?.totals.transactionPriceCents ?? null,
    );
    expect(outcome.reconciliation.totals.revenueCents).toBe(
      engine.revenueSchedule?.totalCents ?? null,
    );
    expect(outcome.reconciliation.core).toEqual(engine.analysis?.reconciliation ?? null);
  });

  it("produces a JSON-serializable snapshot", () => {
    const outcome = buildFinalizationSnapshot(createDemoDraftIfKnown("horizon")!);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(() => JSON.stringify(outcome.engineOutputs)).not.toThrow();
    const round = readReconciliationSnapshot(
      JSON.parse(JSON.stringify(outcome.reconciliation)) as unknown,
    );
    expect(round?.engineVersion).toBe(ARC_ENGINE_VERSION);
  });
});

describe("complete-workpaper finalization", () => {
  it("matches the direct workflow, balance and journal engines for an ordinary contract", () => {
    const draft = createDemoDraftIfKnown("horizon")!;
    const outcome = buildFinalizationSnapshot(draft);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const balances = analyzeContractBalanceWorkflow(draft);
    expect(outcome.engineOutputs.journals.kind).toBe("ordinary");
    expect(JSON.parse(JSON.stringify(outcome.engineOutputs.workflow))).toEqual(
      JSON.parse(JSON.stringify(analyzeWorkflow(draft))),
    );
    expect(JSON.parse(JSON.stringify(outcome.engineOutputs.balances))).toEqual(
      JSON.parse(JSON.stringify(balances)),
    );
    if (outcome.engineOutputs.journals.kind !== "ordinary") return;
    expect(JSON.parse(JSON.stringify(outcome.engineOutputs.journals.analysis))).toEqual(
      JSON.parse(JSON.stringify(analyzeJournalEntries(balances.engineInput!))),
    );
  });

  it("preserves group identity and gross journals for the grouped Meridian case", () => {
    const draft = createDemoDraftIfKnown("meridian")!;
    const outcome = buildFinalizationSnapshot(draft);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.engineOutputs.journals.kind).toBe("grouped");
    if (outcome.engineOutputs.journals.kind !== "grouped") return;
    const balances = analyzeContractBalanceWorkflow(draft);
    const grouped = analyzeGroupedJournalEntries(balances.groupInputs);
    expect(outcome.engineOutputs.journals.analysis.groups.map((g) => g.groupId)).toEqual(
      grouped.groups.map((g) => g.groupId),
    );
    expect(JSON.parse(JSON.stringify(outcome.engineOutputs.journals.analysis))).toEqual(
      JSON.parse(JSON.stringify(grouped)),
    );
  });

  it("blocks a five-step-complete analysis whose billing workpaper is incomplete", () => {
    const draft = createDemoDraftIfKnown("redwood")!;
    expect(analyzeWorkflow(draft).finalized).toBe(true);
    const outcome = buildFinalizationSnapshot(draft);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.issues.length).toBeGreaterThan(0);
  });

  it("blocks when no journal output can be produced", () => {
    const draft = createDemoDraftIfKnown("redwood")!;
    const outcome = buildFinalizationSnapshot(draft);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(analyzeContractBalanceWorkflow(draft).finalized).toBe(false);
  });

  it("a successful snapshot always carries applicable journal output", () => {
    for (const id of ["horizon", "stellar", "meridian"]) {
      const outcome = buildFinalizationSnapshot(createDemoDraftIfKnown(id)!);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) continue;
      expect(outcome.engineOutputs.journals).not.toBeNull();
    }
  });
});

describe("finalize gate", () => {
  const base = {
    persistenceEnabled: true,
    status: SAVED,
    revisionStatus: "draft" as const,
    engineFinalized: true,
    workpaperComplete: true,
    lockVersion: 3,
  };

  it("allows finalization of a saved, complete draft", () => {
    expect(finalizeGate(base).canFinalize).toBe(true);
  });

  it("blocks an in-memory analysis", () => {
    expect(finalizeGate({ ...base, persistenceEnabled: false }).canFinalize).toBe(false);
  });

  it("blocks an already finalized revision", () => {
    expect(finalizeGate({ ...base, revisionStatus: "finalized" }).canFinalize).toBe(false);
    expect(finalizeGate({ ...base, revisionStatus: "superseded" }).canFinalize).toBe(false);
  });

  it("blocks while edits are unsaved or the lock version is unknown", () => {
    expect(finalizeGate({ ...base, status: { kind: "saving" } as SaveStatus }).canFinalize).toBe(
      false,
    );
    expect(finalizeGate({ ...base, lockVersion: null }).canFinalize).toBe(false);
  });

  it("blocks an incomplete analysis", () => {
    expect(finalizeGate({ ...base, engineFinalized: false }).canFinalize).toBe(false);
  });

  it("blocks an incomplete billing workpaper even when the five steps are complete", () => {
    expect(finalizeGate({ ...base, workpaperComplete: false }).canFinalize).toBe(false);
  });

  it("blocks while a finalization request is already in flight", () => {
    expect(finalizeGate({ ...base, finalizing: true }).canFinalize).toBe(false);
  });
});

describe("revision status descriptions", () => {
  it("distinguishes draft, finalized and superseded", () => {
    expect(describeRevisionStatus("draft").label).toBe("Draft");
    expect(describeRevisionStatus("finalized").label).toBe("Finalized");
    expect(describeRevisionStatus("superseded").label).toBe("Superseded");
    expect(describeRevisionStatus("superseded").detail).toContain("remains viewable");
  });
});
