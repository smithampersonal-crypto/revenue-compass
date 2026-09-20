/**
 * Phase 9G-R3 — deterministic re-analysis identity reconciliation.
 *
 * A model `semanticKey` is a model-local alias, not canonical economic
 * identity: two independent runs of the same contract routinely rename their
 * own keys. ARC owns canonical identity, so before minting a new canonical
 * object for a key it has never seen, the merge asks this module whether the
 * proposal is in fact an existing canonical object under a new alias.
 *
 * Identity has two deliberately separated parts:
 *
 *   - a GATE: a broad compatibility fact (promise type, satisfaction pattern,
 *     variable-consideration type/effect/target). A gate is NEVER sufficient
 *     identity on its own — two entirely different support promises share it.
 *   - ordered CORROBORATORS: stable economic facts that actually identify the
 *     object. The FIRST corroborator both sides can supply is decisive: if the
 *     two sides disagree there, they are different economic objects, and the
 *     weaker corroborators below it are never consulted to rescue the match.
 *     Description prose is always the weakest and is only reached when no
 *     evidence is available on one of the two sides.
 *
 * The algorithm is fail-closed:
 *
 *   - a match is only accepted when the pairing is MUTUALLY unique — the
 *     proposal identifies exactly one incumbent and that incumbent is
 *     identified by exactly one proposal;
 *   - anything contested is `ambiguous`, and the caller must refuse to act on
 *     it rather than guess;
 *   - a proposal that identifies no incumbent at all is `none`, i.e. a
 *     genuinely new economic object the merge may create.
 *
 * Pure: no clock, no randomness, no I/O. Ordering of the inputs never changes
 * the outcome.
 */

import type { AiCitation } from "./schema";

/** The canonical object kinds that participate in re-identification. */
export type AiIdentityKind = "promise" | "performance_obligation" | "variable_component";

/**
 * The single deterministic mapping from a canonical ID to the R3 identity kind
 * it belongs to. Canonical objects OUTSIDE this map (contract modifications,
 * billing events, cash receipts) never carry an identity signature and must
 * never be treated as unidentified R3 incumbents.
 */
export const IDENTITY_KIND_CANONICAL_PREFIX: Readonly<Record<AiIdentityKind, string>> = {
  promise: "pr-",
  performance_obligation: "po-",
  variable_component: "vc-",
};

export function identityKindOfCanonicalId(canonicalId: string): AiIdentityKind | null {
  for (const [kind, prefix] of Object.entries(IDENTITY_KIND_CANONICAL_PREFIX)) {
    if (canonicalId.startsWith(prefix)) return kind as AiIdentityKind;
  }
  return null;
}

export interface IdentitySignature {
  /** Broad compatibility. Necessary, never sufficient. */
  gate: string;
  /**
   * Ordered identifying facts, strongest first. `null` means this side cannot
   * supply the fact at all, so it is skipped rather than treated as a value.
   */
  corroborators: readonly (string | null)[];
}

export interface IdentityCandidate {
  /** The semantic key that owned this canonical object on the previous run. */
  semanticKey: string;
  canonicalId: string;
  signature: IdentitySignature;
}

export interface IdentityProposal {
  semanticKey: string;
  signature: IdentitySignature;
}

export type IdentityOutcome =
  | { status: "matched"; canonicalId: string; previousSemanticKey: string }
  | { status: "ambiguous" }
  | { status: "none" };

export interface IdentityRules {
  /**
   * A hard structural requirement the signature cannot express (performance
   * obligations require overlapping canonical promise membership). A candidate
   * that fails it is not a candidate at all.
   */
  admissible?: (proposal: IdentityProposal, candidate: IdentityCandidate) => boolean;
  /**
   * Structural corroboration that stands in for the signature corroborators
   * (again: canonical promise membership for performance obligations).
   */
  sufficient?: (proposal: IdentityProposal, candidate: IdentityCandidate) => boolean;
}

/* ------------------------------------------------------- identity signals */

function normalizedText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Stable source/evidence identity: the exact document pages the conclusion was
 * drawn from, order-independent. Excerpt prose is deliberately excluded — it
 * is model wording, not an objective contractual fact. `null` when the
 * proposal carries no evidence at all, which is an absence, not a value.
 */
export function evidenceSignature(citations: readonly AiCitation[]): string | null {
  if (citations.length === 0) return null;
  return [...citations]
    .map((citation) => `${citation.documentId}#${citation.pageStart}-${citation.pageEnd}`)
    .sort()
    .join("|");
}

function textSignature(value: string | null | undefined): string | null {
  const text = normalizedText(value ?? "");
  return text === "" ? null : text;
}

/**
 * Promise identity. The promise TYPE only gates compatibility; the source
 * evidence identifies the promise, and its description is consulted only when
 * one of the two sides has no evidence at all.
 */
export function promiseIdentity(input: {
  promiseType: string;
  citations: readonly AiCitation[];
  description: string;
}): IdentitySignature {
  return {
    gate: `promise|${input.promiseType}`,
    corroborators: [evidenceSignature(input.citations), textSignature(input.description)],
  };
}

/**
 * Performance-obligation identity. The satisfaction structure only gates
 * compatibility: canonical promise membership is the principal identity and is
 * supplied by the caller as a structural rule. Evidence corroborates a
 * grouping whose membership can no longer be read (a deleted obligation).
 */
export function poIdentity(input: {
  satisfactionPattern: string;
  citations: readonly AiCitation[];
}): IdentitySignature {
  return {
    gate: `po|${input.satisfactionPattern}`,
    corroborators: [evidenceSignature(input.citations)],
  };
}

/**
 * Variable-consideration identity. Economic type, effect and the canonical
 * performance obligation it attaches to gate compatibility only — a second
 * usage component on the same obligation is perfectly ordinary. Source
 * evidence identifies the component, and the contractual terms corroborate it
 * when evidence is unavailable.
 */
export function vcIdentity(input: {
  type: string;
  effect: string;
  targetCanonicalId: string | null;
  citations: readonly AiCitation[];
  rateInput: string | null;
  unitDescription: string | null;
}): IdentitySignature {
  const terms = textSignature(
    `${input.rateInput ?? ""}|${input.unitDescription ?? ""}`.replace(/^\|$/, ""),
  );
  return {
    gate: `vc|${input.type}|${input.effect}|${input.targetCanonicalId ?? "unallocated"}`,
    corroborators: [evidenceSignature(input.citations), terms],
  };
}

/* ------------------------------------------------------------- algorithm */

/**
 * True when two signatures identify the SAME economic object: the gate agrees
 * and the first corroborator both sides can supply agrees. A disagreement
 * there is decisive — weaker corroborators never overturn it — and two
 * signatures with no shared corroborator identify nothing.
 */
export function signaturesIdentify(left: IdentitySignature, right: IdentitySignature): boolean {
  if (left.gate !== right.gate) return false;
  const depth = Math.max(left.corroborators.length, right.corroborators.length);
  for (let index = 0; index < depth; index += 1) {
    const a = left.corroborators[index] ?? null;
    const b = right.corroborators[index] ?? null;
    if (a === null || b === null) continue;
    return a === b;
  }
  return false;
}

/**
 * Resolves each proposal to an existing canonical object, a genuinely new
 * object, or an ambiguity that must be reviewed rather than guessed.
 */
export function reconcileByIdentity(
  proposals: readonly IdentityProposal[],
  candidates: readonly IdentityCandidate[],
  rules: IdentityRules = {},
): Map<string, IdentityOutcome> {
  const identifies = (proposal: IdentityProposal, candidate: IdentityCandidate): boolean => {
    if (proposal.signature.gate !== candidate.signature.gate) return false;
    if (rules.admissible !== undefined && !rules.admissible(proposal, candidate)) return false;
    if (rules.sufficient !== undefined && rules.sufficient(proposal, candidate)) return true;
    return signaturesIdentify(proposal.signature, candidate.signature);
  };

  const links = new Map<string, IdentityCandidate[]>();
  for (const proposal of proposals) {
    links.set(
      proposal.semanticKey,
      candidates.filter((candidate) => identifies(proposal, candidate)),
    );
  }

  const claims = new Map<string, number>();
  for (const list of links.values()) {
    for (const candidate of list) {
      claims.set(candidate.semanticKey, (claims.get(candidate.semanticKey) ?? 0) + 1);
    }
  }

  const result = new Map<string, IdentityOutcome>();
  for (const [semanticKey, list] of links) {
    const only = list.length === 1 ? list[0]! : null;
    if (only !== null && claims.get(only.semanticKey) === 1) {
      result.set(semanticKey, {
        status: "matched",
        canonicalId: only.canonicalId,
        previousSemanticKey: only.semanticKey,
      });
      continue;
    }
    result.set(semanticKey, list.length === 0 ? { status: "none" } : { status: "ambiguous" });
  }
  return result;
}
