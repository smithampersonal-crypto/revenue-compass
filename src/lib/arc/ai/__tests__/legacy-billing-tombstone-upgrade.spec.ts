/**
 * Phase 9G-R3 / Phase L — legacy billing tombstone upgrade.
 *
 * A billing deletion recorded BEFORE billing deletion identity existed lives
 * in the sidecar only as a plain alias string, with its canonical row and its
 * provenance already gone. It must acquire the durable schedule+period
 * identity deterministically, from the immutable prior structured result —
 * never guessed from the canonical draft — and it must fail closed when that
 * prior result is unavailable or malformed.
 *
 * No model, no network, no database. All data is fictional.
 */
import { describe, expect, it } from "vitest";

import { createEmptyDraft, type WorkflowDraft } from "@/lib/asc606-workflow";

import {
  legacyBillingTombstones,
  parseBillingTombstoneAlias,
  priorAnalysisRequired,
} from "../identity-backfill";
import {
  AiIdentityBackfillError,
  createEmptyAiAnalysisState,
  mergeAiAnalysis,
  type AiAnalysisState,
} from "../merge";

import type { AiContractAnalysis } from "../schema";
import { toPersistedAiState } from "../state-serialization";
import { decodeTombstones } from "../tombstones";
import { DRIFT_RUN_1, DRIFT_RUN_2, driftRun1Analysis, driftRun2Analysis } from "./drift-fixtures";
import { guidancePackFixture } from "./merge-fixtures";

const DRIFT_RUN_3 = "run-00000000-0000-4000-8000-0000000000a3";
const RUN1_KEY = "fixed_annual_advance_billing";
const RUN2_KEY = "billing_fixed_annual_advance";
const RUN3_KEY = "annual_advance_invoice_schedule";

type BillingTerm = AiContractAnalysis["billingTerms"][number];

function annualAdvanceTerm(semanticKey: string): BillingTerm {
  return {
    semanticKey,
    description: "Annual advance subscription invoice.",
    billingTiming: "advance",
    frequency: "annual",
    invoiceTrigger: "Start of each annual period.",
    amountOrRateInput: "245000",
    paymentTermsDays: 30,
    dueDateRule: "Net 30 from invoice date.",
    citations: [
      {
        documentId: "doc-r1-fixture-1",
        pageStart: 1,
        pageEnd: 1,
        evidenceMode: "text" as const,
        excerpt: "Net 30",
      },
    ],
    reviewState: "supported",
  };
}

function withBilling(analysis: AiContractAnalysis, terms: readonly BillingTerm[]) {
  analysis.billingTerms = [...terms];
  return analysis;
}

const run1Analysis = () => withBilling(driftRun1Analysis(), [annualAdvanceTerm(RUN1_KEY)]);

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

function saveAndReload(state: AiAnalysisState): AiAnalysisState {
  const persisted = toPersistedAiState(state);
  const decoded = decodeTombstones(persisted["tombstones"]);
  return {
    ...(persisted as unknown as AiAnalysisState),
    tombstones: decoded.tombstones,
    tombstoneIdentities: decoded.tombstoneIdentities,
  };
}

const LEGACY_EVENT = `${RUN1_KEY}#1`;
const LEGACY_COLLECTION = `${RUN1_KEY}#1#collection`;

/**
 * A pre-patch sidecar: period 1 was deleted, its rows and provenance are gone,
 * and only the plain alias strings remain.
 */
function prePatchDeletion() {
  const first = merge(
    run1Analysis(),
    createEmptyDraft(),
    createEmptyAiAnalysisState(),
    DRIFT_RUN_1,
  );
  const events = first.draft.contractBalances.considerationEvents;
  const survivor = [...events].sort((a, b) => a.id.localeCompare(b.id))[1]!;
  const draft: WorkflowDraft = {
    ...first.draft,
    contractBalances: {
      ...first.draft.contractBalances,
      considerationEvents: [survivor],
      cashCollections: first.draft.contractBalances.cashCollections.filter(
        (row) => row.considerationEventId === survivor.id,
      ),
    },
  };
  const objectProvenance = Object.fromEntries(
    Object.entries(first.aiState.objectProvenance).filter(
      ([key]) => key !== LEGACY_EVENT && key !== LEGACY_COLLECTION,
    ),
  );
  const state = saveAndReload({
    ...first.aiState,
    objectProvenance,
    tombstones: [LEGACY_EVENT, LEGACY_COLLECTION],
    tombstoneIdentities: [],
  });
  return { draft, state, survivorId: survivor.id };
}

describe("legacy billing tombstone upgrade predicate", () => {
  it("distinguishes legacy billing aliases from ordinary tombstones", () => {
    expect(parseBillingTombstoneAlias(LEGACY_EVENT)?.kind).toBe("billing_event");
    expect(parseBillingTombstoneAlias(LEGACY_COLLECTION)?.kind).toBe("billing_collection");
    expect(parseBillingTombstoneAlias("hosted_platform_promise")).toBeNull();
  });

  it("ignores billing tombstones that already carry an identity record", () => {
    const identities = [
      {
        semanticKey: LEGACY_EVENT,
        kind: "billing_event" as const,
        signature: { gate: "g", corroborators: [] },
        aliases: [LEGACY_EVENT],
      },
    ];
    expect(
      legacyBillingTombstones([LEGACY_EVENT, LEGACY_COLLECTION], identities).map(
        (entry) => entry.alias,
      ),
    ).toEqual([LEGACY_COLLECTION]);
  });

  it("requires the prior structured result when only a legacy billing alias remains", () => {
    expect(
      priorAnalysisRequired({
        objectProvenance: {},
        tombstones: [LEGACY_EVENT],
        tombstoneIdentities: [],
      }),
    ).toBe(true);
    expect(
      priorAnalysisRequired({
        objectProvenance: {},
        tombstones: ["some_other_deleted_thing"],
        tombstoneIdentities: [],
      }),
    ).toBe(false);
  });
});

describe("legacy billing deletions survive schedule renames", () => {
  it("upgrades the alias and keeps the deleted period absent through two renames", () => {
    const legacy = prePatchDeletion();

    const second = merge(
      withBilling(driftRun2Analysis(), [annualAdvanceTerm(RUN2_KEY)]),
      legacy.draft,
      legacy.state,
      DRIFT_RUN_2,
      run1Analysis(),
    );
    expect(second.draft.contractBalances.considerationEvents.map((row) => row.id)).toEqual([
      legacy.survivorId,
    ]);
    expect(second.draft.contractBalances.cashCollections).toHaveLength(1);

    const saved = saveAndReload(second.aiState);
    const records = saved.tombstoneIdentities ?? [];
    expect(
      records.some((r) => r.kind === "billing_event" && r.aliases.includes(LEGACY_EVENT)),
    ).toBe(true);
    expect(
      records.some((r) => r.kind === "billing_collection" && r.aliases.includes(LEGACY_COLLECTION)),
    ).toBe(true);

    const third = merge(
      withBilling(driftRun2Analysis(), [annualAdvanceTerm(RUN3_KEY)]),
      second.draft,
      saved,
      DRIFT_RUN_3,
      run1Analysis(),
    );
    expect(third.draft.contractBalances.considerationEvents.map((row) => row.id)).toEqual([
      legacy.survivorId,
    ]);
    expect(third.draft.contractBalances.cashCollections).toHaveLength(1);
  });

  it("fails closed and creates nothing when the prior structured result is unavailable", () => {
    const legacy = prePatchDeletion();
    expect(() =>
      merge(
        withBilling(driftRun2Analysis(), [annualAdvanceTerm(RUN2_KEY)]),
        legacy.draft,
        legacy.state,
        DRIFT_RUN_2,
        null,
      ),
    ).toThrow();
    expect(legacy.draft.contractBalances.considerationEvents).toHaveLength(1);
  });

  it("fails closed when a valid prior result is SILENT about the legacy billing term", () => {
    const legacy = prePatchDeletion();
    const draftBefore = structuredClone(legacy.draft);
    const stateBefore = structuredClone(legacy.state);

    // A perfectly valid, schema-parsed prior analysis that simply does not
    // contain the billing term the legacy deletion refers to.
    const silentPrior = withBilling(driftRun1Analysis(), [
      annualAdvanceTerm("some_unrelated_billing_schedule"),
    ]);

    expect(() =>
      merge(
        withBilling(driftRun2Analysis(), [annualAdvanceTerm(RUN2_KEY)]),
        legacy.draft,
        legacy.state,
        DRIFT_RUN_2,
        silentPrior,
      ),
    ).toThrow(AiIdentityBackfillError);

    expect(legacy.draft.contractBalances.considerationEvents).toHaveLength(1);
    expect(legacy.draft.contractBalances.cashCollections).toHaveLength(1);
    expect(legacy.draft).toEqual(draftBefore);
    expect(legacy.state).toEqual(stateBefore);
  });
});
