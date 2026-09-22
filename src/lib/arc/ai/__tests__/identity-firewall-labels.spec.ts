/**
 * Package 2C-C — identity firewall verification.
 *
 * The concise accountant-facing label (AI `accountingLabel`, canonical
 * `PromiseDraft.displayName`, canonical presentation `PoDraft.name`) is
 * presentation metadata. These regressions prove it is fenced away from every
 * economic decision ARC makes: identity facts and signatures, exact matching,
 * subsumption / split, the identity graph, tombstones, structural-mutation
 * detection, source-set fingerprints, material accounting review and the
 * legacy v5 → v6 transition.
 *
 * No production identity code is changed by this tranche. Detailed AI
 * descriptions remain the corroborating evidence wherever the accepted
 * architecture already used them; the concise label never substitutes for them.
 *
 * All companies, customers and amounts are fictional.
 */
import { describe, expect, it } from "vitest";

import { createEmptyDraft, type WorkflowDraft } from "@/lib/asc606-workflow";

import { deriveCanonicalId } from "../identity";
import {
  asIncumbent,
  performanceObligationIdentityFacts,
  promiseIdentityFacts,
} from "../identity-facts";
import { resolveIdentityGraph } from "../identity-graph";
import { createEmptyAiAnalysisState, mergeAiAnalysis, type AiAnalysisState } from "../merge";
import { poIdentity, promiseIdentity, signaturesIdentify } from "../reconciliation";
import { assessSafeReanalysis, detectsStructuralMutation } from "../safe-reanalysis";
import type { AiContractAnalysis } from "../schema";
import { computeSourceSetFingerprint } from "../source-fingerprint";
import { fixtureAAnalysis, guidancePackFixture, RUN_ID } from "./merge-fixtures";

const PROMISE_ID = deriveCanonicalId("promise", "promise:saas");
const PO_ID = deriveCanonicalId("performance_obligation", "po:saas");
const RUN_2 = "run-00000000-0000-4000-8000-000000000002";
const RUN_3 = "run-00000000-0000-4000-8000-000000000003";
const FINGERPRINT = "sha256:fixture-source-set";

const OTHER_PROMISE_LABEL = "Platform Subscription";
const OTHER_PO_LABEL = "Platform Subscription Series";

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

/** Identical economics, different presentation labels — the only difference under test. */
function relabelled(): AiContractAnalysis {
  const analysis = fixtureAAnalysis();
  analysis.promises[0]!.accountingLabel = OTHER_PROMISE_LABEL;
  analysis.performanceObligations[0]!.accountingLabel = OTHER_PO_LABEL;
  return analysis;
}

/** A pre-2C analysis: schema v5 carried no presentation label at all. */
function legacyAnalysis(): AiContractAnalysis {
  const analysis = fixtureAAnalysis();
  for (const promise of analysis.promises) delete promise.accountingLabel;
  for (const po of analysis.performanceObligations) delete po.accountingLabel;
  return analysis;
}

function spans(analysis: AiContractAnalysis, kind: "promise" | "po") {
  const citations =
    kind === "promise" ? analysis.promises[0]!.citations : analysis.performanceObligations[0]!.citations;
  return citations.map((citation) => ({
    documentId: citation.documentId,
    pageStart: citation.pageStart,
    pageEnd: citation.pageEnd,
    ...(citation.excerpt ? { normalizedExcerpt: citation.excerpt } : {}),
  }));
}

function promiseFactsOf(analysis: AiContractAnalysis) {
  const promise = analysis.promises[0]!;
  return promiseIdentityFacts({
    semanticKey: promise.semanticKey,
    promiseType: promise.promiseType,
    description: promise.description,
    distinctConclusion: promise.distinctConclusion,
    citations: spans(analysis, "promise"),
  });
}

function poFactsOf(analysis: AiContractAnalysis) {
  const po = analysis.performanceObligations[0]!;
  return performanceObligationIdentityFacts({
    semanticKey: po.semanticKey,
    description: po.description,
    satisfactionPattern: po.satisfactionPattern,
    citations: spans(analysis, "po"),
  });
}

function promiseSignatureOf(analysis: AiContractAnalysis) {
  const promise = analysis.promises[0]!;
  return promiseIdentity({
    promiseType: promise.promiseType,
    citations: promise.citations,
    description: promise.description,
  });
}

function poSignatureOf(analysis: AiContractAnalysis) {
  const po = analysis.performanceObligations[0]!;
  return poIdentity({ satisfactionPattern: po.satisfactionPattern, citations: po.citations });
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

/** The canonical draft with every presentation label erased, for economic comparison. */
function withoutLabels(draft: WorkflowDraft): WorkflowDraft {
  return {
    ...draft,
    promises: draft.promises.map(({ displayName: _displayName, ...promise }) => promise),
    performanceObligations: draft.performanceObligations.map((po) => ({ ...po, name: "" })),
  };
}

function issueKeys(issues: readonly { targetKey: string; state: string }[]) {
  return issues.map((issue) => `${issue.targetKey}:${issue.state}`).sort();
}

/** The state ARC holds after one run was safely applied to an empty draft. */
function applied(analysis: AiContractAnalysis) {
  const merged = run(analysis);
  return {
    draft: merged.draft,
    aiState: {
      ...merged.aiState,
      lastSuccessfulRunId: RUN_ID,
      sourceSetFingerprint: FINGERPRINT,
    } satisfies AiAnalysisState,
  };
}

/* ------------------------------------------------- identity facts / signatures */

describe("identity facts and signatures ignore presentation labels", () => {
  it("builds identical promise and obligation facts for relabelled economics", () => {
    expect(promiseFactsOf(relabelled())).toEqual(promiseFactsOf(fixtureAAnalysis()));
    expect(poFactsOf(relabelled())).toEqual(poFactsOf(fixtureAAnalysis()));
  });

  it("never carries a label into the fact model", () => {
    const serialized = JSON.stringify([promiseFactsOf(relabelled()), poFactsOf(relabelled())]);
    expect(serialized).not.toContain(OTHER_PROMISE_LABEL);
    expect(serialized).not.toContain(OTHER_PO_LABEL);
    expect(serialized).not.toContain("accountingLabel");
  });

  it("keeps the detailed description as the corroborating promise evidence", () => {
    expect(promiseFactsOf(fixtureAAnalysis()).normalizedDescription).toContain("hosted saas");
    expect(promiseSignatureOf(fixtureAAnalysis()).corroborators).toContain(
      "annual hosted saas service",
    );
  });

  it("produces identical identity signatures across label variants", () => {
    expect(promiseSignatureOf(relabelled())).toEqual(promiseSignatureOf(fixtureAAnalysis()));
    expect(poSignatureOf(relabelled())).toEqual(poSignatureOf(fixtureAAnalysis()));
    expect(signaturesIdentify(promiseSignatureOf(relabelled()), promiseSignatureOf(fixtureAAnalysis()))).toBe(
      true,
    );
    expect(signaturesIdentify(poSignatureOf(relabelled()), poSignatureOf(fixtureAAnalysis()))).toBe(true);
  });

  it("puts neither the promise displayName nor the obligation name into a signature", () => {
    const serialized = JSON.stringify([promiseSignatureOf(relabelled()), poSignatureOf(relabelled())]);
    expect(serialized).not.toContain(OTHER_PROMISE_LABEL);
    expect(serialized).not.toContain(OTHER_PO_LABEL);
  });
});

/* ---------------------------------------------------- same-source exact matching */

describe("label-only drift keeps exact canonical matching", () => {
  it("retains the same canonical promise and obligation ids", () => {
    const first = run(fixtureAAnalysis());
    const second = run(relabelled(), first.draft, first.aiState, RUN_2);

    expect(second.draft.promises.map((promise) => promise.id)).toEqual([PROMISE_ID]);
    expect(second.draft.performanceObligations.map((po) => po.id)).toEqual([PO_ID]);
    expect(topology(second.draft)).toEqual(topology(first.draft));
  });

  it("creates no duplicate object and no merge or split", () => {
    const first = run(fixtureAAnalysis());
    const second = run(relabelled(), first.draft, first.aiState, RUN_2);
    expect(second.draft.promises).toHaveLength(1);
    expect(second.draft.performanceObligations).toHaveLength(1);
    expect(new Set(Object.values(second.aiState.objectProvenance).map((p) => p.canonicalId)).size).toBe(
      new Set(Object.values(first.aiState.objectProvenance).map((p) => p.canonicalId)).size,
    );
  });

  it("leaves every economic value in the canonical draft unchanged", () => {
    const first = run(fixtureAAnalysis());
    const second = run(relabelled(), first.draft, first.aiState, RUN_2);
    expect(withoutLabels(second.draft)).toEqual(withoutLabels(first.draft));
  });
});

/* -------------------------------------------- graph, subsumption and decomposition */

describe("the identity graph is invariant to presentation labels", () => {
  function resolve(proposal: AiContractAnalysis, incumbent: AiContractAnalysis) {
    return {
      promises: resolveIdentityGraph({
        objectKind: "promise",
        proposals: [promiseFactsOf(proposal)],
        incumbents: [asIncumbent(promiseFactsOf(incumbent), PROMISE_ID)],
      }),
      pos: resolveIdentityGraph({
        objectKind: "performance_obligation",
        proposals: [poFactsOf(proposal)],
        incumbents: [asIncumbent(poFactsOf(incumbent), PO_ID)],
      }),
    };
  }

  it("resolves the same alignments, membership and relations for relabelled proposals", () => {
    expect(resolve(relabelled(), fixtureAAnalysis())).toEqual(
      resolve(fixtureAAnalysis(), fixtureAAnalysis()),
    );
  });

  it("never turns a relation into subsumes or split because a label differs", () => {
    const control = resolve(fixtureAAnalysis(), fixtureAAnalysis());
    const resolved = resolve(relabelled(), fixtureAAnalysis());
    for (const kind of ["promises", "pos"] as const) {
      const relations = resolved[kind].alignments.map((a) => a.relation);
      expect(relations).toEqual(control[kind].alignments.map((a) => a.relation));
      expect(relations).not.toContain("subsumes");
      expect(relations).not.toContain("split_from");
      expect(resolved[kind].omittedCanonicalIds).toEqual(control[kind].omittedCanonicalIds);
    }
  });
});

/* ------------------------------------------------------------ Safe Re-analysis */

describe("Safe Re-analysis decisions are invariant to presentation labels", () => {
  function decide(next: AiContractAnalysis, prior: AiContractAnalysis) {
    const base = applied(prior);
    return assessSafeReanalysis({
      analysis: next,
      priorAnalysis: prior,
      priorAnalysisLoad: "loaded",
      currentDraft: base.draft,
      currentAiState: base.aiState,
      currentSourceSetFingerprint: FINGERPRINT,
    });
  }

  it("reaches the same decision when only labels drifted", () => {
    expect(decide(relabelled(), fixtureAAnalysis())).toEqual(
      decide(fixtureAAnalysis(), fixtureAAnalysis()),
    );
  });

  it("cannot turn a real structural difference into a safe apply", () => {
    const mutated = relabelled();
    mutated.promises[0]!.semanticKey = "promise:renamed";
    mutated.performanceObligations[0]!.promiseKeys = ["promise:renamed"];
    expect(decide(mutated, fixtureAAnalysis()).outcome).toBe("decline");
  });

  it("detects no structural mutation for a label-only re-analysis", () => {
    const first = run(fixtureAAnalysis());
    const second = run(relabelled(), first.draft, first.aiState, RUN_2);
    expect(detectsStructuralMutation(first.draft, second.draft)).toBe(false);
  });

  it("still detects a genuine structural mutation when labels also changed", () => {
    const first = run(fixtureAAnalysis());
    const second = run(relabelled(), first.draft, first.aiState, RUN_2);
    const mutated: WorkflowDraft = {
      ...second.draft,
      performanceObligations: [],
      promises: second.draft.promises.map((promise) => ({
        ...promise,
        performanceObligationId: null,
      })),
    };
    expect(detectsStructuralMutation(first.draft, mutated)).toBe(true);
  });
});

/* ---------------------------------------------------------------- tombstones */

describe("tombstones are unaffected by presentation labels", () => {
  it("never resurrects a deleted obligation because its label changed", () => {
    const first = run(fixtureAAnalysis());
    const deleted: WorkflowDraft = {
      ...first.draft,
      performanceObligations: [],
      promises: first.draft.promises.map((promise) => ({
        ...promise,
        performanceObligationId: null,
      })),
    };
    const second = run(relabelled(), deleted, first.aiState, RUN_2);
    expect(second.aiState.tombstones).toContain("po:saas");
    expect(second.draft.performanceObligations).toHaveLength(0);

    const third = run(relabelled(), second.draft, second.aiState, RUN_3);
    expect(third.draft.performanceObligations).toHaveLength(0);
    expect(third.aiState.tombstones).toContain("po:saas");
  });

  it("matches a tombstone on economics, so a label change alone changes nothing", () => {
    const first = run(fixtureAAnalysis());
    const deleted: WorkflowDraft = {
      ...first.draft,
      performanceObligations: [],
      promises: first.draft.promises.map((promise) => ({
        ...promise,
        performanceObligationId: null,
      })),
    };
    const labelled = run(relabelled(), deleted, first.aiState, RUN_2);
    const unlabelled = run(fixtureAAnalysis(), deleted, first.aiState, RUN_2);
    expect([...labelled.aiState.tombstones].sort()).toEqual([...unlabelled.aiState.tombstones].sort());
    expect(topology(labelled.draft)).toEqual(topology(unlabelled.draft));
  });
});

/* ------------------------------------------------------------ source identity */

describe("source-set fingerprints ignore presentation labels", () => {
  it("depends only on verified document identity", async () => {
    const sources = [{ documentId: "doc-fixture-1", sha256: "a".repeat(64) }];
    const first = await computeSourceSetFingerprint(sources);
    const second = await computeSourceSetFingerprint([{ ...sources[0]! }]);
    expect(second).toBe(first);
  });

  it("changes only when document identity changes", async () => {
    const one = await computeSourceSetFingerprint([
      { documentId: "doc-fixture-1", sha256: "a".repeat(64) },
    ]);
    const two = await computeSourceSetFingerprint([
      { documentId: "doc-fixture-1", sha256: "b".repeat(64) },
    ]);
    expect(two).not.toBe(one);
  });
});

/* ------------------------------------------------- material review / readiness */

describe("label-only variation raises no accounting matter", () => {
  it("produces the same review items as an identical re-run", () => {
    const first = run(fixtureAAnalysis());
    const labelled = run(relabelled(), first.draft, first.aiState, RUN_2);
    const identical = run(fixtureAAnalysis(), first.draft, first.aiState, RUN_2);
    expect(issueKeys(labelled.issues)).toEqual(issueKeys(identical.issues));
  });

  it("opens no review item against the label fields themselves", () => {
    const first = run(fixtureAAnalysis());
    const second = run(relabelled(), first.draft, first.aiState, RUN_2);
    expect(
      second.issues.filter(
        (issue) =>
          issue.targetKey === `promise:${PROMISE_ID}.displayName` ||
          issue.targetKey === `po:${PO_ID}.name`,
      ),
    ).toEqual([]);
  });
});

/* -------------------------------- historical poFingerprintValue containment */

describe("the historical object fingerprint stays contained", () => {
  function renamedByAccountant(first: ReturnType<typeof run>): WorkflowDraft {
    return {
      ...first.draft,
      performanceObligations: first.draft.performanceObligations.map((po) => ({
        ...po,
        name: "Accountant's workpaper name",
      })),
    };
  }

  it("may flag historical object provenance as user-modified after a name-only edit", () => {
    const first = run(fixtureAAnalysis());
    const second = run(relabelled(), renamedByAccountant(first), first.aiState, RUN_2);
    // Whatever the historical fingerprint concludes, it is provenance only.
    expect(typeof second.aiState.objectProvenance["po:saas"]?.userModified).toBe("boolean");
  });

  it("protects the accountant's label through field-level provenance", () => {
    const first = run(fixtureAAnalysis());
    const second = run(relabelled(), renamedByAccountant(first), first.aiState, RUN_2);
    expect(second.draft.performanceObligations[0]!.name).toBe("Accountant's workpaper name");
  });

  it("changes no identity, topology or review conclusion because of that flag", () => {
    const first = run(fixtureAAnalysis());
    const renamed = run(relabelled(), renamedByAccountant(first), first.aiState, RUN_2);
    const untouched = run(relabelled(), first.draft, first.aiState, RUN_2);

    expect(topology(renamed.draft)).toEqual(topology(untouched.draft));
    expect(renamed.draft.performanceObligations[0]!.id).toBe(PO_ID);
    expect(issueKeys(renamed.issues)).toEqual(issueKeys(untouched.issues));
    expect(detectsStructuralMutation(first.draft, renamed.draft)).toBe(false);
  });
});

/* ------------------------------------------ legacy v5 → first v6 transition */

describe("the legacy v5 baseline keeps its identity through the first v6 run", () => {
  it("keeps identical identity signatures across the schema transition", () => {
    expect(promiseSignatureOf(fixtureAAnalysis())).toEqual(promiseSignatureOf(legacyAnalysis()));
    expect(poSignatureOf(fixtureAAnalysis())).toEqual(poSignatureOf(legacyAnalysis()));
  });

  it("keeps the same canonical ids and topology when the long-form name refreshes", () => {
    const first = run(legacyAnalysis());
    expect(first.draft.performanceObligations[0]!.name).toBe("SaaS subscription");

    const second = run(fixtureAAnalysis(), first.draft, first.aiState, RUN_2);
    expect(second.draft.performanceObligations[0]!.name).toBe("Hosted SaaS Service Series");
    expect(second.draft.promises[0]!.displayName).toBe("Hosted SaaS Access");
    expect(topology(second.draft)).toEqual(topology(first.draft));
  });

  it("preserves an accountant-edited legacy name without changing identity", () => {
    const first = run(legacyAnalysis());
    const edited: WorkflowDraft = {
      ...first.draft,
      performanceObligations: first.draft.performanceObligations.map((po) => ({
        ...po,
        name: "Accountant's legacy name",
      })),
    };
    const second = run(fixtureAAnalysis(), edited, first.aiState, RUN_2);
    expect(second.draft.performanceObligations[0]!.name).toBe("Accountant's legacy name");
    expect(second.draft.performanceObligations[0]!.id).toBe(PO_ID);
    expect(topology(second.draft)).toEqual(topology(first.draft));
  });
});
