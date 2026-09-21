/**
 * Phase 9G-R3 / Phase L — Tranche 2: candidate graph construction and deterministic resolution.
 *
 * The complete proposal↔incumbent candidate graph is built BEFORE any identity is resolved. No
 * winner is ever chosen by score, array position, semantic key, timestamp, first match or equal
 * object counts. Resolution is a pure function of the graph's connected components:
 *
 *   1 proposal ↔ 1 incumbent            → exact       (mutual uniqueness)
 *   1 proposal ↔ N incumbents           → subsumes    (only when the grouping is uniquely supported)
 *   N proposals ↔ 1 incumbent           → split_from  (one alignment per proposal, same canonical id)
 *   M proposals ↔ N incumbents (M,N>1)  → ambiguous
 *   proposal with no edges              → unmatched
 *
 * A group relation (subsumes / split_from) is only accepted when BOTH hold:
 *   1. the caller's `decompositionRules` prove the group is structurally supported (e.g. the
 *      incumbents share one canonical performance obligation). Cardinality is never a proof, and
 *      naming, ordering, counts and evidence-signature distinctness are never the group proof;
 *   2. the members rest on DISTINGUISHABLE evidence anchors.
 * Otherwise the component resolves to `ambiguous`.
 *
 * This module returns TOPOLOGY ONLY. It mints, deletes, merges, splits and updates nothing, and it
 * constructs no review items (Tranche 4).
 */

import type { AlignmentObjectKind, ProposalAlignment } from "./alignment-types";
import {
  assessIdentityEvidence,
  hasPriorSourceEvidence,
  type EvidenceAssessment,
  type IdentityFacts,
  type IncumbentIdentityFacts,
} from "./identity-facts";

/**
 * Group-compatibility proof for decomposition. Cardinality plus distinguishable evidence is NOT a
 * grouping proof: the caller must state, from canonical/structural facts, that the members really
 * form one supported grouping. Absent rules, decomposition is refused (fail closed).
 */
export interface DecompositionRules {
  /** May this single proposal subsume exactly these (2+) incumbents as one grouping? */
  canSubsumes(proposalKey: string, canonicalIds: readonly string[]): boolean;
  /** Do these (2+) proposals form one supported grouping corresponding to this incumbent? */
  canSplitFrom(proposalKeys: readonly string[], canonicalId: string): boolean;
}

/**
 * Structural group rules derived from canonical grouping keys (e.g. the canonical performance
 * obligation each canonical promise belongs to). Never naming, ordering or counting.
 */
export function canonicalGroupDecompositionRules(options: {
  incumbentGroupKeyById?: Readonly<Record<string, string>> | undefined;
  proposalGroupKeyByRef?: Readonly<Record<string, string>> | undefined;
}): DecompositionRules {
  const sameGroup = (
    keys: readonly string[],
    lookup: Readonly<Record<string, string>> | undefined,
  ): boolean => {
    if (lookup === undefined) return false;
    const groups = keys.map((key) => lookup[key]);
    if (groups.some((group) => group === undefined)) return false;
    return new Set(groups).size === 1;
  };

  return {
    canSubsumes: (_proposalKey, canonicalIds) =>
      sameGroup(canonicalIds, options.incumbentGroupKeyById),
    canSplitFrom: (proposalKeys, canonicalId) => {
      if (!sameGroup(proposalKeys, options.proposalGroupKeyByRef)) return false;
      const incumbentGroup = options.incumbentGroupKeyById?.[canonicalId];
      if (incumbentGroup === undefined) return true;
      return options.proposalGroupKeyByRef?.[proposalKeys[0]!] === incumbentGroup;
    },
  };
}

export interface IdentityGraphInput {
  objectKind: AlignmentObjectKind;
  proposals: readonly IdentityFacts[];
  incumbents: readonly IncumbentIdentityFacts[];
  /** Required for any 1:N or N:1 relation. Omitted ⇒ decomposition is refused. */
  decompositionRules?: DecompositionRules | undefined;
}

export interface CandidateEdge {
  proposalKey: string;
  canonicalId: string;
  evidence: EvidenceAssessment;
}

export interface IdentityGraphResult {
  /** One alignment per proposal, ordered by proposal key. Ephemeral: never persisted. */
  alignments: readonly ProposalAlignment[];
  /** The complete admissible candidate graph, for diagnostics and later review construction. */
  edges: readonly CandidateEdge[];
  /** Incumbents no proposal represents. Reported only — nothing is ever auto-deleted. */
  omittedCanonicalIds: readonly string[];
  /**
   * Narrow diagnostic: at least one incumbent fact set carries a prior bounded excerpt. This does
   * NOT assert that the prior immutable analysis was loaded and parsed — only the trusted caller
   * knows that, and Tranche 3 must fail closed on its own explicit load/parse state.
   */
  hasAnyPriorBoundedExcerpt: boolean;
}

/** Builds every admissible proposal↔incumbent edge, in a deterministic, input-order-free order. */
export function buildCandidateGraph(input: IdentityGraphInput): CandidateEdge[] {
  const proposals = [...input.proposals].sort((a, b) => a.ref.localeCompare(b.ref));
  const incumbents = [...input.incumbents].sort((a, b) =>
    a.canonicalId.localeCompare(b.canonicalId),
  );

  const edges: CandidateEdge[] = [];
  for (const proposal of proposals) {
    for (const incumbent of incumbents) {
      const evidence = assessIdentityEvidence(proposal, incumbent);
      if (!evidence.admissible) continue;
      edges.push({ proposalKey: proposal.ref, canonicalId: incumbent.canonicalId, evidence });
    }
  }
  return edges;
}

interface Component {
  proposalKeys: string[];
  canonicalIds: string[];
}

function connectedComponents(edges: readonly CandidateEdge[]): Component[] {
  const parent = new Map<string, string>();
  const find = (node: string): string => {
    const seen = parent.get(node);
    if (seen === undefined || seen === node) {
      parent.set(node, node);
      return node;
    }
    const root = find(seen);
    parent.set(node, root);
    return root;
  };
  const union = (a: string, b: string): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootA < rootB ? rootB : rootA, rootA < rootB ? rootA : rootB);
  };

  for (const edge of edges) union(`p:${edge.proposalKey}`, `c:${edge.canonicalId}`);

  const groups = new Map<string, Component>();
  for (const edge of edges) {
    const root = find(`p:${edge.proposalKey}`);
    const group = groups.get(root) ?? { proposalKeys: [], canonicalIds: [] };
    if (!group.proposalKeys.includes(edge.proposalKey)) group.proposalKeys.push(edge.proposalKey);
    if (!group.canonicalIds.includes(edge.canonicalId)) group.canonicalIds.push(edge.canonicalId);
    groups.set(root, group);
  }

  return [...groups.values()]
    .map((group) => ({
      proposalKeys: [...group.proposalKeys].sort(),
      canonicalIds: [...group.canonicalIds].sort(),
    }))
    .sort((a, b) => a.proposalKeys[0]!.localeCompare(b.proposalKeys[0]!));
}

function anchorSignatureFor(
  edges: readonly CandidateEdge[],
  proposalKey: string,
  canonicalId: string,
): string {
  return (
    edges.find((edge) => edge.proposalKey === proposalKey && edge.canonicalId === canonicalId)
      ?.evidence.anchorSignature ?? ""
  );
}

/** Group members are distinguishable when no two of them rest on identical strong evidence. */
function membersAreDistinguishable(signatures: readonly string[]): boolean {
  return new Set(signatures).size === signatures.length;
}

function evidenceCodesFor(edges: readonly CandidateEdge[], proposalKey: string): readonly string[] {
  const codes = new Set<string>();
  for (const edge of edges) {
    if (edge.proposalKey !== proposalKey) continue;
    for (const code of edge.evidence.codes) codes.add(code);
  }
  return [...codes].sort();
}

/** Resolves the candidate graph into ephemeral alignment topology. Pure and order-independent. */
export function resolveIdentityGraph(input: IdentityGraphInput): IdentityGraphResult {
  const edges = buildCandidateGraph(input);
  const components = connectedComponents(edges);
  const alignments: ProposalAlignment[] = [];
  const represented = new Set<string>();

  const push = (
    proposalKey: string,
    relation: ProposalAlignment["relation"],
    canonicalIds: readonly string[],
    contending?: readonly string[],
    note?: string,
  ): void => {
    alignments.push({
      objectKind: input.objectKind,
      proposalKey,
      canonicalIds,
      relation,
      diagnostics: {
        evidenceCodes: evidenceCodesFor(edges, proposalKey),
        ...(contending !== undefined && contending.length > 0
          ? { contendingCanonicalIds: contending }
          : {}),
        ...(note !== undefined ? { notes: [note] } : {}),
      },
    });
    for (const id of canonicalIds) represented.add(id);
  };

  for (const component of components) {
    const { proposalKeys, canonicalIds } = component;

    if (proposalKeys.length === 1 && canonicalIds.length === 1) {
      push(proposalKeys[0]!, "exact", [canonicalIds[0]!]);
      continue;
    }

    if (proposalKeys.length === 1) {
      const proposalKey = proposalKeys[0]!;
      const signatures = canonicalIds.map((id) => anchorSignatureFor(edges, proposalKey, id));
      const groupSupported =
        input.decompositionRules?.canSubsumes(proposalKey, canonicalIds) === true;
      if (groupSupported && membersAreDistinguishable(signatures)) {
        push(proposalKey, "subsumes", canonicalIds);
      } else {
        push(
          proposalKey,
          "ambiguous",
          [],
          canonicalIds,
          groupSupported
            ? "competing groupings rest on indistinguishable evidence"
            : "grouping is not structurally supported by canonical group facts",
        );
        for (const id of canonicalIds) represented.add(id);
      }
      continue;
    }

    if (canonicalIds.length === 1) {
      const canonicalId = canonicalIds[0]!;
      const signatures = proposalKeys.map((key) => anchorSignatureFor(edges, key, canonicalId));
      const groupSupported =
        input.decompositionRules?.canSplitFrom(proposalKeys, canonicalId) === true;
      if (groupSupported && membersAreDistinguishable(signatures)) {
        for (const key of proposalKeys) push(key, "split_from", [canonicalId]);
      } else {
        for (const key of proposalKeys) {
          push(
            key,
            "ambiguous",
            [],
            canonicalIds,
            groupSupported
              ? "contending proposals rest on indistinguishable evidence"
              : "proposal group is not structurally supported by canonical group facts",
          );
        }
        represented.add(canonicalId);
      }
      continue;
    }

    for (const key of proposalKeys) {
      push(key, "ambiguous", [], canonicalIds, "contested many-to-many candidate relation");
    }
    for (const id of canonicalIds) represented.add(id);
  }

  const matchedKeys = new Set(alignments.map((alignment) => alignment.proposalKey));
  for (const proposal of input.proposals) {
    if (matchedKeys.has(proposal.ref)) continue;
    push(proposal.ref, "unmatched", []);
  }

  alignments.sort((a, b) => a.proposalKey.localeCompare(b.proposalKey));

  const omittedCanonicalIds = input.incumbents
    .map((incumbent) => incumbent.canonicalId)
    .filter((id) => !represented.has(id))
    .sort();

  return {
    alignments,
    edges,
    omittedCanonicalIds,
    hasAnyPriorBoundedExcerpt: input.incumbents.some(hasPriorSourceEvidence),
  };
}
