/**
 * Tranche 2 (RED first) — pure identity facts and evidence sufficiency.
 *
 * These tests use the accepted production Run 1 / Run A / Run B fixtures. They assert the frozen
 * Design Rev 3 + Amendment 3A evidence rules:
 *   - accounting judgments never gate identity;
 *   - page/document overlap is corroboration, never identity;
 *   - exact normalized bounded-excerpt equality or strict containment is strong evidence;
 *   - no percentage / fuzzy similarity threshold anywhere.
 */

import { describe, expect, it } from "vitest";

import {
  assessIdentityEvidence,
  asIncumbent,
  hasPriorSourceEvidence,
  promiseIdentityFacts,
  billingTermIdentityFacts,
  variableConsiderationIdentityFacts,
} from "@/lib/arc/ai/identity-facts";
import { run1Fixture, runBFixture } from "@/lib/arc/ai/__tests__/production-runs";
import type { FixturePromise } from "@/lib/arc/ai/__tests__/production-runs";

function promiseByKey(
  fixture: { promises: FixturePromise[] },
  semanticKey: string,
): FixturePromise {
  const found = fixture.promises.find((promise) => promise.semanticKey === semanticKey);
  if (found === undefined) throw new Error(`fixture promise not found: ${semanticKey}`);
  return found;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

const run1Validation = promiseByKey(run1Fixture, "gxp_validation_artifacts");
const runBValidation = promiseByKey(runBFixture, "promise_validation_artifact_package");
const run1Support = promiseByKey(run1Fixture, "clinical_bioinformatics_engineering_support");
const runBSupport = promiseByKey(runBFixture, "promise_bioinformatics_engineering_support");
const run1Hosted = promiseByKey(run1Fixture, "hosted_platform_access");

describe("identity facts — evidence sufficiency", () => {
  it("admits Run 1 Validation ↔ Run B Validation on resolved canonical structure, not description text", () => {
    // The independent evidence relied upon is the resolved canonical obligation the promise belongs
    // to (ARC-owned graph structure). Identical model description text is corroboration only.
    const assessment = assessIdentityEvidence(
      promiseIdentityFacts({ ...runBValidation, owningObligationCanonicalId: "po-validation" }),
      promiseIdentityFacts({ ...run1Validation, owningObligationCanonicalId: "po-validation" }),
    );

    expect(assessment.admissible).toBe(true);
    expect(assessment.codes).toContain("strong_resolved_canonical_relation");
    expect(assessment.codes).toContain("corroborating_description_equality");
    expect(assessment.codes).toContain("corroborating_page_overlap");
    expect(assessment.strongClasses).not.toContain("model_description");
    expect(assessment.contradictions).toEqual([]);
  });

  it("does not admit Run 1 Validation ↔ Run B Validation on description text alone", () => {
    const assessment = assessIdentityEvidence(
      promiseIdentityFacts(runBValidation),
      promiseIdentityFacts(run1Validation),
    );
    expect(assessment.codes).toContain("corroborating_description_equality");
    expect(assessment.strong).toEqual([]);
    expect(assessment.admissible).toBe(false);
  });

  it("keeps Support identifiable despite professional_service → support taxonomy drift", () => {
    const proposal = promiseIdentityFacts(runBSupport);
    const incumbent = promiseIdentityFacts(run1Support);
    expect(proposal.judgments["promiseType"]).toBe("support");
    // Judgment values are normalized for comparison; `professional_service` → `professional service`.
    expect(incumbent.judgments["promiseType"]).toBe("professional service");

    const assessment = assessIdentityEvidence(proposal, incumbent);
    expect(assessment.admissible).toBe(true);
    expect(assessment.codes).toContain("strong_shared_contractual_measure");
    expect(assessment.diagnostics).toContain("diagnostic_judgment_drift");
    expect(assessment.contradictions).toEqual([]);
  });

  it("does not identify anything from taxonomy equality alone", () => {
    const left = promiseIdentityFacts({
      semanticKey: "left",
      promiseType: "support",
      description: "Onsite laboratory instrument calibration visits.",
      distinctConclusion: "yes",
      citations: [],
    });
    const right = promiseIdentityFacts({
      semanticKey: "right",
      promiseType: "support",
      description: "Regulatory submission dossier authoring.",
      distinctConclusion: "yes",
      citations: [],
    });

    const assessment = assessIdentityEvidence(left, right);
    expect(assessment.strong).toEqual([]);
    expect(assessment.admissible).toBe(false);
  });

  it("does not identify different deliverables that merely share a page", () => {
    const assessment = assessIdentityEvidence(
      promiseIdentityFacts(runBSupport),
      promiseIdentityFacts(run1Validation),
    );
    expect(assessment.corroborating).toContain("corroborating_page_overlap");
    expect(assessment.strong).toEqual([]);
    expect(assessment.admissible).toBe(false);
  });

  it("treats page intersection as corroboration, never as strong evidence", () => {
    const assessment = assessIdentityEvidence(
      promiseIdentityFacts(runBValidation),
      promiseIdentityFacts(run1Hosted),
    );
    expect(assessment.strong).toEqual([]);
    expect(assessment.admissible).toBe(false);
  });

  it("corroborates usage continuity from $1.35/sample and a compatible target despite citation drift", () => {
    const run1Usage = run1Fixture.variableConsiderationComponents[0]!;
    const runBUsage = runBFixture.variableConsiderationComponents[0]!;
    expect(run1Usage.citations[0]?.normalizedExcerpt).not.toBe(
      runBUsage.citations[0]?.normalizedExcerpt,
    );

    const assessment = assessIdentityEvidence(
      variableConsiderationIdentityFacts({ ...runBUsage, targetCanonicalId: "po-hosted" }),
      variableConsiderationIdentityFacts({ ...run1Usage, targetCanonicalId: "po-hosted" }),
    );

    expect(assessment.admissible).toBe(true);
    expect(assessment.codes).toContain("strong_decisive_fact_agreement");
    expect(assessment.codes).toContain("corroborating_shared_relation");
  });

  it("flags a decisive economic-effect conflict as a hard contradiction", () => {
    const run1Usage = run1Fixture.variableConsiderationComponents[0]!;
    const assessment = assessIdentityEvidence(
      variableConsiderationIdentityFacts({
        ...run1Usage,
        type: "service_credit",
        targetCanonicalId: "po-hosted",
      }),
      variableConsiderationIdentityFacts({ ...run1Usage, targetCanonicalId: "po-hosted" }),
    );
    expect(assessment.contradictions).toContain("hard_contradiction_decisive_fact");
    expect(assessment.admissible).toBe(false);
  });

  it("is unaffected by semantic-key renaming", () => {
    const baseline = assessIdentityEvidence(
      promiseIdentityFacts(runBSupport),
      promiseIdentityFacts(run1Support),
    );
    const renamed = assessIdentityEvidence(
      promiseIdentityFacts({ ...runBSupport, semanticKey: "zzz_arbitrary_rename" }),
      promiseIdentityFacts({ ...run1Support, semanticKey: "aaa_other_rename" }),
    );
    expect(renamed.codes).toEqual(baseline.codes);
    expect(renamed.anchorSignature).toEqual(baseline.anchorSignature);
  });

  it("sources prior bounded citation evidence from the prior analysis, not canonical draft fields", () => {
    const run1Usage = run1Fixture.variableConsiderationComponents[0]!;
    const runBUsage = runBFixture.variableConsiderationComponents[0]!;

    // Canonical draft shape: no bounded AI excerpts are persisted there.
    const draftOnlyIncumbent = asIncumbent(
      variableConsiderationIdentityFacts({
        ...run1Usage,
        citations: [],
        targetCanonicalId: "po-hosted",
      }),
      "vc-usage",
    );
    expect(hasPriorSourceEvidence(draftOnlyIncumbent)).toBe(false);

    // Prior immutable AiContractAnalysis supplies the bounded excerpts.
    const priorAnalysisIncumbent = asIncumbent(
      variableConsiderationIdentityFacts({ ...run1Usage, targetCanonicalId: "po-hosted" }),
      "vc-usage",
    );
    expect(hasPriorSourceEvidence(priorAnalysisIncumbent)).toBe(true);

    const proposal = variableConsiderationIdentityFacts({
      ...runBUsage,
      targetCanonicalId: "po-hosted",
    });
    const withoutPrior = assessIdentityEvidence(proposal, draftOnlyIncumbent);
    const withPrior = assessIdentityEvidence(proposal, priorAnalysisIncumbent);

    expect(withoutPrior.codes).not.toContain("strong_excerpt_containment");
    expect(withPrior.codes).toContain("strong_excerpt_containment");
  });

  it("never mutates its inputs", () => {
    const left = deepFreeze(promiseIdentityFacts(runBValidation));
    const right = deepFreeze(promiseIdentityFacts(run1Validation));
    const before = JSON.stringify([left, right]);
    assessIdentityEvidence(left, right);
    expect(JSON.stringify([left, right])).toBe(before);
  });
});

/* ------------------------------------------------------------------ Patch A */

describe("identity facts — source evidence cannot corroborate itself", () => {
  const sharedExcerpt =
    "5.4 deliverables: provider shall perform the services described in the applicable statement of work.";
  const citation = {
    documentId: "71a48e73-7496-44c8-b611-2dca9d3ed256",
    pageStart: 5,
    pageEnd: 5,
    normalizedExcerpt: sharedExcerpt,
  };

  const left = promiseIdentityFacts({
    semanticKey: "left_deliverable",
    promiseType: "support",
    description: "Onsite instrument calibration visits.",
    distinctConclusion: "yes",
    citations: [citation],
  });
  const right = promiseIdentityFacts({
    semanticKey: "right_deliverable",
    promiseType: "support",
    description: "Regulatory dossier authoring.",
    distinctConclusion: "yes",
    citations: [citation],
  });

  it("refuses identity when the only strong evidence is source and page overlap is its own citation", () => {
    const assessment = assessIdentityEvidence(left, right);
    expect(assessment.codes).toContain("strong_excerpt_equality");
    expect(assessment.codes).toContain("corroborating_page_overlap");
    expect(assessment.strongClasses).toEqual(["source"]);
    expect(assessment.admissible).toBe(false);
  });

  it("admits exact excerpt equality plus a compatible objective contractual measure", () => {
    const a = promiseIdentityFacts({
      semanticKey: "support_a",
      promiseType: "support",
      description: "Dedicated engineering support, 40 hours annually.",
      distinctConclusion: "yes",
      citations: [citation],
    });
    const b = promiseIdentityFacts({
      semanticKey: "support_b",
      promiseType: "professional_service",
      description: "Bioinformatics engineering support hours: 40 hours per year.",
      distinctConclusion: "yes",
      citations: [citation],
    });
    const assessment = assessIdentityEvidence(a, b);
    expect(assessment.codes).toContain("strong_shared_contractual_measure");
    expect(assessment.admissible).toBe(true);
  });

  it("admits exact source evidence plus a resolved canonical graph relationship", () => {
    const a = variableConsiderationIdentityFacts({
      semanticKey: "vc_a",
      type: "usage",
      description: "Overage charge.",
      citations: [citation],
      targetCanonicalId: "po-hosted",
    });
    const b = variableConsiderationIdentityFacts({
      semanticKey: "vc_b",
      type: "usage",
      description: "Throughput overage billing.",
      citations: [citation],
      targetCanonicalId: "po-hosted",
    });
    const assessment = assessIdentityEvidence(a, b);
    expect(assessment.codes).toContain("corroborating_shared_relation");
    expect(assessment.admissible).toBe(true);
  });
});

/* ------------------------------------------------------------------ Patch B */

describe("identity facts — objective variable-consideration and billing taxonomy", () => {
  const citation = {
    documentId: "71a48e73-7496-44c8-b611-2dca9d3ed256",
    pageStart: 3,
    pageEnd: 3,
    normalizedExcerpt:
      "1. specimen tier overtaking: tier 2 overage billed quarterly at $1.35/sample.",
  };

  it("treats usage vs service_credit as a hard economic incompatibility", () => {
    const usage = variableConsiderationIdentityFacts({
      semanticKey: "vc_usage",
      type: "usage",
      description: "Per-sample overage.",
      contractualRateOrAmountInput: "1.35",
      targetCanonicalId: "po-hosted",
      citations: [citation],
    });
    const credit = variableConsiderationIdentityFacts({
      semanticKey: "vc_credit",
      type: "service_credit",
      description: "Per-sample overage.",
      contractualRateOrAmountInput: "1.35",
      targetCanonicalId: "po-hosted",
      citations: [citation],
    });
    const assessment = assessIdentityEvidence(usage, credit);
    expect(assessment.contradictions).toContain("hard_contradiction_decisive_fact");
    expect(assessment.admissible).toBe(false);
  });

  it("does not disqualify a billing schedule because the amount changed", () => {
    const base = {
      semanticKey: "fixed_annual_advance_billing",
      description: "Fixed annual contract value billed annually in advance.",
      frequency: "annual",
      billingTiming: "advance",
      paymentTermsDays: 30,
      citations: [citation],
    } as const;
    const assessment = assessIdentityEvidence(
      billingTermIdentityFacts({ ...base, amountOrRateInput: "245000" }),
      billingTermIdentityFacts({ ...base, amountOrRateInput: "250000" }),
    );
    expect(assessment.contradictions).toEqual([]);
    expect(assessment.admissible).toBe(true);
  });

  it("treats a billing timing / frequency change as a hard contradiction", () => {
    const base = {
      semanticKey: "fixed_billing",
      description: "Fixed contract value billed under the order-form schedule.",
      paymentTermsDays: 30,
      amountOrRateInput: "245000",
      citations: [citation],
    } as const;
    const assessment = assessIdentityEvidence(
      billingTermIdentityFacts({ ...base, frequency: "annual", billingTiming: "advance" }),
      billingTermIdentityFacts({ ...base, frequency: "monthly", billingTiming: "arrears" }),
    );
    expect(assessment.contradictions).toContain("hard_contradiction_decisive_fact");
    expect(assessment.admissible).toBe(false);
  });
});
