/**
 * Phase 9G-R3 — deterministic re-analysis identity reconciliation.
 *
 * A model `semanticKey` is a model-local alias, not canonical economic
 * identity: two independent runs of the same contract routinely rename their
 * own keys. ARC owns canonical identity, so before minting a new canonical
 * object for a key it has never seen, the merge asks this module whether the
 * proposal is in fact an existing canonical object under a new alias.
 *
 * The algorithm is deliberately fail-closed:
 *
 *   - identity is compared on ordered TIERS of objective structured facts;
 *   - a tier match is only accepted when the pairing is MUTUALLY unique — the
 *     proposal has exactly one candidate and that candidate is claimed by
 *     exactly one proposal;
 *   - unresolved pairings move to the next, narrower tier;
 *   - anything still contested at the end is `ambiguous` and is never
 *     resolved by picking a first candidate;
 *   - a proposal with no candidate at all is `none`, i.e. a genuinely new
 *     economic object the merge may create.
 *
 * Pure: no clock, no randomness, no I/O. Ordering of the inputs never changes
 * the outcome.
 */

import type { AiCitation } from "./schema";

export interface IdentityCandidate {
  /** The semantic key that owned this canonical object on the previous run. */
  semanticKey: string;
  canonicalId: string;
  tiers: readonly string[];
}

export interface IdentityProposal {
  semanticKey: string;
  tiers: readonly string[];
}

export type IdentityOutcome =
  | { status: "matched"; canonicalId: string; previousSemanticKey: string }
  | { status: "ambiguous" }
  | { status: "none" };

/* ------------------------------------------------------- identity signals */

function normalizedText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Stable source/evidence identity: the exact document pages the conclusion was
 * drawn from, order-independent. Excerpt prose is deliberately excluded — it
 * is model wording, not an objective contractual fact.
 */
export function evidenceSignature(citations: readonly AiCitation[]): string {
  return [...citations]
    .map((citation) => `${citation.documentId}#${citation.pageStart}-${citation.pageEnd}`)
    .sort()
    .join("|");
}

/**
 * Promise identity. Type first (an objective structured fact), then the
 * evidence it rests on, then — only as a tie-breaker between candidates that
 * are otherwise indistinguishable — the description text.
 */
export function promiseIdentityTiers(input: {
  promiseType: string;
  citations: readonly AiCitation[];
  description: string;
}): readonly string[] {
  return [
    `promise|${input.promiseType}`,
    `evidence|${evidenceSignature(input.citations)}`,
    `text|${normalizedText(input.description)}`,
  ];
}

/** Performance-obligation identity: the satisfaction structure it asserts. */
export function poIdentityTiers(input: { satisfactionPattern: string }): readonly string[] {
  return [`po|${input.satisfactionPattern}`];
}

/**
 * Variable-consideration identity. The economic effect and the canonical
 * performance obligation it attaches to come first, then the evidence, then
 * the contractual rate. A shared component TYPE alone never identifies a
 * component.
 */
export function vcIdentityTiers(input: {
  type: string;
  effect: string;
  targetCanonicalId: string | null;
  citations: readonly AiCitation[];
  rateInput: string | null;
  unitDescription: string | null;
}): readonly string[] {
  return [
    `vc|${input.type}|${input.effect}|${input.targetCanonicalId ?? "unallocated"}`,
    `evidence|${evidenceSignature(input.citations)}`,
    `terms|${input.rateInput ?? ""}|${normalizedText(input.unitDescription ?? "")}`,
  ];
}

/* ------------------------------------------------------------- algorithm */

function prefix(tiers: readonly string[], depth: number): string {
  return tiers.slice(0, depth).join("\u0000");
}

/**
 * Resolves each proposal to an existing canonical object, a genuinely new
 * object, or an ambiguity that must be reviewed rather than guessed.
 *
 * `restrict` optionally narrows the candidate set for a proposal by a
 * structural rule the tiers cannot express (performance obligations use it to
 * require overlapping canonical promise membership).
 */
export function reconcileByTieredIdentity(
  proposals: readonly IdentityProposal[],
  candidates: readonly IdentityCandidate[],
  restrict?: (proposal: IdentityProposal, candidate: IdentityCandidate) => boolean,
): Map<string, IdentityOutcome> {
  const result = new Map<string, IdentityOutcome>();
  const openCandidates = [...candidates];
  let openProposals = [...proposals];

  const admissible = (proposal: IdentityProposal, candidate: IdentityCandidate): boolean =>
    restrict === undefined || restrict(proposal, candidate);

  const maxTier = Math.max(
    0,
    ...proposals.map((proposal) => proposal.tiers.length),
    ...candidates.map((candidate) => candidate.tiers.length),
  );

  for (let depth = 1; depth <= maxTier && openProposals.length > 0; depth += 1) {
    const links = new Map<string, IdentityCandidate[]>();
    for (const proposal of openProposals) {
      if (proposal.tiers.length < depth) {
        links.set(proposal.semanticKey, []);
        continue;
      }
      links.set(
        proposal.semanticKey,
        openCandidates.filter(
          (candidate) =>
            candidate.tiers.length >= depth &&
            prefix(candidate.tiers, depth) === prefix(proposal.tiers, depth) &&
            admissible(proposal, candidate),
        ),
      );
    }

    const claims = new Map<string, number>();
    for (const list of links.values()) {
      for (const candidate of list) {
        claims.set(candidate.semanticKey, (claims.get(candidate.semanticKey) ?? 0) + 1);
      }
    }

    const settled = new Set<string>();
    for (const [semanticKey, list] of links) {
      const only = list.length === 1 ? list[0]! : null;
      if (only === null || claims.get(only.semanticKey) !== 1) continue;
      result.set(semanticKey, {
        status: "matched",
        canonicalId: only.canonicalId,
        previousSemanticKey: only.semanticKey,
      });
      settled.add(semanticKey);
      openCandidates.splice(openCandidates.indexOf(only), 1);
    }
    openProposals = openProposals.filter((proposal) => !settled.has(proposal.semanticKey));
  }

  // Whatever is left either had no candidate at all (a genuinely new object)
  // or could not be told apart from more than one incumbent (fail closed).
  for (const proposal of openProposals) {
    const remaining = openCandidates.filter(
      (candidate) =>
        candidate.tiers.length >= 1 &&
        proposal.tiers.length >= 1 &&
        prefix(candidate.tiers, 1) === prefix(proposal.tiers, 1) &&
        admissible(proposal, candidate),
    );
    result.set(
      proposal.semanticKey,
      remaining.length === 0 ? { status: "none" } : { status: "ambiguous" },
    );
  }

  return result;
}
