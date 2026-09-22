/**
 * Package 2C-B — presentation labels.
 *
 * The concise accountant-facing label is additive and presentation-only. These
 * tests pin the three things that make that safe: the canonical draft stays
 * backward compatible, ownership of a label follows the same provenance rules
 * as every other AI-proposed value, and a label difference is never an
 * accounting matter — it cannot raise a material review item, recreate an
 * object, or move an identity.
 */
import { describe, expect, it } from "vitest";

import {
  createEmptyDraft,
  createPoDraft,
  createPromiseDraft,
  type WorkflowDraft,
} from "@/lib/asc606-workflow";

import {
  parseCanonicalInputs,
  toCanonicalInputs,
  validateDraftForPersistence,
} from "../../persistence/schema";
import { classifyReviewTarget } from "../edit-reconciliation";
import { deriveCanonicalId } from "../identity";
import { createEmptyAiAnalysisState, mergeAiAnalysis, type AiAnalysisState } from "../merge";
import type { AiContractAnalysis } from "../schema";
import { fixtureAAnalysis, guidancePackFixture, RUN_ID } from "./merge-fixtures";

const PROMISE_ID = deriveCanonicalId("promise", "promise:saas");
const PO_ID = deriveCanonicalId("performance_obligation", "po:saas");
const RUN_2 = "run-00000000-0000-4000-8000-000000000002";

const PROMISE_LABEL = "Hosted SaaS Access";
const PO_LABEL = "Hosted SaaS Service Series";
const PO_LONG_DESCRIPTION = "SaaS subscription";

function run(
  analysis: AiContractAnalysis,
  currentDraft: WorkflowDraft = createEmptyDraft(),
  currentAiState: AiAnalysisState = createEmptyAiAnalysisState(),
  runId: string = RUN_ID,
) {
  return mergeAiAnalysis({
    currentDraft,
    currentAiState,
    analysis,
    runId,
    guidancePack: guidancePackFixture(),
    priorContext: null,
  });
}

/** A pre-2C-B analysis: schema v5 carried no presentation label at all. */
function legacyAnalysis(): AiContractAnalysis {
  const analysis = fixtureAAnalysis();
  for (const promise of analysis.promises) delete promise.accountingLabel;
  for (const po of analysis.performanceObligations) delete po.accountingLabel;
  return analysis;
}

function topology(draft: WorkflowDraft) {
  return {
    promises: draft.promises.map((promise) => promise.id).sort(),
    pos: draft.performanceObligations.map((po) => po.id).sort(),
    membership: draft.promises
      .map((promise) => `${promise.id}->${promise.performanceObligationId ?? "none"}`)
      .sort(),
  };
}

/* ------------------------------------------- canonical draft compatibility */

describe("canonical persistence accepts the additive promise label", () => {
  it("loads an old draft that has no displayName", () => {
    const draft = createEmptyDraft();
    draft.promises = [{ ...createPromiseDraft(1, PROMISE_ID), description: "Hosted service" }];
    const stored = JSON.parse(JSON.stringify(toCanonicalInputs(draft))) as Record<string, unknown>;
    const storedPromise = (
      (stored["draft"] as Record<string, unknown>)["promises"] as Record<string, unknown>[]
    )[0]!;
    expect(storedPromise["displayName"]).toBeUndefined();

    const parsed = parseCanonicalInputs(stored);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.draft.promises[0]!.displayName).toBeUndefined();
    expect(parsed.draft.promises[0]!.description).toBe("Hosted service");
  });

  it("round-trips a new draft that carries a valid displayName", () => {
    const draft = createEmptyDraft();
    draft.promises = [
      {
        ...createPromiseDraft(1, PROMISE_ID),
        displayName: PROMISE_LABEL,
        description: "Annual hosted SaaS service",
      },
    ];
    const validated = validateDraftForPersistence(
      JSON.parse(JSON.stringify(toCanonicalInputs(draft).draft)),
    );
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    expect(validated.draft.promises[0]!.displayName).toBe(PROMISE_LABEL);

    const parsed = parseCanonicalInputs(toCanonicalInputs(validated.draft));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.draft.promises[0]!.displayName).toBe(PROMISE_LABEL);
  });

  it("fails closed when a present displayName is malformed", () => {
    const draft = createEmptyDraft();
    draft.promises = [createPromiseDraft(1, PROMISE_ID)];
    const payload = JSON.parse(JSON.stringify(toCanonicalInputs(draft).draft)) as Record<
      string,
      unknown
    >;
    (payload["promises"] as Record<string, unknown>[])[0]!["displayName"] = { label: "nope" };
    expect(validateDraftForPersistence(payload).ok).toBe(false);
  });
});

/* -------------------------------------------------------- first AI mapping */

describe("first AI application maps the accounting label", () => {
  it("writes the promise accountingLabel to displayName and keeps the detail", () => {
    const result = run(fixtureAAnalysis());
    const promise = result.draft.promises.find((candidate) => candidate.id === PROMISE_ID)!;
    expect(promise.displayName).toBe(PROMISE_LABEL);
    expect(promise.description).toBe("Annual hosted SaaS service");
  });

  it("writes the performance obligation accountingLabel to name", () => {
    const result = run(fixtureAAnalysis());
    const po = result.draft.performanceObligations.find((candidate) => candidate.id === PO_ID)!;
    expect(po.name).toBe(PO_LABEL);
    expect(po.name).not.toBe(PO_LONG_DESCRIPTION);
  });

  it("keeps the detailed obligation interpretation in the AI material", () => {
    const analysis = fixtureAAnalysis();
    expect(analysis.performanceObligations[0]!.description).toBe(PO_LONG_DESCRIPTION);
    // The detail is carried by the immutable analysis, not by the workpaper name.
    const result = run(analysis);
    expect(result.draft.performanceObligations[0]!.name).toBe(PO_LABEL);
  });
});

/* ------------------------------------------------------ ownership on rerun */

describe("presentation-label ownership", () => {
  function relabelled(): AiContractAnalysis {
    const analysis = fixtureAAnalysis();
    analysis.promises[0]!.accountingLabel = "Hosted Platform Access";
    analysis.performanceObligations[0]!.accountingLabel = "Hosted Platform Series";
    return analysis;
  }

  it("refreshes untouched AI-owned labels", () => {
    const first = run(fixtureAAnalysis());
    const second = run(relabelled(), first.draft, first.aiState, RUN_2);
    expect(second.draft.promises[0]!.displayName).toBe("Hosted Platform Access");
    expect(second.draft.performanceObligations[0]!.name).toBe("Hosted Platform Series");
  });

  it("preserves an accountant-edited label", () => {
    const first = run(fixtureAAnalysis());
    const edited: WorkflowDraft = {
      ...first.draft,
      promises: first.draft.promises.map((promise) => ({
        ...promise,
        displayName: "Accountant's promise label",
      })),
      performanceObligations: first.draft.performanceObligations.map((po) => ({
        ...po,
        name: "Accountant's PO name",
      })),
    };
    const second = run(relabelled(), edited, first.aiState, RUN_2);
    expect(second.draft.promises[0]!.displayName).toBe("Accountant's promise label");
    expect(second.draft.performanceObligations[0]!.name).toBe("Accountant's PO name");
  });

  it("preserves a manually created label that the AI never owned", () => {
    const draft = createEmptyDraft();
    draft.promises = [
      {
        ...createPromiseDraft(1, PROMISE_ID),
        displayName: "My own label",
        description: "Annual hosted SaaS service",
      },
    ];
    draft.performanceObligations = [{ ...createPoDraft(1, PO_ID), name: "My own PO" }];
    const result = run(fixtureAAnalysis(), draft);
    expect(result.draft.promises[0]!.displayName).toBe("My own label");
    expect(result.draft.performanceObligations[0]!.name).toBe("My own PO");
  });

  it("raises no review item when only the label drifted", () => {
    const first = run(fixtureAAnalysis());
    const edited: WorkflowDraft = {
      ...first.draft,
      promises: first.draft.promises.map((promise) => ({
        ...promise,
        displayName: "Accountant's promise label",
      })),
      performanceObligations: first.draft.performanceObligations.map((po) => ({
        ...po,
        name: "Accountant's PO name",
      })),
    };
    const second = run(relabelled(), edited, first.aiState, RUN_2);
    const labelItems = second.reviewItems.filter(
      (item) =>
        item.targetKey === `promise:${PROMISE_ID}:displayName` ||
        item.targetKey === `po:${PO_ID}:name`,
    );
    expect(labelItems).toEqual([]);
  });
});

/* -------------------------------------------- material projection exclusion */

describe("the label is excluded from the material accounting projection", () => {
  it("does not treat a performance obligation rename as a material accounting edit", () => {
    const first = run(fixtureAAnalysis());
    const renamed: WorkflowDraft = {
      ...first.draft,
      performanceObligations: first.draft.performanceObligations.map((po) => ({
        ...po,
        name: "A different workpaper name",
      })),
    };
    const key = `po:${PO_ID}:classification`;
    expect(classifyReviewTarget(renamed, key)).toEqual(classifyReviewTarget(first.draft, key));
  });

  it("does not treat a promise label edit as a material accounting edit", () => {
    const first = run(fixtureAAnalysis());
    const relabelled: WorkflowDraft = {
      ...first.draft,
      promises: first.draft.promises.map((promise) => ({
        ...promise,
        displayName: "A different promise label",
      })),
    };
    const key = `promise:${PROMISE_ID}:description`;
    expect(classifyReviewTarget(relabelled, key)).toEqual(classifyReviewTarget(first.draft, key));
  });
});

/* ------------------------------------------ legacy v5 → first v6 transition */

describe("legacy v5 baseline meeting its first v6 re-analysis", () => {
  it("refreshes an untouched legacy long-form PO name to the concise label", () => {
    const first = run(legacyAnalysis());
    expect(first.draft.performanceObligations[0]!.name).toBe(PO_LONG_DESCRIPTION);

    const second = run(fixtureAAnalysis(), first.draft, first.aiState, RUN_2);
    expect(second.draft.performanceObligations[0]!.name).toBe(PO_LABEL);
  });

  it("keeps an accountant-edited legacy PO name across the transition", () => {
    const first = run(legacyAnalysis());
    const edited: WorkflowDraft = {
      ...first.draft,
      performanceObligations: first.draft.performanceObligations.map((po) => ({
        ...po,
        name: "Accountant's legacy PO name",
      })),
    };
    const second = run(fixtureAAnalysis(), edited, first.aiState, RUN_2);
    expect(second.draft.performanceObligations[0]!.name).toBe("Accountant's legacy PO name");
  });

  it("lets an exact-matched legacy promise gain the new displayName", () => {
    const first = run(legacyAnalysis());
    expect(first.draft.promises[0]!.displayName).toBeUndefined();

    const second = run(fixtureAAnalysis(), first.draft, first.aiState, RUN_2);
    expect(second.draft.promises[0]!.id).toBe(PROMISE_ID);
    expect(second.draft.promises[0]!.displayName).toBe(PROMISE_LABEL);
  });

  it("changes no canonical ID, relationship or topology through the transition", () => {
    const first = run(legacyAnalysis());
    const second = run(fixtureAAnalysis(), first.draft, first.aiState, RUN_2);
    expect(topology(second.draft)).toEqual(topology(first.draft));
  });

  it("creates no material accounting review item merely from the new label capability", () => {
    const first = run(legacyAnalysis());
    const second = run(fixtureAAnalysis(), first.draft, first.aiState, RUN_2);
    const labelItems = second.reviewItems.filter(
      (item) =>
        item.targetKey === `promise:${PROMISE_ID}:displayName` ||
        item.targetKey === `po:${PO_ID}:name`,
    );
    expect(labelItems).toEqual([]);
  });
});
