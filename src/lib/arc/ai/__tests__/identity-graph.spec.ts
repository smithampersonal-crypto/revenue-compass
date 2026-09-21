/**
 * Tranche 2 (RED first) — candidate graph construction and deterministic topology resolution.
 *
 * The engine returns topology only: no canonical object is minted, deleted, merged, split or
 * field-updated here. Review items remain Tranche 4.
 */

import { describe, expect, it } from "vitest";

import { asIncumbent, promiseIdentityFacts } from "@/lib/arc/ai/identity-facts";
import type { IncumbentIdentityFacts } from "@/lib/arc/ai/identity-facts";
import {
  buildCandidateGraph,
  canonicalGroupDecompositionRules,
  resolveIdentityGraph,
} from "@/lib/arc/ai/identity-graph";
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

const CANONICAL_IDS: Record<string, string> = {
  hosted_platform_access: "pr-hosted",
  included_throughput_capacity: "pr-throughput",
  gxp_validation_artifacts: "pr-validation",
  clinical_bioinformatics_engineering_support: "pr-support",
};

const run1Incumbents: IncumbentIdentityFacts[] = run1Fixture.promises.map((promise) =>
  asIncumbent(promiseIdentityFacts(promise), CANONICAL_IDS[promise.semanticKey]!),
);
const runBProposals = runBFixture.promises.map((promise) => promiseIdentityFacts(promise));

/** Canonical PO membership of the Run-1 canonical promises (structural group facts, not naming). */
const RUN1_PROMISE_PO: Record<string, string> = {
  "pr-hosted": "po-hosted",
  "pr-throughput": "po-hosted",
  "pr-validation": "po-validation",
  "pr-support": "po-support",
};

const run1GroupRules = canonicalGroupDecompositionRules({
  incumbentGroupKeyById: RUN1_PROMISE_PO,
});

function alignmentFor(
  result: ReturnType<typeof resolveIdentityGraph>,
  proposalKey: string,
): { relation: string; canonicalIds: readonly string[] } {
  const found = result.alignments.find((alignment) => alignment.proposalKey === proposalKey);
  if (found === undefined) throw new Error(`no alignment for ${proposalKey}`);
  return { relation: found.relation, canonicalIds: found.canonicalIds };
}

describe("identity graph — production Run 1 → Run B", () => {
  const result = resolveIdentityGraph({
    objectKind: "promise",
    proposals: runBProposals,
    incumbents: run1Incumbents,
    decompositionRules: run1GroupRules,
  });

  it("resolves the combined hosted + included-throughput proposal as one subsumes relation", () => {
    const hosted = alignmentFor(result, "promise_hosted_platform_and_included_throughput");
    expect(hosted.relation).toBe("subsumes");
    expect([...hosted.canonicalIds].sort()).toEqual(["pr-hosted", "pr-throughput"]);
  });

  it("resolves validation and support as 1:1 exact matches", () => {
    expect(alignmentFor(result, "promise_validation_artifact_package")).toEqual({
      relation: "exact",
      canonicalIds: ["pr-validation"],
    });
    expect(alignmentFor(result, "promise_bioinformatics_engineering_support")).toEqual({
      relation: "exact",
      canonicalIds: ["pr-support"],
    });
  });

  it("reports no omitted incumbents, because decomposition covers both canonical promises", () => {
    expect(result.omittedCanonicalIds).toEqual([]);
  });

  it("enforces the frozen relation cardinalities", () => {
    for (const alignment of result.alignments) {
      if (alignment.relation === "exact") expect(alignment.canonicalIds).toHaveLength(1);
      if (alignment.relation === "split_from") expect(alignment.canonicalIds).toHaveLength(1);
      if (alignment.relation === "subsumes")
        expect(alignment.canonicalIds.length).toBeGreaterThanOrEqual(2);
      if (alignment.relation === "unmatched") expect(alignment.canonicalIds).toHaveLength(0);
    }
  });

  it("reports only that some incumbent carries a prior bounded excerpt", () => {
    expect(result.hasAnyPriorBoundedExcerpt).toBe(true);
    expect("priorEvidenceAvailable" in result).toBe(false);
  });

  it("is unaffected by semantic-key names and by input ordering", () => {
    const permuted = resolveIdentityGraph({
      objectKind: "promise",
      proposals: [...runBProposals].reverse(),
      incumbents: [...run1Incumbents].reverse(),
      decompositionRules: run1GroupRules,
    });
    expect(JSON.stringify(permuted.alignments)).toBe(JSON.stringify(result.alignments));

    const renamed = resolveIdentityGraph({
      objectKind: "promise",
      proposals: runBFixture.promises.map((promise, index) =>
        promiseIdentityFacts({ ...promise, semanticKey: `renamed_${index}` }),
      ),
      incumbents: run1Incumbents,
      decompositionRules: run1GroupRules,
    });
    expect(renamed.alignments.map((alignment) => [...alignment.canonicalIds].sort())).toEqual(
      runBProposals.map((proposal) => [...alignmentFor(result, proposal.ref).canonicalIds].sort()),
    );
  });

  it("never mutates its inputs", () => {
    const proposals = deepFreeze(runBFixture.promises.map((p) => promiseIdentityFacts(p)));
    const incumbents = deepFreeze(
      run1Fixture.promises.map((p) =>
        asIncumbent(promiseIdentityFacts(p), CANONICAL_IDS[p.semanticKey]!),
      ),
    );
    const before = JSON.stringify([proposals, incumbents]);
    resolveIdentityGraph({
      objectKind: "promise",
      proposals,
      incumbents,
      decompositionRules: run1GroupRules,
    });
    expect(JSON.stringify([proposals, incumbents])).toBe(before);
  });
});

describe("identity graph — decomposition, contention and absence", () => {
  it("resolves N proposals against one incumbent as split_from without splitting it", () => {
    const incumbents = runBFixture.promises.map((promise) =>
      asIncumbent(promiseIdentityFacts(promise), `pr-b-${promise.semanticKey}`),
    );
    const result = resolveIdentityGraph({
      objectKind: "promise",
      proposals: run1Fixture.promises.map((promise) => promiseIdentityFacts(promise)),
      incumbents,
      decompositionRules: canonicalGroupDecompositionRules({
        proposalGroupKeyByRef: {
          hosted_platform_access: "po-hosted",
          included_throughput_capacity: "po-hosted",
          gxp_validation_artifacts: "po-validation",
          clinical_bioinformatics_engineering_support: "po-support",
        },
      }),
    });

    const hosted = alignmentFor(result, "hosted_platform_access");
    const throughput = alignmentFor(result, "included_throughput_capacity");
    expect(hosted.relation).toBe("split_from");
    expect(throughput.relation).toBe("split_from");
    expect(hosted.canonicalIds).toEqual(["pr-b-promise_hosted_platform_and_included_throughput"]);
    expect(throughput.canonicalIds).toEqual([
      "pr-b-promise_hosted_platform_and_included_throughput",
    ]);
  });

  it("marks two indistinguishable proposals contending for one incumbent as ambiguous", () => {
    const incumbent = asIncumbent(promiseIdentityFacts(run1Fixture.promises[3]!), "pr-support");
    const duplicateA = promiseIdentityFacts({
      ...run1Fixture.promises[3]!,
      semanticKey: "support_a",
    });
    const duplicateB = promiseIdentityFacts({
      ...run1Fixture.promises[3]!,
      semanticKey: "support_b",
    });

    const result = resolveIdentityGraph({
      objectKind: "promise",
      proposals: [duplicateA, duplicateB],
      incumbents: [incumbent],
    });

    for (const key of ["support_a", "support_b"]) {
      const alignment = result.alignments.find((a) => a.proposalKey === key)!;
      expect(alignment.relation).toBe("ambiguous");
      expect(alignment.canonicalIds).toEqual([]);
      expect(alignment.diagnostics?.contendingCanonicalIds).toEqual(["pr-support"]);
    }
  });

  it("refuses a false subsumption over two indistinguishable incumbents", () => {
    const base = run1Fixture.promises[2]!;
    const incumbents = [
      asIncumbent(promiseIdentityFacts({ ...base, semanticKey: "v1" }), "pr-v1"),
      asIncumbent(promiseIdentityFacts({ ...base, semanticKey: "v2" }), "pr-v2"),
    ];
    const result = resolveIdentityGraph({
      objectKind: "promise",
      proposals: [promiseIdentityFacts({ ...base, semanticKey: "combined" })],
      incumbents,
    });

    const alignment = result.alignments[0]!;
    expect(alignment.relation).toBe("ambiguous");
    expect(alignment.canonicalIds).toEqual([]);
    expect([...(alignment.diagnostics?.contendingCanonicalIds ?? [])].sort()).toEqual([
      "pr-v1",
      "pr-v2",
    ]);
  });

  it("marks a fabricated extra proposal unmatched and never mints identity for it", () => {
    const fabricated = promiseIdentityFacts({
      semanticKey: "promise_fabricated_training_workshop",
      promiseType: "professional_service",
      description: "Two-day onsite operator training workshop for laboratory technicians.",
      distinctConclusion: "yes",
      citations: [{ documentId: "71a48e73-7496-44c8-b611-2dca9d3ed256", pageStart: 2, pageEnd: 2 }],
    });
    const result = resolveIdentityGraph({
      objectKind: "promise",
      proposals: [...runBProposals, fabricated],
      incumbents: run1Incumbents,
      decompositionRules: run1GroupRules,
    });

    expect(alignmentFor(result, "promise_fabricated_training_workshop")).toEqual({
      relation: "unmatched",
      canonicalIds: [],
    });
  });

  it("reports incumbents that no proposal represents", () => {
    const orphan = asIncumbent(
      promiseIdentityFacts({
        semanticKey: "data_migration",
        promiseType: "implementation",
        description: "One-time historical variant data migration of 12 terabytes.",
        distinctConclusion: "yes",
        citations: [{ documentId: "other-doc", pageStart: 9, pageEnd: 9 }],
      }),
      "pr-migration",
    );
    const result = resolveIdentityGraph({
      objectKind: "promise",
      proposals: runBProposals,
      incumbents: [...run1Incumbents, orphan],
      decompositionRules: run1GroupRules,
    });
    expect(result.omittedCanonicalIds).toEqual(["pr-migration"]);
  });

  it("exposes the full candidate graph before resolution", () => {
    const edges = buildCandidateGraph({
      objectKind: "promise",
      proposals: runBProposals,
      incumbents: run1Incumbents,
    });
    const hostedEdges = edges.filter(
      (edge) => edge.proposalKey === "promise_hosted_platform_and_included_throughput",
    );
    expect(hostedEdges.map((edge) => edge.canonicalId)).toEqual(["pr-hosted", "pr-throughput"]);
  });
});

/* ------------------------------------------------------------------ Patch C */

describe("identity graph — decomposition requires real group support", () => {
  it("refuses a 1:N grouping whose incumbents belong to different canonical POs", () => {
    const combined = promiseIdentityFacts({
      semanticKey: "promise_support_and_throughput_bundle",
      promiseType: "bundle",
      description:
        "Dedicated clinical bioinformatics engineering support hours, stated as 40 hours annually, together with annual capacity of up to 50,000 samples under the high-throughput whole exome/genome tier.",
      distinctConclusion: "yes",
      citations: [{ documentId: "71a48e73-7496-44c8-b611-2dca9d3ed256", pageStart: 3, pageEnd: 3 }],
    });

    const incumbents = [
      run1Incumbents.find((i) => i.canonicalId === "pr-support")!,
      run1Incumbents.find((i) => i.canonicalId === "pr-throughput")!,
    ];

    const result = resolveIdentityGraph({
      objectKind: "promise",
      proposals: [combined],
      incumbents,
      decompositionRules: run1GroupRules,
    });

    const alignment = result.alignments[0]!;
    expect(alignment.relation).toBe("ambiguous");
    expect(alignment.canonicalIds).toEqual([]);
    expect([...(alignment.diagnostics?.contendingCanonicalIds ?? [])].sort()).toEqual([
      "pr-support",
      "pr-throughput",
    ]);
  });

  it("refuses decomposition entirely when no group rules are supplied", () => {
    const result = resolveIdentityGraph({
      objectKind: "promise",
      proposals: runBProposals,
      incumbents: run1Incumbents,
    });
    expect(alignmentFor(result, "promise_hosted_platform_and_included_throughput").relation).toBe(
      "ambiguous",
    );
  });
});
