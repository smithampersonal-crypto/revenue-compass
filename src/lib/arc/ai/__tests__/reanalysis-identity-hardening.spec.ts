/**
 * Phase 9G-R3 — re-analysis identity ACCEPTANCE HARDENING.
 *
 * Four acceptance blockers, each stated as behaviour rather than mechanism:
 *
 *   1. a sidecar written before identity signatures existed must reconcile
 *      correctly on the FIRST run after deployment, backfilled from the
 *      immutable structured output of the run that created those objects;
 *   2. a broad compatibility fact (promise type, satisfaction pattern,
 *      variable-consideration type/effect/target) must never be sufficient
 *      identity by itself;
 *   3. an ambiguous pairing must be genuinely fail-closed — no alias adoption,
 *      no canonical row creation, no relationship re-pointing, no change of
 *      monetary ownership, and a blocking review item;
 *   4. a deletion must survive semantic-key drift without blocking genuinely
 *      new objects of the same category.
 *
 * Everything runs through the real merge and the real autosave reconciliation.
 * No model, no network, no database. All data is hand-authored and fictional.
 */
import { describe, expect, it } from "vitest";

import { createEmptyDraft, type WorkflowDraft } from "@/lib/asc606-workflow";

import { reconcileAiEdits } from "../edit-reconciliation";
import { priorIdentityIndex } from "../identity-backfill";
import { createEmptyAiAnalysisState, mergeAiAnalysis, type AiAnalysisState } from "../merge";
import {
  promiseIdentity,
  reconcileByIdentity,
  signaturesIdentify,
  vcIdentity,
} from "../reconciliation";
import type { AiContractAnalysis } from "../schema";
import { decodeTombstones, encodeTombstones } from "../tombstones";
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

/** A sidecar exactly as ARC wrote it BEFORE this patch: no identity at all. */
function legacySidecar(state: AiAnalysisState): AiAnalysisState {
  const objectProvenance = Object.fromEntries(
    Object.entries(state.objectProvenance).map(([key, provenance]) => {
      const { identitySignature: _dropped, previousSemanticKeys: _lineage, ...rest } = provenance;
      return [key, rest];
    }),
  );
  const { tombstoneIdentities: _identities, ...rest } = state;
  return { ...rest, objectProvenance };
}

const canonicalIds = (state: AiAnalysisState, keys: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(keys).map(([name, key]) => [
      name,
      state.objectProvenance[key]?.canonicalId ?? `MISSING:${key}`,
    ]),
  );

/* ------------------------------------------------------------ blocker 1 */

describe("legacy sidecars reconcile on the first run after deployment", () => {
  it("re-identifies renamed objects with no identity recorded on disk", () => {
    const first = firstRun();
    const legacy = legacySidecar(first.aiState);
    expect(
      Object.values(legacy.objectProvenance).every(
        (provenance) => provenance.identitySignature === undefined,
      ),
    ).toBe(true);

    // Without the prior structured output there is nothing trustworthy to
    // reconcile against, and ARC refuses to guess from canonical fields.
    const blind = merge(driftRun2Analysis(), first.draft, legacy, DRIFT_RUN_2);
    expect(blind.draft.performanceObligations.length).toBeGreaterThan(3);

    // With it, the first post-deployment run behaves exactly as a patched one.
    const backfilled = merge(
      driftRun2Analysis(),
      first.draft,
      legacy,
      DRIFT_RUN_2,
      driftRun1Analysis(),
    );
    expect(backfilled.draft.performanceObligations).toHaveLength(3);
    expect(backfilled.draft.variableConsiderationComponents).toHaveLength(2);
    expect(canonicalIds(backfilled.aiState, RUN2)).toEqual(canonicalIds(first.aiState, RUN1));
  });

  it("backfills only what the prior run actually stated", () => {
    const first = firstRun();
    const index = priorIdentityIndex(driftRun1Analysis(), (key) => key);
    expect(index.get(RUN1.supportPromise)?.kind).toBe("promise");
    expect(index.get("promise:never-proposed")).toBeUndefined();

    const legacy = legacySidecar(first.aiState);
    legacy.objectProvenance["promise:unknown-legacy"] = {
      state: "ai_generated_untouched",
      semanticKey: "promise:unknown-legacy",
      lastAiRunId: DRIFT_RUN_1,
      valueFingerprint: "x",
      canonicalId: "pr-unknown-legacy",
      userModified: false,
    };
    const run = merge(driftRun2Analysis(), first.draft, legacy, DRIFT_RUN_2, driftRun1Analysis());
    expect(
      run.aiState.objectProvenance["promise:unknown-legacy"]?.identitySignature,
    ).toBeUndefined();
  });
});

/* ------------------------------------------------------------ blocker 2 */

describe("a broad compatibility fact is never sufficient identity", () => {
  it("does not match two support promises that share only their type", () => {
    const incumbent = promiseIdentity({
      promiseType: "service",
      citations: [
        { documentId: "doc-1", pageStart: 4, pageEnd: 4, evidenceMode: "text", excerpt: "a" },
      ],
      description: "Engineering support",
    });
    const proposal = promiseIdentity({
      promiseType: "service",
      citations: [
        { documentId: "doc-1", pageStart: 11, pageEnd: 11, evidenceMode: "text", excerpt: "b" },
      ],
      description: "Regulatory liaison support",
    });
    expect(signaturesIdentify(incumbent, proposal)).toBe(false);

    const outcome = reconcileByIdentity(
      [{ semanticKey: "new", signature: proposal }],
      [{ semanticKey: "old", canonicalId: "pr-1", signature: incumbent }],
    );
    expect(outcome.get("new")).toEqual({ status: "none" });
  });

  it("does not match two variable components that share only type, effect and target", () => {
    const base = {
      type: "usage_based" as const,
      effect: "increase",
      targetCanonicalId: "po-hosted",
      unitDescription: "per specimen",
    };
    const incumbent = vcIdentity({
      ...base,
      citations: [
        { documentId: "doc-1", pageStart: 7, pageEnd: 7, evidenceMode: "text", excerpt: "a" },
      ],
      rateInput: "1.35",
    });
    const proposal = vcIdentity({
      ...base,
      citations: [
        { documentId: "doc-1", pageStart: 12, pageEnd: 12, evidenceMode: "text", excerpt: "b" },
      ],
      rateInput: "4.10",
    });
    expect(signaturesIdentify(incumbent, proposal)).toBe(false);
  });

  it("still matches the same object when the evidence agrees", () => {
    const citations = [
      { documentId: "doc-1", pageStart: 4, pageEnd: 4, evidenceMode: "text" as const, excerpt: "" },
    ];
    expect(
      signaturesIdentify(
        promiseIdentity({ promiseType: "service", citations, description: "Support" }),
        promiseIdentity({
          promiseType: "service",
          citations,
          description: "Bioinformatics support",
        }),
      ),
    ).toBe(true);
  });

  it("refuses a weaker fact when the stronger one disagrees", () => {
    const shared = "Engineering support";
    expect(
      signaturesIdentify(
        promiseIdentity({
          promiseType: "service",
          citations: [
            { documentId: "doc-1", pageStart: 4, pageEnd: 4, evidenceMode: "text", excerpt: "" },
          ],
          description: shared,
        }),
        promiseIdentity({
          promiseType: "service",
          citations: [
            { documentId: "doc-1", pageStart: 9, pageEnd: 9, evidenceMode: "text", excerpt: "" },
          ],
          description: shared,
        }),
      ),
    ).toBe(false);
  });
});

/* ------------------------------------------------------------ blocker 3 */

describe("an ambiguous pairing is fail-closed", () => {
  /** Two run-2 promises that are indistinguishable from one run-1 incumbent. */
  function ambiguousRun() {
    const first = firstRun();
    const analysis = driftRun2Analysis();
    analysis.promises = analysis.promises.map((row) =>
      row.semanticKey === RUN2.slaPromise
        ? {
            ...row,
            promiseType: "service" as const,
            description: "Dedicated engineering support, 40 hours annually",
            citations: [
              {
                documentId: "doc-r1-fixture-1",
                pageStart: 4,
                pageEnd: 4,
                evidenceMode: "text" as const,
                excerpt: "support",
              },
            ],
          }
        : row,
    );
    return { first, second: merge(analysis, first.draft, first.aiState, DRIFT_RUN_2) };
  }

  const run = ambiguousRun();
  const contested = run.second.issues.filter(
    (issue) => issue.reasonCode === "unsafe_semantic_relationship",
  );

  it("raises a blocking review item instead of choosing", () => {
    expect(contested.length).toBeGreaterThan(0);
    expect(contested.every((issue) => issue.blocking)).toBe(true);
  });

  it("creates no canonical row for the contested proposal", () => {
    expect(run.second.draft.promises).toHaveLength(run.first.draft.promises.length + 1);
  });

  it("adopts no alias and leaves the incumbent owned by its original key", () => {
    const incumbent = run.second.aiState.objectProvenance[RUN1.supportPromise];
    expect(incumbent?.canonicalId).toBe(
      run.first.aiState.objectProvenance[RUN1.supportPromise]!.canonicalId,
    );
    for (const issue of contested) {
      const key = issue.value as string;
      expect(run.second.aiState.objectProvenance[key]).toBeUndefined();
    }
  });

  it("changes no monetary ownership while the ambiguity stands", () => {
    expect(run.second.draft.transactionPriceInput).toBe(run.first.draft.transactionPriceInput);
    expect(run.second.draft.variableConsiderationComponents.length).toBe(
      run.first.draft.variableConsiderationComponents.length,
    );
  });
});

/* ------------------------------------------------------------ blocker 4 */

describe("a deletion survives semantic-key drift", () => {
  /** The accountant deletes the support promise, then the model renames it. */
  function deletedSupport() {
    const first = firstRun();
    const supportId = first.aiState.objectProvenance[RUN1.supportPromise]!.canonicalId;
    const edited = {
      ...first.draft,
      promises: first.draft.promises.filter((row) => row.id !== supportId),
    };
    const reconciled = reconcileAiEdits({
      previousDraft: first.draft,
      nextDraft: edited,
      currentAiState: first.aiState,
    });
    return { first, edited, reconciled, supportId };
  }

  const deleted = deletedSupport();

  it("records the deleted object's identity at autosave", () => {
    const identities = deleted.reconciled.aiState.tombstoneIdentities ?? [];
    expect(identities.map((entry) => entry.semanticKey)).toContain(RUN1.supportPromise);
    expect(identities[0]!.kind).toBe("promise");
  });

  it("does not resurrect it when the next run renames it", () => {
    const second = merge(
      driftRun2Analysis(),
      deleted.edited,
      deleted.reconciled.aiState,
      DRIFT_RUN_2,
    );
    const support = second.draft.promises.find((row) =>
      row.description.toLowerCase().includes("engineering support"),
    );
    expect(support).toBeUndefined();
    expect(second.issues.some((issue) => issue.reasonCode === "ai_proposal_tombstoned")).toBe(true);
  });

  it("suppresses the new alias too, so a third run stays clean", () => {
    const second = merge(
      driftRun2Analysis(),
      deleted.edited,
      deleted.reconciled.aiState,
      DRIFT_RUN_2,
    );
    expect(second.aiState.tombstones).toContain(RUN2.supportPromise);
    const third = merge(driftRun2Analysis(), second.draft, second.aiState, "run-third");
    expect(third.draft.promises).toHaveLength(second.draft.promises.length);
  });

  it("still allows a genuinely new promise of the same category", () => {
    const second = merge(
      driftRun2Analysis(),
      deleted.edited,
      deleted.reconciled.aiState,
      DRIFT_RUN_2,
    );
    const sla = second.draft.promises.find((row) =>
      row.description.toLowerCase().includes("availability"),
    );
    expect(sla).toBeDefined();
  });

  it("round-trips deletion identity through the persisted tombstone array", () => {
    const state = deleted.reconciled.aiState;
    const encoded = encodeTombstones(state.tombstones, state.tombstoneIdentities ?? []);
    const decoded = decodeTombstones(JSON.parse(JSON.stringify(encoded)));
    expect(decoded.tombstones).toEqual(state.tombstones);
    expect(decoded.tombstoneIdentities).toEqual(state.tombstoneIdentities);
  });

  it("reads a pre-patch tombstone array unchanged", () => {
    expect(decodeTombstones(["promise:legacy-a", "promise:legacy-b"])).toEqual({
      tombstones: ["promise:legacy-a", "promise:legacy-b"],
      tombstoneIdentities: [],
    });
  });

  it("ignores an unreadable persisted entry rather than trusting it", () => {
    expect(decodeTombstones([{ arcTombstoneIdentity: 1, kind: "nonsense" }, 42, null])).toEqual({
      tombstones: [],
      tombstoneIdentities: [],
    });
  });
});
