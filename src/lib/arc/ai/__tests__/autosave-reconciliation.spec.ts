/**
 * Phase 9G — Task 4. Autosave integration behaviour.
 *
 * Proves the transaction boundary, not just the arithmetic: one autosave is one
 * logical operation, a stale or foreign caller writes nothing at all, and the
 * browser can never supply provenance, actor identity or a timestamp.
 */
import { describe, expect, it, vi } from "vitest";

import { createEmptyDraft, type WorkflowDraft } from "@/lib/asc606-workflow";

import {
  autosaveWithReconciliation,
  type AutosaveReconciliationStore,
  type AutosaveScope,
} from "../autosave-reconciliation.handlers";
import { fieldKeys, valueFingerprint } from "../identity";
import { createEmptyAiAnalysisState, type AiAnalysisState } from "../merge";
import type { AiReviewItem } from "../review-state";

const NOW = new Date("2027-03-01T12:00:00.000Z");

const revisionScope: AutosaveScope = {
  revisionId: "11111111-1111-4111-8111-111111111111",
  guestWorkspaceId: null,
  ownerUserId: "22222222-2222-4222-8222-222222222222",
  guestTokenHash: null,
  actorUserId: "22222222-2222-4222-8222-222222222222",
};

const guestScope: AutosaveScope = {
  revisionId: null,
  guestWorkspaceId: "33333333-3333-4333-8333-333333333333",
  ownerUserId: null,
  guestTokenHash: "9".repeat(64),
  actorUserId: null,
};

function savedDraft(): WorkflowDraft {
  return { ...createEmptyDraft(), transactionPriceInput: "120000" };
}

function reviewItem(overrides: Partial<AiReviewItem> = {}): AiReviewItem {
  return {
    id: "rev-1",
    targetKey: fieldKeys.transactionPrice("input"),
    section: "step_3",
    state: "yellow",
    severity: "yellow",
    reasonCode: "accountant_affirmation_required",
    reason: "Affirm the transaction price.",
    guidanceIds: [],
    citations: [],
    valueFingerprint: "v1",
    reviewFingerprint: "rf-1",
    resolution: null,
    affirmedAt: null,
    affirmedMethod: null,
    ...overrides,
  };
}

function sidecar(draft: WorkflowDraft, items: AiReviewItem[] = []): AiAnalysisState {
  return {
    ...createEmptyAiAnalysisState(),
    lastSuccessfulRunId: "run-1",
    sourceSetFingerprint: "f".repeat(64),
    sourceState: "current",
    fieldProvenance: {
      [fieldKeys.transactionPrice("input")]: {
        state: "ai_generated_untouched",
        semanticKey: "price:total",
        lastAiRunId: "run-1",
        valueFingerprint: valueFingerprint(draft.transactionPriceInput),
      },
    },
    reviewItems: items,
  };
}

interface Harness {
  store: AutosaveReconciliationStore;
  calls: {
    draftOnly: unknown[];
    reconciled: unknown[];
  };
}

function harness(options: {
  aiState?: AiAnalysisState | null;
  saved?: WorkflowDraft | null;
  conflict?: boolean;
  transactionFails?: boolean;
}): Harness {
  const calls = { draftOnly: [] as unknown[], reconciled: [] as unknown[] };
  const store: AutosaveReconciliationStore = {
    loadSavedDraft: async () => options.saved ?? savedDraft(),
    loadAiState: async () => options.aiState ?? null,
    saveDraftOnly: async (args) => {
      calls.draftOnly.push(args);
      if (options.conflict) return null;
      return { lockVersion: args.expectedLockVersion + 1, savedAt: NOW.toISOString() };
    },
    saveWithReconciliation: async (args) => {
      calls.reconciled.push(args);
      if (options.transactionFails) throw new Error("Your latest edits could not be saved.");
      if (options.conflict) return null;
      return { lockVersion: args.expectedLockVersion + 1, savedAt: NOW.toISOString() };
    },
  };
  return { store, calls };
}

function deps(store: AutosaveReconciliationStore) {
  return { store, now: () => NOW };
}

function edited(): WorkflowDraft {
  return { ...savedDraft(), transactionPriceInput: "150000" };
}

describe("autosave for a manual-only analysis", () => {
  it("is unchanged when there is no AI sidecar", async () => {
    const { store, calls } = harness({ aiState: null });
    const result = await autosaveWithReconciliation(deps(store), {
      scope: revisionScope,
      expectedLockVersion: 4,
      nextDraft: edited(),
      canonical: { schemaVersion: "x" },
      schemaVersion: "x",
    });
    expect(result).toEqual({
      ok: true,
      lockVersion: 5,
      savedAt: NOW.toISOString(),
      reconciled: false,
    });
    expect(calls.reconciled).toHaveLength(0);
    expect(calls.draftOnly).toHaveLength(1);
  });

  it("takes the ordinary path when nothing in the sidecar moved", async () => {
    const draft = savedDraft();
    const { store, calls } = harness({ aiState: sidecar(draft), saved: draft });
    await autosaveWithReconciliation(deps(store), {
      scope: revisionScope,
      expectedLockVersion: 4,
      nextDraft: { ...draft, transactionPriceNotes: "memo" },
      canonical: {},
      schemaVersion: "x",
    });
    expect(calls.reconciled).toHaveLength(0);
    expect(calls.draftOnly).toHaveLength(1);
  });
});

describe("autosave with reconciliation", () => {
  it("commits the draft, the provenance and the audit events in one call", async () => {
    const draft = savedDraft();
    const { store, calls } = harness({ aiState: sidecar(draft, [reviewItem()]), saved: draft });
    const result = await autosaveWithReconciliation(deps(store), {
      scope: revisionScope,
      expectedLockVersion: 4,
      nextDraft: edited(),
      canonical: { canonical: true },
      schemaVersion: "x",
    });

    expect(result).toEqual({
      ok: true,
      lockVersion: 5,
      savedAt: NOW.toISOString(),
      reconciled: true,
    });
    expect(calls.draftOnly).toHaveLength(0);
    expect(calls.reconciled).toHaveLength(1);

    const args = calls.reconciled[0] as {
      scope: AutosaveScope;
      expectedLockVersion: number;
      canonical: unknown;
      aiState: AiAnalysisState;
      reviewEvents: Array<{ type: string; reviewItemId: string }>;
    };
    expect(args.expectedLockVersion).toBe(4);
    expect(args.canonical).toEqual({ canonical: true });
    expect(args.aiState.fieldProvenance[fieldKeys.transactionPrice("input")]!.state).toBe(
      "ai_generated_user_edited",
    );
    expect(args.reviewEvents).toEqual([
      {
        type: "yellow_affirmed",
        reviewItemId: "rev-1",
        targetKey: fieldKeys.transactionPrice("input"),
        section: "step_3",
        severity: "yellow",
        reviewFingerprint: "rf-1",
      },
    ]);
    // The server authored the resolution timestamp, not the browser.
    expect(args.aiState.reviewItems[0]!.resolution).toEqual({
      kind: "affirmed",
      at: NOW.toISOString(),
      method: "edited",
      reviewFingerprint: "rf-1",
    });
  });

  it("advances the lock exactly once however many review items moved", async () => {
    const draft = savedDraft();
    const items = [
      reviewItem(),
      reviewItem({
        id: "rev-2",
        state: "resolved",
        reviewFingerprint: "rf-2",
        resolution: {
          kind: "affirmed",
          at: "2027-02-01T00:00:00Z",
          method: "individual",
          reviewFingerprint: "rf-2",
        },
      }),
    ];
    const { store, calls } = harness({ aiState: sidecar(draft, items), saved: draft });
    const result = await autosaveWithReconciliation(deps(store), {
      scope: revisionScope,
      expectedLockVersion: 7,
      nextDraft: edited(),
      canonical: {},
      schemaVersion: "x",
    });
    expect(result).toEqual({
      ok: true,
      lockVersion: 8,
      savedAt: NOW.toISOString(),
      reconciled: true,
    });
    expect(calls.reconciled).toHaveLength(1);
  });

  it("never changes source freshness or the last successful run", async () => {
    const draft = savedDraft();
    const { store, calls } = harness({ aiState: sidecar(draft, [reviewItem()]), saved: draft });
    await autosaveWithReconciliation(deps(store), {
      scope: revisionScope,
      expectedLockVersion: 1,
      nextDraft: edited(),
      canonical: {},
      schemaVersion: "x",
    });
    const args = calls.reconciled[0] as { aiState: AiAnalysisState };
    expect(args.aiState.sourceState).toBe("current");
    expect(args.aiState.sourceSetFingerprint).toBe("f".repeat(64));
    expect(args.aiState.lastSuccessfulRunId).toBe("run-1");
  });

  it("writes nothing when the optimistic lock has moved on", async () => {
    const draft = savedDraft();
    const { store } = harness({
      aiState: sidecar(draft, [reviewItem()]),
      saved: draft,
      conflict: true,
    });
    const result = await autosaveWithReconciliation(deps(store), {
      scope: revisionScope,
      expectedLockVersion: 2,
      nextDraft: edited(),
      canonical: {},
      schemaVersion: "x",
    });
    expect(result).toEqual({ ok: false, reason: "conflict" });
  });

  it("propagates a failed transaction rather than half-saving", async () => {
    const draft = savedDraft();
    const { store } = harness({
      aiState: sidecar(draft, [reviewItem()]),
      saved: draft,
      transactionFails: true,
    });
    await expect(
      autosaveWithReconciliation(deps(store), {
        scope: revisionScope,
        expectedLockVersion: 2,
        nextDraft: edited(),
        canonical: {},
        schemaVersion: "x",
      }),
    ).rejects.toThrow("Your latest edits could not be saved.");
  });

  it("reconciles a guest workspace against its credential-bound scope", async () => {
    const draft = savedDraft();
    const { store, calls } = harness({ aiState: sidecar(draft, [reviewItem()]), saved: draft });
    await autosaveWithReconciliation(deps(store), {
      scope: guestScope,
      expectedLockVersion: 3,
      nextDraft: edited(),
      canonical: {},
      schemaVersion: "x",
    });
    const args = calls.reconciled[0] as { scope: AutosaveScope };
    expect(args.scope.guestWorkspaceId).toBe(guestScope.guestWorkspaceId);
    expect(args.scope.guestTokenHash).toBe(guestScope.guestTokenHash);
    expect(args.scope.actorUserId).toBeNull();
  });
});

describe("autosave never runs AI", () => {
  it("makes no run, reserves no allowance and calls no provider", async () => {
    const draft = savedDraft();
    const { store } = harness({ aiState: sidecar(draft, [reviewItem()]), saved: draft });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const surface = store as unknown as Record<string, unknown>;
    expect(Object.keys(surface).sort()).toEqual([
      "loadAiState",
      "loadSavedDraft",
      "saveDraftOnly",
      "saveWithReconciliation",
    ]);
    await autosaveWithReconciliation(deps(store), {
      scope: revisionScope,
      expectedLockVersion: 1,
      nextDraft: edited(),
      canonical: {},
      schemaVersion: "x",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
