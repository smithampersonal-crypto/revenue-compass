/**
 * ARC v1 — Safe Re-analysis firewall.
 *
 * The gate is a pre-merge safety decision, never a structural mutation engine.
 * These tests fix the behaviour that protects the accountant's canonical work:
 * clean exact continuity may be applied, and everything else is safely declined
 * with the existing analysis preserved.
 *
 * All companies, customers and amounts are fictional.
 */
import { describe, expect, it } from "vitest";

import { createEmptyDraft } from "@/lib/asc606-workflow";

import { createEmptyAiAnalysisState, mergeAiAnalysis, type AiAnalysisState } from "../merge";
import {
  assessSafeReanalysis,
  isChangedSourceReanalysis,
  type SafeReanalysisInput,
} from "../safe-reanalysis";
import type { AiContractAnalysis } from "../schema";
import { fixtureMultiElementAnalysis, guidancePackFixture, RUN_ID } from "./merge-fixtures";

const FINGERPRINT = "sha256:fixture-source-set";

/** The state ARC holds after one run was SAFELY APPLIED to an empty draft. */
function applied(analysis: AiContractAnalysis) {
  const merged = mergeAiAnalysis({
    currentDraft: createEmptyDraft(),
    currentAiState: createEmptyAiAnalysisState(),
    analysis,
    runId: RUN_ID,
    guidancePack: guidancePackFixture(),
    priorContext: null,
  });
  const aiState: AiAnalysisState = {
    ...merged.aiState,
    lastSuccessfulRunId: RUN_ID,
    sourceSetFingerprint: FINGERPRINT,
  };
  return { draft: merged.draft, aiState };
}

function input(
  next: AiContractAnalysis,
  prior: AiContractAnalysis,
  overrides: Partial<SafeReanalysisInput> = {},
): SafeReanalysisInput {
  const base = applied(prior);
  return {
    analysis: next,
    priorAnalysis: prior,
    priorAnalysisLoad: "loaded",
    currentDraft: base.draft,
    currentAiState: base.aiState,
    currentSourceSetFingerprint: FINGERPRINT,
    ...overrides,
  };
}

/* ------------------------------------------------------------- scenarios */

/** Two promises in two obligations: the shape a clean re-run must preserve. */
function baseline(): AiContractAnalysis {
  return fixtureMultiElementAnalysis();
}

/** The same contract described later as ONE combined promise and obligation. */
function decomposed(): AiContractAnalysis {
  const analysis = baseline();
  const [platform, support] = analysis.promises;
  analysis.promises = [
    {
      ...platform!,
      semanticKey: "promise:platform-and-support",
      description: "Hosted platform including premium support services",
      citations: [...platform!.citations, ...support!.citations],
    },
  ];
  analysis.performanceObligations = [
    {
      ...analysis.performanceObligations[0]!,
      semanticKey: "po:combined",
      promiseKeys: ["promise:platform-and-support"],
      description: "Hosted platform including premium support",
    },
  ];
  analysis.recognitionProposals = [
    { ...analysis.recognitionProposals[0]!, performanceObligationKey: "po:combined" },
  ];
  analysis.sspAndAllocation.items = [
    { ...analysis.sspAndAllocation.items[0]!, appliesToKey: "po:combined" },
  ];
  return analysis;
}

/** The later run simply stops mentioning the support obligation. */
function omitting(): AiContractAnalysis {
  const analysis = baseline();
  analysis.promises = [analysis.promises[0]!];
  analysis.performanceObligations = [analysis.performanceObligations[0]!];
  analysis.recognitionProposals = [analysis.recognitionProposals[0]!];
  analysis.sspAndAllocation.items = [analysis.sspAndAllocation.items[0]!];
  return analysis;
}

/** The later run adds an obligation the earlier one never described. */
function withNewObligation(): AiContractAnalysis {
  const analysis = baseline();
  const po = analysis.performanceObligations[1]!;
  const promise = analysis.promises[1]!;
  analysis.promises = [
    ...analysis.promises,
    {
      ...promise,
      semanticKey: "promise:training",
      description: "On-site operator training workshops",
      citations: [{ ...promise.citations[0]!, pageStart: 9, pageEnd: 9, excerpt: "training" }],
    },
  ];
  analysis.performanceObligations = [
    ...analysis.performanceObligations,
    {
      ...po,
      semanticKey: "po:training",
      promiseKeys: ["promise:training"],
      description: "On-site operator training",
    },
  ];
  return analysis;
}

/* ------------------------------------------------------------------ tests */

describe("Safe Re-analysis — establishing a baseline", () => {
  it("treats a genuinely empty analysis as a first run", () => {
    const decision = assessSafeReanalysis({
      analysis: baseline(),
      priorAnalysis: null,
      priorAnalysisLoad: "not_required",
      currentDraft: createEmptyDraft(),
      currentAiState: createEmptyAiAnalysisState(),
      currentSourceSetFingerprint: FINGERPRINT,
    });
    expect(decision.outcome).toBe("first_run");
  });

  it("declines to bootstrap over canonical structure the accountant built", () => {
    const draft = createEmptyDraft();
    draft.promises = [...applied(baseline()).draft.promises];
    const decision = assessSafeReanalysis({
      analysis: baseline(),
      priorAnalysis: null,
      priorAnalysisLoad: "not_required",
      currentDraft: draft,
      currentAiState: createEmptyAiAnalysisState(),
      currentSourceSetFingerprint: FINGERPRINT,
    });
    expect(decision).toEqual({ outcome: "decline", reason: "unestablished_baseline" });
  });
});

describe("Safe Re-analysis — exact continuity", () => {
  it("allows an identical same-source re-run to reach the merge", () => {
    expect(assessSafeReanalysis(input(baseline(), baseline())).outcome).toBe("apply");
  });

  it("never mutates its inputs", () => {
    const args = input(baseline(), baseline());
    const before = JSON.stringify(args);
    assessSafeReanalysis(args);
    expect(JSON.stringify(args)).toBe(before);
  });
});

describe("Safe Re-analysis — structural drift is declined, never applied", () => {
  it("declines a re-run that recomposes two canonical objects into one", () => {
    const decision = assessSafeReanalysis(input(decomposed(), baseline()));
    expect(decision.outcome).toBe("decline");
    expect(decision.reason).not.toBe("prior_analysis_unavailable");
  });

  it("declines a re-run that splits one canonical object into two", () => {
    const decision = assessSafeReanalysis(input(baseline(), decomposed()));
    expect(decision.outcome).toBe("decline");
  });

  it("declines rather than deleting a canonical object the re-run omitted", () => {
    const decision = assessSafeReanalysis(input(omitting(), baseline()));
    expect(decision.outcome).toBe("decline");
    expect(decision.reason).toBe("omitted_incumbent");
  });

  it("declines rather than minting a canonical object from a new proposal", () => {
    const decision = assessSafeReanalysis(input(withNewObligation(), baseline()));
    expect(decision.outcome).toBe("decline");
    expect(["unmatched", "ambiguous"]).toContain(decision.reason);
  });
});

describe("Safe Re-analysis — the prior immutable result is required", () => {
  it("fails closed when the trusted layer could not load it", () => {
    const decision = assessSafeReanalysis(
      input(baseline(), baseline(), { priorAnalysis: null, priorAnalysisLoad: "unavailable" }),
    );
    expect(decision).toEqual({ outcome: "decline", reason: "prior_analysis_unavailable" });
  });

  it("fails closed when it was malformed, even though the sidecar is complete", () => {
    const args = input(baseline(), baseline(), {
      priorAnalysis: null,
      priorAnalysisLoad: "unavailable",
    });
    // The mutable sidecar carries every semantic key of the applied run, and is
    // still not an acceptable substitute for the immutable structured result.
    expect(Object.keys(args.currentAiState.objectProvenance).length).toBeGreaterThan(0);
    expect(assessSafeReanalysis(args).reason).toBe("prior_analysis_unavailable");
  });
});

describe("Safe Re-analysis — changed source", () => {
  it("declines without entering reconciliation", () => {
    const decision = assessSafeReanalysis(
      input(baseline(), baseline(), { currentSourceSetFingerprint: "sha256:other-documents" }),
    );
    expect(decision).toEqual({ outcome: "decline", reason: "source_changed" });
  });

  it("is detectable before any allowance is reserved", () => {
    const state = applied(baseline()).aiState;
    expect(isChangedSourceReanalysis(state, "sha256:other-documents")).toBe(true);
    expect(isChangedSourceReanalysis(state, FINGERPRINT)).toBe(false);
  });

  it("never short-circuits a run that has no baseline to protect", () => {
    expect(
      isChangedSourceReanalysis(createEmptyAiAnalysisState(), "sha256:anything"),
    ).toBe(false);
  });
});
