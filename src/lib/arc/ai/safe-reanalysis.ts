/**
 * ARC v1 — Safe Re-analysis firewall.
 *
 * A pre-merge safety gate, never a structural mutation engine. It answers one
 * question: may this AI result be applied to canonical accounting structure at
 * all? When the answer is anything other than a clean, mutually unique exact
 * continuity, ARC declines structural application and the accountant's existing
 * analysis is preserved byte-for-byte.
 *
 * Invariants:
 *   - nothing here mints, deletes, merges, splits or re-parents anything;
 *   - `subsumes` / `split_from` are diagnostic topology, never permission;
 *   - `ambiguous` / `unmatched` / an omitted incumbent all decline;
 *   - a changed document source never enters reconciliation at all;
 *   - the prior immutable structured result is REQUIRED for a same-source
 *     re-analysis; if the trusted layer could not load or parse it, we fail
 *     closed rather than fall back to semantic keys, descriptions or the
 *     mutable sidecar;
 *   - a canonical relation is graph evidence only when it was resolved
 *     INDEPENDENTLY of the identity currently under test (no circularity).
 *
 * Pure: no I/O, no clock, no randomness, no persistence. Alignments computed
 * here are ephemeral and are never written anywhere.
 */

import type { WorkflowDraft } from "@/lib/asc606-workflow/types";

import type { AlignmentObjectKind, CitationSpan } from "./alignment-types";
import {
  assessIdentityEvidence,
  asIncumbent,
  billingTermIdentityFacts,
  buildIdentityFacts,
  promiseIdentityFacts,
  variableConsiderationIdentityFacts,
  type IdentityFacts,
  type IncumbentIdentityFacts,
} from "./identity-facts";
import { canonicalGroupDecompositionRules, resolveIdentityGraph } from "./identity-graph";
import type { AiAnalysisState } from "./merge";
import { parseBillingEventSemanticKey } from "./billing-identity";
import type { AiCitation, AiContractAnalysis } from "./schema";

/* ------------------------------------------------------------------ types */

export type SafeReanalysisDeclineReason =
  /** The analyzed document set is not the one the current analysis rests on. */
  | "source_changed"
  /** The required prior immutable structured result was missing or malformed. */
  | "prior_analysis_unavailable"
  /** No AI baseline exists, but canonical structure the accountant owns does. */
  | "unestablished_baseline"
  /** The new run recomposed or decomposed canonical objects. */
  | "decomposition"
  /** Two or more candidates contend for the same canonical object. */
  | "ambiguous"
  /** A proposal corresponds to no existing canonical object. */
  | "unmatched"
  /** An existing canonical object is represented by no proposal. */
  | "omitted_incumbent"
  /**
   * Economic continuity holds, but the UNCHANGED production merge would not be
   * guaranteed to route this proposal to the same canonical object (a renamed
   * or re-pointed semantic key). ARC declines rather than risk minting.
   */
  | "routing_unverified";


export interface SafeReanalysisDecision {
  outcome: "first_run" | "apply" | "decline";
  reason?: SafeReanalysisDeclineReason;
  /** Which canonical family produced the decline. Diagnostic only. */
  objectKind?: AlignmentObjectKind;
}

export type PriorAnalysisLoad = "not_required" | "loaded" | "unavailable";

export interface SafeReanalysisInput {
  /** The structured result of the run being applied. */
  analysis: AiContractAnalysis;
  /** The immutable structured result of the last SAFELY APPLIED run. */
  priorAnalysis: AiContractAnalysis | null;
  /**
   * Explicit trusted-layer load state. Only the integration layer knows whether
   * the immutable prior result was actually read and parsed; the pure gate must
   * never infer it. When omitted it is derived conservatively.
   */
  priorAnalysisLoad?: PriorAnalysisLoad | undefined;
  currentDraft: WorkflowDraft;
  currentAiState: AiAnalysisState;
  /** Fingerprint of the document set this run actually analyzed. */
  currentSourceSetFingerprint: string;
}

/* ---------------------------------------------------------------- helpers */

function spansOf(citations: readonly AiCitation[] | undefined): CitationSpan[] {
  return (citations ?? []).map((citation) => ({
    documentId: citation.documentId,
    pageStart: citation.pageStart,
    pageEnd: citation.pageEnd,
    ...(citation.excerpt ? { normalizedExcerpt: citation.excerpt } : {}),
  }));
}

/**
 * Canonical id ARC recorded for a model semantic key, including earlier aliases
 * of the same canonical object. Trusted ARC-owned provenance only.
 */
function canonicalIdFor(state: AiAnalysisState, semanticKey: string): string | null {
  const direct = state.objectProvenance[semanticKey];
  if (direct !== undefined) return direct.canonicalId;
  for (const provenance of Object.values(state.objectProvenance)) {
    if ((provenance.previousSemanticKeys ?? []).includes(semanticKey))
      return provenance.canonicalId;
  }
  return null;
}

/** The obligation key an analysis declares for one of its own promises. */
function owningObligationKey(analysis: AiContractAnalysis, promiseKey: string): string | null {
  const owner = analysis.performanceObligations.find((obligation) =>
    obligation.promiseKeys.includes(promiseKey),
  );
  return owner?.semanticKey ?? null;
}

/**
 * Obligation facts, built with the frozen fact builder.
 *
 * Obligations are resolved before anything else, so they carry no canonical
 * relation evidence at all. What keeps them identifiable is the objective
 * contractual prose they cite — stated fees, rates, quantities and terms —
 * which is supplied here as measure sources. Lexical excerpt equality on its
 * own remains insufficient, exactly as the frozen evidence rules require.
 */
function obligationFacts(source: {
  semanticKey: string;
  description: string;
  satisfactionPattern: string;
  citations: readonly AiCitation[];
}): IdentityFacts {
  return buildIdentityFacts({
    objectKind: "performance_obligation",
    ref: source.semanticKey,
    judgments: { satisfactionPattern: source.satisfactionPattern },
    citations: spansOf(source.citations),
    measureSources: source.citations.map((citation) => citation.excerpt ?? null),
    description: source.description,
  });
}

/**
 * ROUTING SAFETY.
 *
 * The firewall and the production merge use deliberately different identity
 * systems, so economic continuity alone is not enough: the merge must also be
 * guaranteed to land this proposal on the very canonical object the firewall
 * resolved. For v1 the only guarantee we accept is direct, ARC-owned canonical
 * provenance for the proposal's CURRENT semantic key:
 *
 *   - no direct provenance (a new or renamed key, which would enter legacy
 *     re-identification inside the merge) ⇒ decline;
 *   - direct provenance pointing at a different canonical object ⇒ decline.
 *
 * Semantic-key stability never establishes identity by itself; it is only this
 * final routing check, applied after economic identity has been established
 * independently.
 */
function routesToSameCanonicalObject(
  state: AiAnalysisState,
  proposalKey: string,
  firewallCanonicalId: string,
): boolean {
  const direct = state.objectProvenance[proposalKey];
  if (direct === undefined) return false;
  return direct.canonicalId === firewallCanonicalId;
}


/**
 * True when the accountant's canonical draft already carries structure ARC
 * governs. Scalar contract fields do not count: they are protected by the
 * existing field-provenance rules and never bootstrapped structurally.
 */
export function draftHasCanonicalStructure(draft: WorkflowDraft): boolean {
  return (
    draft.promises.length > 0 ||
    draft.performanceObligations.length > 0 ||
    draft.variableConsiderationComponents.length > 0 ||
    draft.contractModifications.length > 0 ||
    draft.contractBalances.considerationEvents.length > 0 ||
    draft.contractBalances.cashCollections.length > 0
  );
}

interface StageOk {
  ok: true;
  /** proposal key → canonical id, for EXACT alignments only. */
  exact: Map<string, string>;
}
type StageResult = StageOk | { ok: false; reason: SafeReanalysisDeclineReason };

function resolveStage(args: {
  objectKind: AlignmentObjectKind;
  proposals: readonly IdentityFacts[];
  incumbents: readonly IncumbentIdentityFacts[];
  incumbentGroupKeyById?: Readonly<Record<string, string>> | undefined;
  proposalGroupKeyByRef?: Readonly<Record<string, string>> | undefined;
  /** Merge-routing guarantee for every exact alignment. */
  routingSafe?: (proposalKey: string, canonicalId: string) => boolean;
}): StageResult {
  if (args.proposals.length === 0 && args.incumbents.length === 0) {
    return { ok: true, exact: new Map() };
  }

  const result = resolveIdentityGraph({
    objectKind: args.objectKind,
    proposals: args.proposals,
    incumbents: args.incumbents,
    decompositionRules: canonicalGroupDecompositionRules({
      incumbentGroupKeyById: args.incumbentGroupKeyById,
      proposalGroupKeyByRef: args.proposalGroupKeyByRef,
    }),
  });

  const exact = new Map<string, string>();
  for (const alignment of result.alignments) {
    switch (alignment.relation) {
      case "exact":
        exact.set(alignment.proposalKey, alignment.canonicalIds[0]!);
        break;
      case "subsumes":
      case "split_from":
        return { ok: false, reason: "decomposition" };
      case "ambiguous":
        return { ok: false, reason: "ambiguous" };
      case "unmatched":
        return { ok: false, reason: "unmatched" };
    }
  }

  // An existing canonical object no proposal represents is never deleted, and
  // an apparent omission is never treated as continuity.
  if (result.omittedCanonicalIds.length > 0) return { ok: false, reason: "omitted_incumbent" };

  // Economic continuity is necessary but not sufficient: the unchanged merge
  // must be guaranteed to reach the same canonical object.
  if (args.routingSafe !== undefined) {
    for (const [proposalKey, canonicalId] of exact) {
      if (!args.routingSafe(proposalKey, canonicalId)) {
        return { ok: false, reason: "routing_unverified" };
      }
    }
  }

  return { ok: true, exact };
}


/* -------------------------------------------------------------- the gate */

export function assessSafeReanalysis(input: SafeReanalysisInput): SafeReanalysisDecision {
  const state = input.currentAiState;

  /* ------------------------------------------------ no AI baseline at all */
  if (state.lastSuccessfulRunId === null) {
    // A genuinely new analysis uses today's first-run path. A canonical draft
    // the accountant already built does NOT gain structural-bootstrap
    // permission merely because no AI run has ever succeeded.
    return draftHasCanonicalStructure(input.currentDraft)
      ? { outcome: "decline", reason: "unestablished_baseline" }
      : { outcome: "first_run" };
  }

  /* ------------------------------------------------------- same-source gate */
  if (
    state.sourceSetFingerprint === null ||
    state.sourceSetFingerprint !== input.currentSourceSetFingerprint
  ) {
    return { outcome: "decline", reason: "source_changed" };
  }

  /* ---------------------------------------- required prior immutable result */
  const load: PriorAnalysisLoad =
    input.priorAnalysisLoad ?? (input.priorAnalysis === null ? "unavailable" : "loaded");
  const prior = input.priorAnalysis;
  if (load !== "loaded" || prior === null) {
    return { outcome: "decline", reason: "prior_analysis_unavailable" };
  }

  /* ------------------------------------- 1. performance obligations, alone */
  // Resolved FIRST and with no relation evidence, so nothing downstream can
  // borrow the identity currently being tested as evidence for itself.
  const poProposals = input.analysis.performanceObligations.map((obligation) =>
    obligationFacts(obligation),
  );
  const poIncumbents: IncumbentIdentityFacts[] = [];
  const incumbentPoIdByKey = new Map<string, string>();
  for (const obligation of prior.performanceObligations) {
    const canonicalId = canonicalIdFor(state, obligation.semanticKey);
    if (canonicalId === null) continue;
    incumbentPoIdByKey.set(obligation.semanticKey, canonicalId);
    poIncumbents.push(asIncumbent(obligationFacts(obligation), canonicalId));
  }

  const poStage = resolveStage({
    objectKind: "performance_obligation",
    proposals: poProposals,
    incumbents: poIncumbents,
  });
  if (!poStage.ok) {
    return { outcome: "decline", reason: poStage.reason, objectKind: "performance_obligation" };
  }

  /**
   * The ONLY admissible canonical relation for child objects: an obligation
   * mapping that was established independently, by exact mutual uniqueness, in
   * the stage above. Anything less and the relation evidence is omitted.
   */
  const proposalPoCanonicalId = (proposalPoKey: string | null): string | null =>
    proposalPoKey === null ? null : (poStage.exact.get(proposalPoKey) ?? null);

  /* ----------------------------------------------------------- 2. promises */
  // Promises are members of an obligation, never standalone accounting objects,
  // so what protects them is MEMBERSHIP CONTINUITY: inside each obligation that
  // matched exactly, the new run's promises must correspond one-for-one with the
  // promises already there. A recomposition (two promises described as one) or a
  // member ARC cannot account for breaks the bijection and declines. Sibling
  // promises that the evidence cannot tell apart are harmless here: any
  // bijection preserves the same canonical structure.
  const proposalPromisesByPo = new Map<string, IdentityFacts[]>();
  for (const promise of input.analysis.promises) {
    const owningKey = owningObligationKey(input.analysis, promise.semanticKey);
    const owning = proposalPoCanonicalId(owningKey);
    if (owning === null) {
      // The promise belongs to no obligation ARC could match independently.
      return { outcome: "decline", reason: "decomposition", objectKind: "promise" };
    }
    const facts = promiseIdentityFacts({
      semanticKey: promise.semanticKey,
      promiseType: promise.promiseType,
      description: promise.description,
      distinctConclusion: promise.distinctConclusion,
      citations: spansOf(promise.citations),
      owningObligationCanonicalId: owning,
    });
    proposalPromisesByPo.set(owning, [...(proposalPromisesByPo.get(owning) ?? []), facts]);
  }

  const incumbentPromisesByPo = new Map<string, IncumbentIdentityFacts[]>();
  for (const promise of prior.promises) {
    const canonicalId = canonicalIdFor(state, promise.semanticKey);
    if (canonicalId === null) continue;
    const owningKey = owningObligationKey(prior, promise.semanticKey);
    const owning = owningKey === null ? null : (incumbentPoIdByKey.get(owningKey) ?? null);
    if (owning === null) continue;
    const facts = asIncumbent(
      promiseIdentityFacts({
        semanticKey: promise.semanticKey,
        promiseType: promise.promiseType,
        description: promise.description,
        distinctConclusion: promise.distinctConclusion,
        citations: spansOf(promise.citations),
        owningObligationCanonicalId: owning,
      }),
      canonicalId,
    );
    incumbentPromisesByPo.set(owning, [...(incumbentPromisesByPo.get(owning) ?? []), facts]);
  }

  for (const canonicalPoId of new Set([
    ...proposalPromisesByPo.keys(),
    ...incumbentPromisesByPo.keys(),
  ])) {
    const proposals = proposalPromisesByPo.get(canonicalPoId) ?? [];
    const incumbents = incumbentPromisesByPo.get(canonicalPoId) ?? [];
    if (proposals.length !== incumbents.length) {
      return { outcome: "decline", reason: "decomposition", objectKind: "promise" };
    }
    if (!hasPerfectMatching(proposals, incumbents)) {
      return { outcome: "decline", reason: "unmatched", objectKind: "promise" };
    }
  }

  /* ------------------------------------------- 3. variable consideration */
  const vcProposals = input.analysis.transactionPrice.variableConsiderationComponents.map(
    (component) =>
      variableConsiderationIdentityFacts({
        semanticKey: component.semanticKey,
        type: component.type,
        description: component.description,
        unitDescription: component.unitDescription,
        billingFrequency: component.billingFrequency,
        trigger: component.trigger,
        contractualRateOrAmountInput: component.contractualRateOrAmountInput,
        // Same non-circularity rule as promises: only an independently
        // established exact obligation mapping may be supplied.
        targetCanonicalId: proposalPoCanonicalId(component.targetPerformanceObligationKey),
        citations: spansOf(component.citations),
      }),
  );

  const vcIncumbents: IncumbentIdentityFacts[] = [];
  for (const component of prior.transactionPrice.variableConsiderationComponents) {
    const canonicalId = canonicalIdFor(state, component.semanticKey);
    if (canonicalId === null) continue;
    const targetKey = component.targetPerformanceObligationKey;
    vcIncumbents.push(
      asIncumbent(
        variableConsiderationIdentityFacts({
          semanticKey: component.semanticKey,
          type: component.type,
          description: component.description,
          unitDescription: component.unitDescription,
          billingFrequency: component.billingFrequency,
          trigger: component.trigger,
          contractualRateOrAmountInput: component.contractualRateOrAmountInput,
          targetCanonicalId:
            targetKey === null ? null : (incumbentPoIdByKey.get(targetKey) ?? null),
          citations: spansOf(component.citations),
        }),
        canonicalId,
      ),
    );
  }

  const vcStage = resolveStage({
    objectKind: "variable_consideration",
    proposals: vcProposals,
    incumbents: vcIncumbents,
  });
  if (!vcStage.ok) {
    return { outcome: "decline", reason: vcStage.reason, objectKind: "variable_consideration" };
  }

  /* --------------------------------------------------------- 4. billing */
  // Canonical billing events and projected collections are DERIVED from a
  // billing schedule, so schedule continuity is what protects them from
  // duplication. Only schedules that actually produced canonical rows count.
  const canonicalTermKeys = new Set<string>();
  for (const [semanticKey] of Object.entries(state.objectProvenance)) {
    const base = semanticKey.endsWith("#collection")
      ? semanticKey.slice(0, -"#collection".length)
      : semanticKey;
    const parsed = parseBillingEventSemanticKey(base);
    if (parsed !== null) canonicalTermKeys.add(parsed.termKey);
  }

  const billingFacts = (term: AiContractAnalysis["billingTerms"][number]) =>
    billingTermIdentityFacts({
      semanticKey: term.semanticKey,
      description: term.description,
      frequency: term.frequency,
      billingTiming: term.billingTiming,
      invoiceTrigger: term.invoiceTrigger,
      paymentTermsDays: term.paymentTermsDays,
      amountOrRateInput: term.amountOrRateInput,
      citations: spansOf(term.citations),
    });

  const billingIncumbents = prior.billingTerms
    .filter((term) => canonicalTermKeys.has(term.semanticKey))
    .map((term) => asIncumbent(billingFacts(term), `billing-schedule:${term.semanticKey}`));

  if (billingIncumbents.length > 0) {
    const billingStage = resolveStage({
      objectKind: "billing_term",
      proposals: input.analysis.billingTerms.map(billingFacts),
      incumbents: billingIncumbents,
    });
    if (!billingStage.ok) {
      return { outcome: "decline", reason: billingStage.reason, objectKind: "billing_term" };
    }
  }

  return { outcome: "apply" };
}

/**
 * Early, pre-payment changed-source detection.
 *
 * A re-analysis of a document set that is not the one the current analysis
 * rests on can never be applied, so it is refused BEFORE allowance is reserved
 * and before the model is contacted: it costs neither quota nor a provider
 * call. The apply-time gate re-checks the same fact defensively.
 */
export function isChangedSourceReanalysis(
  state: Pick<AiAnalysisState, "lastSuccessfulRunId" | "sourceSetFingerprint">,
  currentSourceSetFingerprint: string,
): boolean {
  if (state.lastSuccessfulRunId === null) return false;
  if (state.sourceSetFingerprint === null) return false;
  return state.sourceSetFingerprint !== currentSourceSetFingerprint;
}
