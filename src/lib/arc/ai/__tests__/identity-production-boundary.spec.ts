/**
 * Phase 9G-R3 — identity hardening at the PRODUCTION boundaries.
 *
 * Three boundaries the in-memory identity tests could not reach:
 *
 *   1. deletion identity must survive the real persistence serialization used
 *      by BOTH trusted write paths (autosave and a successful AI-run apply),
 *      not just an in-memory hand-off between two runs;
 *   2. legacy identity backfill must be scoped to the canonical kinds R3
 *      actually governs, and must fail closed — never merge blind — when the
 *      immutable prior structured output cannot supply a live incumbent's
 *      identity;
 *   3. a proposal recognized by MORE THAN ONE deleted economic object is not
 *      the same thing as a proposal recognized by none.
 *
 * No model, no network, no database. All data is hand-authored and fictional.
 */
import { describe, expect, it } from "vitest";

import { createEmptyDraft, type WorkflowDraft } from "@/lib/asc606-workflow";

import { reconcileAiEdits } from "../edit-reconciliation";
import { identityBackfillRequired } from "../identity-backfill";
import {
  AiIdentityBackfillError,
  createEmptyAiAnalysisState,
  mergeAiAnalysis,
  type AiAnalysisState,
} from "../merge";
import { promiseIdentity } from "../reconciliation";
import type { AiContractAnalysis } from "../schema";
import { toPersistedAiState } from "../state-serialization";
import { decodeTombstones } from "../tombstones";
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
  priorAnalysis: AiContractAnalysis | null = null,
) {
  return mergeAiAnalysis({
    currentDraft,
    currentAiState,
    analysis,
    runId,
    guidancePack: guidancePackFixture(),
    priorContext: null,
    priorAnalysis,
  });
}

function firstRun() {
  return merge(driftRun1Analysis(), createEmptyDraft(), createEmptyAiAnalysisState(), DRIFT_RUN_1);
}

/** Exactly what the database gives back: JSON, through the shared serializer. */
function persistAndReload(state: AiAnalysisState): AiAnalysisState {
  const stored = JSON.parse(JSON.stringify(toPersistedAiState(state))) as Record<string, unknown>;
  const decoded = decodeTombstones(stored["tombstones"]);
  return {
    ...state,
    tombstones: decoded.tombstones,
    tombstoneIdentities: decoded.tombstoneIdentities,
  };
}

/** A run-2 analysis with the support promise renamed a THIRD time. */
function thirdAliasAnalysis(): AiContractAnalysis {
  const renamed = JSON.stringify(driftRun2Analysis()).split(RUN2.supportPromise).join("support_v3");
  return JSON.parse(renamed) as AiContractAnalysis;
}

/* --------------------------------------------- persistence-crossing deletion */

describe("deletion identity survives the real persistence boundary", () => {
  it("still suppresses a third alias after autosave AND AI-apply serialization", () => {
    const first = firstRun();
    const supportId = first.aiState.objectProvenance[RUN1.supportPromise]!.canonicalId;
    const edited = {
      ...first.draft,
      promises: first.draft.promises.filter((row) => row.id !== supportId),
    };

    // 1. the accountant deletes it — autosave writes the identity
    const autosaved = reconcileAiEdits({
      previousDraft: first.draft,
      nextDraft: edited,
      currentAiState: first.aiState,
    });
    const afterAutosave = persistAndReload(autosaved.aiState);
    expect(afterAutosave.tombstoneIdentities?.map((entry) => entry.semanticKey)).toContain(
      RUN1.supportPromise,
    );

    // 2. run 2 renames it — suppressed, and the AI apply persists that fact
    const second = merge(driftRun2Analysis(), edited, afterAutosave, DRIFT_RUN_2);
    expect(
      second.draft.promises.some((row) =>
        row.description.toLowerCase().includes("engineering support"),
      ),
    ).toBe(false);
    const afterApply = persistAndReload(second.aiState);
    expect(afterApply.tombstones).toContain(RUN2.supportPromise);

    // 3. run 3 renames it AGAIN, reading only what the database returned
    const third = merge(thirdAliasAnalysis(), second.draft, afterApply, "run-third");
    expect(
      third.draft.promises.some((row) =>
        row.description.toLowerCase().includes("engineering support"),
      ),
    ).toBe(false);
    expect(third.aiState.tombstones).toContain("support_v3");
    expect(third.draft.promises).toHaveLength(second.draft.promises.length);
  });

  it("never writes tombstone identities outside the persisted tombstones array", () => {
    const first = firstRun();
    const persisted = toPersistedAiState({
      ...first.aiState,
      tombstones: ["promise:legacy"],
      tombstoneIdentities: [
        {
          semanticKey: "promise:legacy",
          kind: "promise",
          signature: { gate: "promise|support", corroborators: ["doc-1#1-1"] },
          aliases: ["promise:legacy"],
        },
      ],
    });
    expect(persisted["tombstoneIdentities"]).toBeUndefined();
    expect(decodeTombstones(persisted["tombstones"]).tombstoneIdentities).toHaveLength(1);
  });
});

/* ------------------------------------------------- backfill scope and safety */

describe("legacy identity backfill is scoped and fails closed", () => {
  const legacy = (canonicalId: string) => ({
    key: {
      state: "ai_generated_untouched" as const,
      semanticKey: "key",
      lastAiRunId: DRIFT_RUN_1,
      valueFingerprint: "x",
      canonicalId,
      userModified: false,
    },
  });

  it("requires backfill for promise, obligation and variable-component provenance", () => {
    expect(identityBackfillRequired(legacy("pr-1"))).toBe(true);
    expect(identityBackfillRequired(legacy("po-1"))).toBe(true);
    expect(identityBackfillRequired(legacy("vc-1"))).toBe(true);
  });

  it("does not require backfill for object kinds identity never governs", () => {
    expect(identityBackfillRequired(legacy("bill-1"))).toBe(false);
    expect(identityBackfillRequired(legacy("cash-1"))).toBe(false);
    expect(identityBackfillRequired(legacy("mod-1"))).toBe(false);
  });

  it("does not require backfill once a signature is recorded", () => {
    expect(
      identityBackfillRequired({
        key: { ...legacy("pr-1").key, identitySignature: { gate: "g", corroborators: [] } },
      }),
    ).toBe(false);
  });

  /** A sidecar exactly as ARC wrote it BEFORE identity existed. */
  function legacySidecar(state: AiAnalysisState): AiAnalysisState {
    const objectProvenance = Object.fromEntries(
      Object.entries(state.objectProvenance).map(([key, provenance]) => {
        const { identitySignature: _dropped, previousSemanticKeys: _lineage, ...rest } = provenance;
        return [key, rest];
      }),
    );
    return { ...state, objectProvenance };
  }

  it("re-analyzes successfully when the prior structured result is available", () => {
    const first = firstRun();
    const run = merge(
      driftRun2Analysis(),
      first.draft,
      legacySidecar(first.aiState),
      DRIFT_RUN_2,
      driftRun1Analysis(),
    );
    expect(run.draft.performanceObligations).toHaveLength(3);
  });

  it("mutates nothing when the prior structured result is missing", () => {
    const first = firstRun();
    const before = JSON.stringify(first.draft);
    expect(() =>
      merge(driftRun2Analysis(), first.draft, legacySidecar(first.aiState), DRIFT_RUN_2),
    ).toThrow(AiIdentityBackfillError);
    expect(JSON.stringify(first.draft)).toBe(before);
  });

  it("mutates nothing when the prior structured result is malformed", () => {
    const first = firstRun();
    const malformed = {
      ...driftRun1Analysis(),
      promises: [],
      performanceObligations: [],
    } as unknown as AiContractAnalysis;
    expect(() =>
      merge(
        driftRun2Analysis(),
        first.draft,
        legacySidecar(first.aiState),
        DRIFT_RUN_2,
        malformed,
      ),
    ).toThrow(AiIdentityBackfillError);
    expect(first.draft.performanceObligations).toHaveLength(3);
  });

  it("creates no duplicate when the prior output cannot identify one incumbent", () => {
    const first = firstRun();
    const partial = driftRun1Analysis();
    partial.promises = partial.promises.filter((row) => row.semanticKey !== RUN1.supportPromise);
    let error: unknown = null;
    try {
      merge(driftRun2Analysis(), first.draft, legacySidecar(first.aiState), DRIFT_RUN_2, partial);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(AiIdentityBackfillError);
    expect((error as AiIdentityBackfillError).semanticKeys).toContain(RUN1.supportPromise);
    expect(first.draft.promises.filter((row) => row.id.startsWith("pr-")).length).toBe(
      first.draft.promises.length,
    );
  });
});

/* -------------------------------------------------------- ambiguous deletion */

describe("a proposal recognized by two deleted objects is fail-closed", () => {
  function twoDeletions() {
    const first = firstRun();
    const analysis = driftRun2Analysis();
    const sla = analysis.promises.find((row) => row.semanticKey === RUN2.slaPromise)!;
    const signature = promiseIdentity(sla);
    // Two different deleted promises whose recorded evidence both recognizes
    // the incoming proposal. Which one the accountant removed is unknowable.
    const state: AiAnalysisState = {
      ...first.aiState,
      tombstones: [...first.aiState.tombstones, "deleted_a", "deleted_b"],
      tombstoneIdentities: [
        {
          semanticKey: "deleted_a",
          kind: "promise",
          signature,
          aliases: ["deleted_a"],
        },
        {
          semanticKey: "deleted_b",
          kind: "promise",
          signature: {
            gate: signature.gate,
            corroborators: [signature.corroborators[0] ?? null, "a different promise entirely"],
          },
          aliases: ["deleted_b"],
        },
      ],
    };
    return { first, second: merge(analysis, first.draft, state, DRIFT_RUN_2) };
  }

  const run = twoDeletions();

  it("raises a blocking review item instead of resurrecting either deletion", () => {
    const contested = run.second.issues.filter(
      (issue) => issue.reasonCode === "unsafe_semantic_relationship",
    );
    expect(contested.length).toBeGreaterThan(0);
    expect(contested.every((issue) => issue.state === "red")).toBe(true);
  });

  it("creates no canonical row and adopts no alias", () => {
    expect(
      run.second.draft.promises.some((row) =>
        row.description.toLowerCase().includes("availability"),
      ),
    ).toBe(false);
    expect(run.second.aiState.objectProvenance[RUN2.slaPromise]).toBeUndefined();
  });

  it("changes no monetary ownership while the ambiguity stands", () => {
    expect(run.second.draft.transactionPriceInput).toBe(run.first.draft.transactionPriceInput);
  });
});
