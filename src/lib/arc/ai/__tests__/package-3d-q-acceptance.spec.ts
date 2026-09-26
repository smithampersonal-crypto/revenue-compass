/**
 * Package 3D-Q — acceptance patch.
 *
 * 1. The post-merge structural backstop permits ONLY the exact legacy billing
 *    retraction the merge declares; everything else still fails closed.
 * 2. Fixed-billing evidence is never composed across unrelated sentences.
 * 3. Schema v6 → v7 transition and "no merge, no mutation" coverage.
 *
 * Deterministic only: synthetic data, no provider, no network, no database.
 */
import { describe, expect, it } from "vitest";

import type { WorkflowDraft } from "@/lib/asc606-workflow/types";

import { checkFixedBillingEvidence } from "../billing-evidence";
import { reconcileAiEdits } from "../edit-reconciliation";
import { mergeAiAnalysis } from "../merge";
import { detectsStructuralMutation } from "../safe-reanalysis";
import {
  AI_OUTPUT_SCHEMA_VERSION,
  LEGACY_V6_AI_OUTPUT_SCHEMA_VERSION,
  parseAiContractAnalysis,
  parsePersistedAiContractAnalysis,
} from "../schema";
import { accountantState, genomixAnalysis } from "./genomix-fixtures";
import { guidancePackFixture } from "./merge-fixtures";

/* ------------------------------------------------------------ fixtures */

/** Legacy (pre-v7) accountant state: billing provenance has no v7 marker. */
function legacyState() {
  const { draft, aiState } = accountantState();
  const objectProvenance = Object.fromEntries(
    Object.entries(aiState.objectProvenance).map(([key, value]) => {
      const { derivation: _derivation, ...rest } = value;
      return [key, rest];
    }),
  );
  return { draft, aiState: { ...aiState, objectProvenance } };
}

function refusedAnnual() {
  const analysis = genomixAnalysis();
  analysis.billingTerms = analysis.billingTerms.map((term) => ({
    ...term,
    amountKind: "pricing_basis_only" as const,
  }));
  return analysis;
}

function v7Merge(draft: WorkflowDraft, aiState: ReturnType<typeof legacyState>["aiState"]) {
  return mergeAiAnalysis({
    currentDraft: draft,
    currentAiState: aiState,
    analysis: refusedAnnual(),
    runId: "run-00000000-0000-4000-8000-0000000000d7",
    guidancePack: guidancePackFixture(),
    priorContext: null,
  });
}

/* ================================================= 1. exact backstop */

describe("structural backstop — exact legacy retraction allowance", () => {
  it("passes exactly the retraction the merge declared", () => {
    const { draft, aiState } = legacyState();
    const merged = v7Merge(draft, aiState);
    const allowance = merged.authorizedStructuralRetractions;
    expect(allowance.considerationEventIds).toHaveLength(1);
    expect(allowance.cashCollectionIds).toHaveLength(1);
    expect(detectsStructuralMutation(draft, merged.draft)).toBe(true);
    expect(detectsStructuralMutation(draft, merged.draft, allowance)).toBe(false);
  });

  it("rejects an unlisted invoice deletion", () => {
    const { draft } = legacyState();
    const [event] = draft.contractBalances.considerationEvents;
    const after: WorkflowDraft = {
      ...draft,
      contractBalances: {
        ...draft.contractBalances,
        considerationEvents: [],
        cashCollections: [],
      },
    };
    expect(detectsStructuralMutation(draft, after, null)).toBe(true);
    expect(
      detectsStructuralMutation(draft, after, {
        considerationEventIds: ["ce-some-other-invoice"],
        cashCollectionIds: [],
      }),
    ).toBe(true);
    // Declaring the invoice but not its collection leaves an orphan: refused.
    expect(
      detectsStructuralMutation(draft, after, {
        considerationEventIds: [event!.id],
        cashCollectionIds: [],
      }),
    ).toBe(true);
  });

  it("rejects a declared retraction that did not actually happen", () => {
    const { draft, aiState } = legacyState();
    const merged = v7Merge(draft, aiState);
    expect(detectsStructuralMutation(draft, draft, merged.authorizedStructuralRetractions)).toBe(
      true,
    );
  });

  it("still rejects promise, obligation, VC and modification topology changes", () => {
    const { draft, aiState } = legacyState();
    const merged = v7Merge(draft, aiState);
    const allowance = merged.authorizedStructuralRetractions;
    const base = merged.draft;
    const variants: WorkflowDraft[] = [
      { ...base, promises: base.promises.slice(1) },
      { ...base, promises: [...base.promises, { ...base.promises[0]!, id: "p-extra" }] },
      {
        ...base,
        promises: base.promises.map((promise, index) =>
          index === base.promises.length - 1
            ? { ...promise, performanceObligationId: base.performanceObligations[0]!.id }
            : promise,
        ),
      },
      { ...base, performanceObligations: base.performanceObligations.slice(1) },
      {
        ...base,
        variableConsiderationComponents: base.variableConsiderationComponents.map((vc, index) =>
          index === 0 ? { ...vc, targetPoId: base.performanceObligations[1]!.id } : vc,
        ),
      },
      { ...base, variableConsiderationComponents: base.variableConsiderationComponents.slice(1) },
      {
        ...base,
        contractModifications: [{ id: "mod-extra" } as WorkflowDraft["contractModifications"][number]],
      },
    ];
    for (const variant of variants) {
      expect(detectsStructuralMutation(draft, variant, allowance)).toBe(true);
    }
  });

  it("rejects additional billing rows alongside an authorized retraction", () => {
    const { draft, aiState } = legacyState();
    const merged = v7Merge(draft, aiState);
    const extra = { ...draft.contractBalances.considerationEvents[0]!, id: "ce-extra" };
    const after: WorkflowDraft = {
      ...merged.draft,
      contractBalances: {
        ...merged.draft.contractBalances,
        considerationEvents: [...merged.draft.contractBalances.considerationEvents, extra],
      },
    };
    expect(detectsStructuralMutation(draft, after, merged.authorizedStructuralRetractions)).toBe(
      true,
    );
  });

  it("declares nothing when the legacy rows were edited", () => {
    const { draft, aiState } = legacyState();
    const [event] = draft.contractBalances.considerationEvents;
    const edited: WorkflowDraft = {
      ...draft,
      contractBalances: {
        ...draft.contractBalances,
        considerationEvents: [{ ...event!, amountInput: "99999" }],
      },
    };
    const merged = v7Merge(edited, aiState);
    expect(merged.authorizedStructuralRetractions.considerationEventIds).toEqual([]);
    expect(merged.draft.contractBalances.considerationEvents.map((row) => row.id)).toEqual([
      event!.id,
    ]);
  });
});

/* ============================================== 2. evidence cohesion */

describe("fixed-billing evidence is never composed across sentences", () => {
  const input = (excerpt: string, amount: string, frequency: "monthly" | "annual", timing: "advance" | "arrears") => ({
    billingTiming: timing,
    frequency,
    amountOrRateInput: amount,
    citations: [{ evidenceMode: "text", excerpt }],
  });

  it("refuses an amount from one term and a cadence/timing from another", () => {
    expect(
      checkFixedBillingEvidence(
        input(
          "The platform license fee is $120,000. Support is invoiced monthly in advance.",
          "120000",
          "monthly",
          "advance",
        ),
      ).ok,
    ).toBe(false);
  });

  it("refuses the same split across two separate citations", () => {
    expect(
      checkFixedBillingEvidence({
        billingTiming: "advance",
        frequency: "monthly",
        amountOrRateInput: "120000",
        citations: [
          { evidenceMode: "text", excerpt: "The platform license fee is $120,000." },
          { evidenceMode: "text", excerpt: "Support is invoiced monthly in advance." },
        ],
      }).ok,
    ).toBe(false);
  });

  it("still accepts the exact Genomix phrase and explicit single-sentence terms", () => {
    expect(
      checkFixedBillingEvidence(
        input("Billing Schedule Annual Advance ($245,000/yr Net 30)", "245000", "annual", "advance"),
      ),
    ).toEqual({ ok: true });
    expect(
      checkFixedBillingEvidence(
        input("$10,000 invoiced monthly in arrears", "10000", "monthly", "arrears"),
      ),
    ).toEqual({ ok: true });
    expect(
      checkFixedBillingEvidence(
        input("$120,000 invoiced annually in advance", "120000", "annual", "advance"),
      ),
    ).toEqual({ ok: true });
  });
});

/* ============================================ 3. schema transition */

function v6Payload(): Record<string, unknown> {
  const analysis = structuredClone(genomixAnalysis()) as unknown as Record<string, unknown>;
  analysis["schemaVersion"] = LEGACY_V6_AI_OUTPUT_SCHEMA_VERSION;
  analysis["billingTerms"] = (analysis["billingTerms"] as Record<string, unknown>[]).map(
    ({ amountKind: _amountKind, ...rest }) => rest,
  );
  return analysis;
}

describe("schema v6 → v7 transition", () => {
  it("parses a persisted v6 payload and normalizes missing amountKind to unknown", () => {
    const parsed = parsePersistedAiContractAnalysis(v6Payload(), LEGACY_V6_AI_OUTPUT_SCHEMA_VERSION);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.analysis.billingTerms.length).toBeGreaterThan(0);
    expect(parsed.analysis.billingTerms.every((term) => term.amountKind === "unknown")).toBe(true);
  });

  it("rejects v6 as a current-generation live result", () => {
    expect(parseAiContractAnalysis(v6Payload()).ok).toBe(false);
  });

  it("fails closed on a recorded-version mismatch", () => {
    expect(parsePersistedAiContractAnalysis(v6Payload(), AI_OUTPUT_SCHEMA_VERSION).ok).toBe(false);
    expect(
      parsePersistedAiContractAnalysis(genomixAnalysis(), LEGACY_V6_AI_OUTPUT_SCHEMA_VERSION).ok,
    ).toBe(false);
  });

  it("never mutates legacy billing rows when a saved draft is opened or autosaved", () => {
    const { draft, aiState } = legacyState();
    const snapshot = JSON.stringify(draft.contractBalances);
    // Opening: reading the immutable prior result touches no draft.
    expect(parsePersistedAiContractAnalysis(v6Payload(), LEGACY_V6_AI_OUTPUT_SCHEMA_VERSION).ok).toBe(
      true,
    );
    // Autosave of an unchanged draft: the only non-merge path over draft + sidecar.
    const reconciled = reconcileAiEdits({ previousDraft: draft, nextDraft: draft, currentAiState: aiState });
    expect(JSON.stringify(draft.contractBalances)).toBe(snapshot);
    const billingKeys = Object.keys(aiState.objectProvenance).filter((key) => key.startsWith("billing"));
    for (const key of billingKeys) {
      expect(reconciled.aiState.objectProvenance[key]).toBeDefined();
      expect(reconciled.aiState.objectProvenance[key]!.derivation).toBeUndefined();
    }
  });

  it("revalidates legacy billing only on a deliberate v7 re-analysis", () => {
    const { draft, aiState } = legacyState();
    const merged = v7Merge(draft, aiState);
    expect(merged.draft.contractBalances.considerationEvents).toHaveLength(0);
    expect(merged.issues.some((issue) => issue.reasonCode === "ai_derivation_retracted")).toBe(true);
  });
});
