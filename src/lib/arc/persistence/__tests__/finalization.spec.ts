import { describe, expect, it } from "vitest";

import { createEmptyDraft, analyzeWorkflow } from "@/lib/asc606-workflow";
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
    const draft = createDemoDraftIfKnown("redwood");
    expect(draft).not.toBeNull();
    const outcome = buildFinalizationSnapshot(draft!);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.engineOutputs.engineVersion).toBe(ARC_ENGINE_VERSION);
    expect(outcome.reconciliation.schemaVersion).toBe(ARC_WORKFLOW_SCHEMA_VERSION);
  });

  it("copies engine reconciliation verbatim and performs no arithmetic of its own", () => {
    const draft = createDemoDraftIfKnown("redwood")!;
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
    const outcome = buildFinalizationSnapshot(createDemoDraftIfKnown("redwood")!);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(() => JSON.stringify(outcome.engineOutputs)).not.toThrow();
    const round = readReconciliationSnapshot(
      JSON.parse(JSON.stringify(outcome.reconciliation)) as unknown,
    );
    expect(round?.engineVersion).toBe(ARC_ENGINE_VERSION);
  });
});

describe("finalize gate", () => {
  const base = {
    persistenceEnabled: true,
    status: SAVED,
    revisionStatus: "draft" as const,
    engineFinalized: true,
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
});

describe("revision status descriptions", () => {
  it("distinguishes draft, finalized and superseded", () => {
    expect(describeRevisionStatus("draft").label).toBe("Draft");
    expect(describeRevisionStatus("finalized").label).toBe("Finalized");
    expect(describeRevisionStatus("superseded").label).toBe("Superseded");
    expect(describeRevisionStatus("superseded").detail).toContain("remains viewable");
  });
});
