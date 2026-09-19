/**
 * Post-R2 live regression patch — defect 4, application boundary.
 *
 * Lock contention on the trusted reconciliation transaction is NOT a stale
 * lock: it never becomes the permanent conflict/write-block state. It is
 * retried exactly once after a short bounded pause, and a second contention is
 * surfaced as a retryable save state with the edits still intact.
 */
import { describe, expect, it, vi } from "vitest";

import { createEmptyDraft, type WorkflowDraft } from "@/lib/asc606-workflow";

import {
  autosaveWithReconciliation,
  type AutosaveReconciliationStore,
  type AutosaveScope,
  type ReconciledSaveAttempt,
} from "../autosave-reconciliation.handlers";
import { fieldKeys, valueFingerprint } from "../identity";
import { createEmptyAiAnalysisState } from "../merge";

const SCOPE: AutosaveScope = {
  revisionId: null,
  guestWorkspaceId: "guest-1",
  ownerUserId: null,
  guestTokenHash: "hash",
  actorUserId: null,
};

function savedDraft(): WorkflowDraft {
  const empty = createEmptyDraft();
  return { ...empty, transactionPriceInput: "120000" };
}

function editedDraft(): WorkflowDraft {
  return { ...savedDraft(), transactionPriceInput: "150000" };
}

function sidecar() {
  return {
    ...createEmptyAiAnalysisState(),
    lastSuccessfulRunId: "run-1",
    fieldProvenance: {
      [fieldKeys.transactionPrice("input")]: {
        state: "ai_generated_untouched" as const,
        semanticKey: "price:total",
        lastAiRunId: "run-1",
        valueFingerprint: valueFingerprint("120000"),
      },
    },
  };
}

function harness(attempts: readonly ReconciledSaveAttempt[]) {
  const reconciled = vi.fn<AutosaveReconciliationStore["saveWithReconciliation"]>();
  let index = 0;
  reconciled.mockImplementation(async () => attempts[Math.min(index++, attempts.length - 1)]!);
  const saveDraftOnly = vi.fn(async () => ({ lockVersion: 4, savedAt: "2027-03-01T00:00:00Z" }));
  const delay = vi.fn(async () => {});
  const store: AutosaveReconciliationStore = {
    loadSavedDraft: async () => savedDraft(),
    loadAiState: async () => ({ status: "loaded", state: sidecar() }),
    saveDraftOnly,
    saveWithReconciliation: reconciled,
  };
  const run = () =>
    autosaveWithReconciliation(
      { store, now: () => new Date("2027-03-01T00:00:00Z"), delay },
      {
        scope: SCOPE,
        expectedLockVersion: 3,
        nextDraft: editedDraft(),
        canonical: {},
        schemaVersion: "arc.workflow.v1",
      },
    );
  return { run, reconciled, delay, saveDraftOnly };
}

describe("post-R2 — guest autosave reconciliation under lock contention", () => {
  it("retries exactly once and succeeds with the same expected lock version", async () => {
    const { run, reconciled, delay } = harness([
      "contention",
      { lockVersion: 4, savedAt: "2027-03-01T00:00:00Z" },
    ]);
    const outcome = await run();
    expect(outcome).toEqual({
      ok: true,
      lockVersion: 4,
      savedAt: "2027-03-01T00:00:00Z",
      reconciled: true,
    });
    expect(reconciled).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledTimes(1);
    expect(reconciled.mock.calls[1]![0]!.expectedLockVersion).toBe(3);
  });

  it("stops after one retry and reports a retryable contention, never a conflict", async () => {
    const { run, reconciled } = harness(["contention", "contention"]);
    const outcome = await run();
    expect(outcome).toEqual({ ok: false, reason: "contention" });
    expect(reconciled).toHaveBeenCalledTimes(2);
  });

  it("still treats a proven stale lock as a conflict without retrying", async () => {
    const { run, reconciled, delay } = harness([null]);
    const outcome = await run();
    expect(outcome).toEqual({ ok: false, reason: "conflict" });
    expect(reconciled).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it("leaves ordinary manual-only guest autosave untouched", async () => {
    const saveDraftOnly = vi.fn(async () => ({ lockVersion: 4, savedAt: "2027-03-01T00:00:00Z" }));
    const reconciled = vi.fn(async () => null as ReconciledSaveAttempt);
    const outcome = await autosaveWithReconciliation(
      {
        store: {
          loadSavedDraft: async () => savedDraft(),
          loadAiState: async () => ({ status: "absent" }),
          saveDraftOnly,
          saveWithReconciliation: reconciled,
        },
        now: () => new Date("2027-03-01T00:00:00Z"),
      },
      {
        scope: SCOPE,
        expectedLockVersion: 3,
        nextDraft: editedDraft(),
        canonical: {},
        schemaVersion: "arc.workflow.v1",
      },
    );
    expect(outcome).toEqual({
      ok: true,
      lockVersion: 4,
      savedAt: "2027-03-01T00:00:00Z",
      reconciled: false,
    });
    expect(reconciled).not.toHaveBeenCalled();
  });
});
