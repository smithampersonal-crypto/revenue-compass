/**
 * Phase 9E — Task 10. The deterministic AI → canonical merge.
 *
 * `mergeAiAnalysis` is a pure function. Given the same inputs it always
 * returns the same semantic output: no database, React, OpenAI, Supabase,
 * network, environment variable, `Date.now()`, `Math.random()` or crypto
 * randomness participates. Every input object is treated as immutable.
 *
 * The model is never authoritative. ARC owns canonical IDs, sequencing,
 * promise→PO relationships, draft structure, engine inputs, billing events,
 * projected collection dates, merge behaviour, manual-value preservation,
 * provenance, tombstones and review state. AI metadata never enters
 * `WorkflowDraft`: it lives entirely in the returned sidecar.
 */

import { getGuidancePolicy } from "@/lib/arc/guidance/policy";
import type { GuidancePack, GuidanceReviewSection } from "@/lib/arc/guidance/types";
import { validateDraftForPersistence } from "@/lib/arc/persistence/schema";
import type { IsoDate } from "@/lib/asc606";
import {
  createCashCollectionDraft,
  createConsiderationEventDraft,
  createModificationDraft,
  createPoDraft,
  createPromiseDraft,
  createVcComponentDraft,
  createVcMeterDraft,
  STEP1_CRITERIA,
  type CashCollectionDraft,
  type ConsiderationEventDraft,
  type Judgment,
  type ModificationDraft,
  type PoDraft,
  type PromiseDraft,
  type Step1CriterionId,
  type VcComponentDraft,
  type VcMeterDraft,
  type WorkflowDraft,
} from "@/lib/asc606-workflow";

import {
  deriveBillingSchedule,
  deriveProjectedCollectionDate,
  deriveUnambiguousFixedBillingTotal,
  exactCents,
  isUnclaimedString,
  mapEstimationMethod,
  mapOutcome,
  mapRecognitionMethod,
  mapVcEffect,
  parseIsoDate,
  usableAmount,
} from "./adapter";
import {
  deriveCanonicalId,
  fieldKeys,
  PROVISIONAL_SSP_TARGET_KEY,
  resolveUniqueId,
  valueFingerprint,
  type AiObjectKind,
} from "./identity";
import { normalizePersistedReviewItems } from "./review-normalization";
import {
  carryForwardReviewResolutions,
  deriveReviewItem,
  rankReviewItems,
  sortReviewItems,
  type AiReviewCitationRef,
  type AiReviewItem,
  type AiReviewReasonCode,
} from "./review-state";
import type { AiCitation, AiContractAnalysis, AiReviewState } from "./schema";
import type { PriorAccountingContext } from "./types";

/* ------------------------------------------------------------ sidecar model */

export type AiProvenanceState =
  | "ai_generated_untouched"
  | "ai_generated_user_edited"
  | "manual_from_start"
  | "prior_finalized"
  | "ai_difference_preserved_user_override";

export interface AiFieldProvenance {
  state: AiProvenanceState;
  semanticKey: string | null;
  lastAiRunId: string | null;
  valueFingerprint: string;
}

export interface AiObjectProvenance extends AiFieldProvenance {
  canonicalId: string;
  userModified: boolean;
}

export interface AiAnalysisState {
  lastSuccessfulRunId: string | null;
  sourceSetFingerprint: string | null;
  sourceState: "none" | "current" | "stale";
  fieldProvenance: Record<string, AiFieldProvenance>;
  objectProvenance: Record<string, AiObjectProvenance>;
  tombstones: string[];
  reviewItems: AiReviewItem[];
}

export function createEmptyAiAnalysisState(): AiAnalysisState {
  return {
    lastSuccessfulRunId: null,
    sourceSetFingerprint: null,
    sourceState: "none",
    fieldProvenance: {},
    objectProvenance: {},
    tombstones: [],
    reviewItems: [],
  };
}

/** Raised when the merged draft is not a structurally valid canonical draft. */
export class AiMergeError extends Error {
  readonly code = "merged_draft_invalid";
  constructor(message: string) {
    super(message);
    this.name = "AiMergeError";
  }
}

export interface MergeAiAnalysisArgs {
  currentDraft: WorkflowDraft;
  currentAiState: AiAnalysisState;
  analysis: AiContractAnalysis;
  runId: string;
  guidancePack: GuidancePack;
  priorContext: PriorAccountingContext | null;
}

export interface MergeAiAnalysisResult {
  draft: WorkflowDraft;
  aiState: AiAnalysisState;
  issues: AiReviewItem[];
}

/* ------------------------------------------------------------------ helpers */

function clone<T>(value: T): T {
  return structuredClone(value);
}

/** Section for a set of guidance references, defaulting to the caller's own. */
function sectionFor(
  guidanceIds: readonly number[],
  fallback: GuidanceReviewSection,
): GuidanceReviewSection {
  for (const id of guidanceIds) {
    const policy = getGuidancePolicy(id);
    if (policy !== undefined) return policy.reviewSection;
  }
  return fallback;
}

/** Guidance IDs that actually exist in the supplied pack. */
function packFilter(pack: GuidancePack): (ids: readonly number[]) => number[] {
  const known = new Set(pack.cards.map((card) => card.id));
  return (ids) => ids.filter((id) => known.has(id));
}

function normalizedText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/* ------------------------------------------------------------------- merge */

export function mergeAiAnalysis(args: MergeAiAnalysisArgs): MergeAiAnalysisResult {
  const { analysis, runId, guidancePack, priorContext } = args;

  // Inputs are immutable. Everything below mutates local clones only.
  const draft = clone(args.currentDraft);
  const previousState = clone(args.currentAiState);
  const onlyKnownGuidance = packFilter(guidancePack);

  const fieldProvenance: Record<string, AiFieldProvenance> = { ...previousState.fieldProvenance };
  const objectProvenance: Record<string, AiObjectProvenance> = {
    ...previousState.objectProvenance,
  };
  const tombstones = new Set(previousState.tombstones);
  const issues: AiReviewItem[] = [];

  const takenIds = new Set<string>([
    ...draft.promises.map((row) => row.id),
    ...draft.performanceObligations.map((row) => row.id),
    ...draft.variableConsiderationComponents.map((row) => row.id),
    ...draft.contractModifications.map((row) => row.id),
    ...draft.contractBalances.considerationEvents.map((row) => row.id),
    ...draft.contractBalances.cashCollections.map((row) => row.id),
  ]);

  /* ------------------------------------------- pre-merge canonical baseline */

  // Every canonical row whose ID no AI run has ever owned belongs to the
  // accountant. Manual structure is stronger than AI structure: ARC preserves
  // it and never stands a duplicate beside it.
  const aiOwnedIds = new Set(
    Object.values(previousState.objectProvenance).map((provenance) => provenance.canonicalId),
  );
  const isManualRow = (id: string) => !aiOwnedIds.has(id);
  const manualPromises = args.currentDraft.promises.filter((row) => isManualRow(row.id));
  const manualPoIds = new Set(
    args.currentDraft.performanceObligations.filter((row) => isManualRow(row.id)).map((r) => r.id),
  );
  const manualVcComponents = args.currentDraft.variableConsiderationComponents.filter((row) =>
    isManualRow(row.id),
  );
  const manualModifications = args.currentDraft.contractModifications.filter((row) =>
    isManualRow(row.id),
  );
  const manualConsiderationEvents = args.currentDraft.contractBalances.considerationEvents.filter(
    (row) => isManualRow(row.id),
  );

  // Each AI-owned object as it stood BEFORE this merge. Comparing THIS with
  // the fingerprint ARC last wrote is the only sound test of a user edit: a
  // difference measured after ARC applied the new analysis would simply be
  // ARC's own work misread as the accountant's.
  const preMergeFingerprints = new Map<string, string>();
  for (const [semanticKey, provenance] of Object.entries(previousState.objectProvenance)) {
    const fingerprint = aiObjectFingerprint(args.currentDraft, provenance.canonicalId);
    if (fingerprint !== null) preMergeFingerprints.set(semanticKey, fingerprint);
  }

  /* ---------------------------------------------- prior finalized context */

  // Prior finalized accounting is read-only history. Seeding its keys before
  // anything else guarantees no later mapping step can rewrite it.
  if (priorContext !== null) {
    const seedPrior = (key: string, value: unknown) => {
      fieldProvenance[key] = {
        state: "prior_finalized",
        semanticKey: null,
        lastAiRunId: null,
        valueFingerprint: valueFingerprint(value),
      };
    };
    seedPrior(fieldKeys.transactionPrice("input"), priorContext.transactionPriceInput);
    for (const po of priorContext.performanceObligations) {
      const id = typeof po["id"] === "string" ? (po["id"] as string) : null;
      if (id === null) continue;
      seedPrior(fieldKeys.po(id, "recognitionMethod"), po["recognitionMethod"] ?? null);
      seedPrior(fieldKeys.po(id, "serviceStart"), po["serviceStart"] ?? null);
      seedPrior(fieldKeys.po(id, "serviceEnd"), po["serviceEnd"] ?? null);
      seedPrior(fieldKeys.po(id, "sspInput"), po["sspInput"] ?? null);
    }
  }

  /* --------------------------------------------------------- review issues */

  /**
   * Every review item carries the validated citations of the exact conclusion
   * that supplied its value. A synthetic item with no source evidence — an
   * omission, a tombstone, a required identifier ARC never reads from the
   * analysis — passes none, and none is fabricated for it.
   */
  const reviewCitations = (citations: readonly AiCitation[] | undefined): AiReviewCitationRef[] =>
    (citations ?? []).map((citation) => ({
      documentId: citation.documentId,
      pageStart: citation.pageStart,
      pageEnd: citation.pageEnd,
      evidenceMode: citation.evidenceMode,
      excerpt: citation.excerpt ?? null,
    }));

  const raise = (input: {
    targetKey: string;
    section: GuidanceReviewSection;
    reasonCode: AiReviewReasonCode;
    reason: string;
    guidanceIds?: readonly number[];
    citations?: readonly AiCitation[];
    /** The displayed reviewed value. */
    value: unknown;
    /**
     * The complete material conclusion this item reviews, whenever the
     * displayed value alone would not distinguish two materially different
     * accounting conclusions. Display prose is never the material: a changed
     * amount, timing, grouping or treatment must always reopen the item.
     */
    material?: unknown;
    aiReviewState?: AiReviewState | null;
    blocking?: boolean;
  }) => {
    const item = deriveReviewItem({
      targetKey: input.targetKey,
      section: input.section,
      reasonCode: input.reasonCode,
      reason: input.reason,
      guidanceIds: onlyKnownGuidance(input.guidanceIds ?? []),
      citations: reviewCitations(input.citations),
      value: input.value,
      ...(input.material === undefined ? {} : { material: input.material }),
      aiReviewState: input.aiReviewState ?? null,
      blocking: input.blocking ?? false,
    });
    if (item !== null) issues.push(item);
  };

  /* ------------------------------------------- material review projections */

  /**
   * Canonical deterministic projections of the conclusions ARC raises review
   * items about. Each carries every structural fact a reasonable reviewer
   * would reconsider the conclusion over — never a truncated display string.
   */
  const promiseMaterial = (promise: AiContractAnalysis["promises"][number]) => ({
    semanticKey: promise.semanticKey,
    description: promise.description,
    promiseType: promise.promiseType,
    otherPromiseTypeDescription: promise.otherPromiseTypeDescription,
    explicitOrImplicit: promise.explicitOrImplicit,
    capableOfBeingDistinct: promise.distinctCapableOfBeingDistinct,
    separatelyIdentifiable: promise.distinctSeparatelyIdentifiable,
    distinctConclusion: promise.distinctConclusion,
    distinctnessRationale: promise.distinctnessRationale,
  });

  const poMaterial = (po: AiContractAnalysis["performanceObligations"][number]) => ({
    semanticKey: po.semanticKey,
    description: po.description,
    promiseKeys: [...po.promiseKeys].sort(),
    groupingRationale: po.groupingRationale,
    satisfactionPattern: po.satisfactionPattern,
    recognitionRationale: po.recognitionRationale,
  });

  const recognitionMaterial = (proposal: AiContractAnalysis["recognitionProposals"][number]) => ({
    performanceObligationKey: proposal.performanceObligationKey,
    satisfactionPattern: proposal.satisfactionPattern,
    recognitionMethod: proposal.recognitionMethod,
    serviceStartDate: proposal.serviceStartDate,
    serviceEndDate: proposal.serviceEndDate,
    measureDescription: proposal.measureDescription,
    recognitionEventDescription: proposal.recognitionEventDescription,
    recognitionDateIfContractuallyDeterminable: proposal.recognitionDateIfContractuallyDeterminable,
    rationale: proposal.rationale,
  });

  const sspMaterial = (item: AiContractAnalysis["sspAndAllocation"]["items"][number]) => ({
    semanticKey: item.semanticKey,
    appliesToKey: item.appliesToKey,
    observableSspEvidence: item.observableSspEvidence,
    observedAmountInput: item.observedAmountInput,
    proposedMethod: item.proposedMethod,
    proposedSspAmountInput: item.proposedSspAmountInput,
    methodRationale: item.methodRationale,
    missingInformation: item.missingInformation,
  });

  const vcMaterial = (
    component: AiContractAnalysis["transactionPrice"]["variableConsiderationComponents"][number],
  ) => ({
    semanticKey: component.semanticKey,
    description: component.description,
    type: component.type,
    contractualRateOrAmountInput: component.contractualRateOrAmountInput,
    unitDescription: component.unitDescription,
    billingFrequency: component.billingFrequency,
    trigger: component.trigger,
    estimationMethodProposal: component.estimationMethodProposal,
    initialEstimateBasis: component.initialEstimateBasis,
    initialEstimatedAmountInput: component.initialEstimatedAmountInput,
    initialIncludedAmountInput: component.initialIncludedAmountInput,
    initialEstimateRationale: component.initialEstimateRationale,
    constraintAssessment: component.constraintAssessment,
  });

  const modificationMaterial = () => ({
    hasModification: analysis.contractModifications.hasModification,
    effectiveDate: analysis.contractModifications.effectiveDate,
    addedGoodsOrServices: analysis.contractModifications.addedGoodsOrServices,
    addedGoodsDistinct: analysis.contractModifications.addedGoodsDistinct,
    priceIncreaseInput: analysis.contractModifications.priceIncreaseInput,
    priceReflectsSsp: analysis.contractModifications.priceReflectsSsp,
    remainingGoodsDistinct: analysis.contractModifications.remainingGoodsDistinct,
    treatmentCandidate: analysis.contractModifications.treatmentCandidate,
    rationale: analysis.contractModifications.rationale,
  });

  const billingMaterial = (term: AiContractAnalysis["billingTerms"][number]) => ({
    semanticKey: term.semanticKey,
    description: term.description,
    billingTiming: term.billingTiming,
    frequency: term.frequency,
    invoiceTrigger: term.invoiceTrigger,
    amountOrRateInput: term.amountOrRateInput,
    paymentTermsDays: term.paymentTermsDays,
    dueDateRule: term.dueDateRule,
  });

  const projectionMaterial = () => ({
    contractualDueDateBasis: analysis.projectedCollectionAssumptions.contractualDueDateBasis,
    paymentTermsDays: analysis.projectedCollectionAssumptions.paymentTermsDays,
    basisExplanation: analysis.projectedCollectionAssumptions.basisExplanation,
  });

  /* ---------------------------------------------------------- scalar merge */

  interface ScalarArgs<T> {
    key: string;
    semanticKey: string | null;
    current: T;
    proposed: T;
    /** True when the accountant has not supplied a meaningful value yet. */
    unclaimed: boolean;
    apply: (value: T) => void;
    section: GuidanceReviewSection;
    guidanceIds?: readonly number[];
    citations?: readonly AiCitation[];
    aiReviewState?: AiReviewState | null;
    label: string;
  }

  /**
   * The single place first-run and re-analysis scalar policy lives.
   * ARC never blanks a value, never overwrites a manual value, and never
   * overwrites a value the user edited after AI produced it.
   */
  function mergeScalar<T>(input: ScalarArgs<T>): void {
    const proposedFingerprint = valueFingerprint(input.proposed);
    const currentFingerprint = valueFingerprint(input.current);
    const differs = proposedFingerprint !== currentFingerprint;
    const prior = fieldProvenance[input.key];
    const guidanceIds = onlyKnownGuidance(input.guidanceIds ?? []);

    const preserve = (state: AiProvenanceState, fingerprint: string) => {
      fieldProvenance[input.key] = {
        state,
        semanticKey: input.semanticKey,
        lastAiRunId: prior?.lastAiRunId ?? null,
        valueFingerprint: fingerprint,
      };
      if (differs) {
        raise({
          targetKey: input.key,
          section: input.section,
          reasonCode:
            state === "prior_finalized" ? "prior_finalized_conflict" : "manual_value_preserved",
          reason: `${input.label}: the recorded value was kept; the AI analysis proposed a different value.`,
          guidanceIds,
          citations: input.citations ?? [],
          // A difference item is reviewed as a DIFFERENCE: the affirmation an
          // accountant gave to "keep 125,000 over the AI's 150,000" must not
          // survive the AI later proposing 180,000.
          value: { preservedValue: input.current, proposedValue: input.proposed },
          aiReviewState: input.aiReviewState ?? null,
          blocking: state === "prior_finalized",
        });
      }
    };

    // Prior finalized history is immutable, full stop.
    if (prior?.state === "prior_finalized") {
      preserve("prior_finalized", prior.valueFingerprint);
      return;
    }

    if (prior === undefined) {
      if (!input.unclaimed) {
        preserve("manual_from_start", currentFingerprint);
        return;
      }
      input.apply(input.proposed);
      fieldProvenance[input.key] = {
        state: "ai_generated_untouched",
        semanticKey: input.semanticKey,
        lastAiRunId: runId,
        valueFingerprint: proposedFingerprint,
      };
      return;
    }

    if (prior.state === "manual_from_start") {
      preserve("manual_from_start", prior.valueFingerprint);
      return;
    }

    // Previously AI-owned. Untouched means the user never changed it.
    if (currentFingerprint === prior.valueFingerprint) {
      input.apply(input.proposed);
      fieldProvenance[input.key] = {
        state: "ai_generated_untouched",
        semanticKey: input.semanticKey,
        lastAiRunId: runId,
        valueFingerprint: proposedFingerprint,
      };
      return;
    }

    // The user edited an AI value. Their value wins; the stored AI fingerprint
    // is retained so the field stays protected on every later run.
    fieldProvenance[input.key] = {
      state: differs ? "ai_difference_preserved_user_override" : "ai_generated_user_edited",
      semanticKey: input.semanticKey,
      lastAiRunId: prior.lastAiRunId,
      valueFingerprint: prior.valueFingerprint,
    };
    if (differs) {
      raise({
        targetKey: input.key,
        section: input.section,
        reasonCode: "manual_value_preserved",
        reason: `${input.label}: your edited value was kept; the AI analysis proposed a different value.`,
        guidanceIds,
        citations: input.citations ?? [],
        value: { preservedValue: input.current, proposedValue: input.proposed },
        aiReviewState: input.aiReviewState ?? null,
      });
    }
  }

  /** Convenience for string fields whose unclaimed form is the empty string. */
  function mergeText(input: Omit<ScalarArgs<string>, "unclaimed">): void {
    mergeScalar({ ...input, unclaimed: isUnclaimedString(input.current) });
  }

  /* ------------------------------------------------------ object identity */

  const deletedSemanticKeys: string[] = [];

  /**
   * Any previously AI-created object whose canonical row is gone was deleted by
   * the user. It is tombstoned and never recreated, even when the model
   * proposes the same semantic object again.
   */
  for (const [semanticKey, provenance] of Object.entries(objectProvenance)) {
    if (!takenIds.has(provenance.canonicalId)) {
      tombstones.add(semanticKey);
      deletedSemanticKeys.push(semanticKey);
      delete objectProvenance[semanticKey];
    }
  }

  function canonicalIdFor(kind: AiObjectKind, semanticKey: string): string {
    const existing = objectProvenance[semanticKey];
    if (existing !== undefined) return existing.canonicalId;
    const id = resolveUniqueId(deriveCanonicalId(kind, semanticKey), takenIds);
    takenIds.add(id);
    return id;
  }

  /**
   * Registers an object ARC mapped in this run. The fingerprint and the
   * user-edit conclusion are NOT computed here: an object is only final once
   * every dependent mapping step has run (a promise needs its performance
   * obligation, a performance obligation needs its recognition and
   * standalone selling price). Both are resolved in one pass at the end.
   */
  const claimedObjects: Array<{ semanticKey: string; canonicalId: string }> = [];
  function claimObject(semanticKey: string, canonicalId: string): void {
    if (claimedObjects.some((entry) => entry.semanticKey === semanticKey)) return;
    claimedObjects.push({ semanticKey, canonicalId });
  }

  const proposedSemanticKeys = new Set<string>();

  /* --------------------------------------------------------- Step 1 + head */

  const assessment = analysis.contractAssessment;

  const customer = assessment.parties.find((party) => party.role === "customer");
  if (customer !== undefined) {
    mergeText({
      key: fieldKeys.contract("customerName"),
      semanticKey: customer.semanticKey,
      current: draft.contract.customerName,
      proposed: customer.name,
      apply: (value) => {
        draft.contract = { ...draft.contract, customerName: value };
      },
      section: "step_1",
      citations: customer.citations,
      aiReviewState: customer.reviewState,
      label: "Customer name",
    });
  }

  const executionDate = parseIsoDate(assessment.contractEffectiveDate.value);
  if (executionDate !== null) {
    mergeText({
      key: fieldKeys.contract("executionDate"),
      semanticKey: "contract:effective-date",
      current: draft.contract.executionDate,
      proposed: executionDate,
      apply: (value) => {
        draft.contract = { ...draft.contract, executionDate: value };
      },
      section: "step_1",
      guidanceIds: assessment.contractEffectiveDate.guidanceIds,
      citations: assessment.contractEffectiveDate.citations,
      aiReviewState: assessment.contractEffectiveDate.reviewState,
      label: "Contract effective date",
    });
  }

  // The contract reference is an administrative label, not an accounting
  // input: it comes only from the structured `contractReference` fact, never
  // from prose, and its absence never blocks deterministic accounting.
  const contractReference = (assessment.contractReference.value ?? "").trim();
  if (contractReference !== "") {
    mergeText({
      key: fieldKeys.contract("contractNumber"),
      semanticKey: "contract:reference",
      current: draft.contract.contractNumber,
      proposed: contractReference,
      apply: (value) => {
        draft.contract = { ...draft.contract, contractNumber: value };
      },
      section: "step_1",
      guidanceIds: assessment.contractReference.guidanceIds,
      citations: assessment.contractReference.citations,
      aiReviewState: assessment.contractReference.reviewState,
      label: "Contract number or reference",
    });
  }

  const STEP1_MAP: ReadonlyArray<{
    criterion: Step1CriterionId;
    judgment: (typeof assessment)["approvalAndCommitment"];
    label: string;
  }> = [
    {
      criterion: "approval_and_commitment",
      judgment: assessment.approvalAndCommitment,
      label: "Approval and commitment",
    },
    {
      criterion: "rights_identifiable",
      judgment: assessment.identifiableRights,
      label: "Rights are identifiable",
    },
    {
      criterion: "payment_terms_identifiable",
      judgment: assessment.identifiablePaymentTerms,
      label: "Payment terms are identifiable",
    },
    {
      criterion: "commercial_substance",
      judgment: assessment.commercialSubstance,
      label: "Commercial substance",
    },
    {
      criterion: "collectibility_probable",
      judgment: assessment.collectibility,
      label: "Collectibility is probable",
    },
  ];

  for (const entry of STEP1_MAP) {
    const known = STEP1_CRITERIA.some((criterion) => criterion.id === entry.criterion);
    if (!known) continue;
    const answer = mapOutcome(entry.judgment.outcome);
    const currentAnswer = draft.contract.criteria[entry.criterion]?.answer ?? null;
    const key = fieldKeys.criterion(entry.criterion);
    const section = sectionFor(entry.judgment.guidanceIds, "step_1");

    if (answer !== null) {
      mergeScalar<Judgment>({
        key,
        semanticKey: `step1:${entry.criterion}`,
        current: currentAnswer,
        proposed: answer,
        unclaimed: currentAnswer === null,
        apply: (value) => {
          draft.contract = {
            ...draft.contract,
            criteria: {
              ...draft.contract.criteria,
              [entry.criterion]: { ...draft.contract.criteria[entry.criterion], answer: value },
            },
          };
        },
        section,
        guidanceIds: entry.judgment.guidanceIds,
        citations: entry.judgment.citations,
        aiReviewState: entry.judgment.reviewState,
        label: entry.label,
      });
      // A rationale is only written where ARC owns the judgment itself.
      if (fieldProvenance[key]?.state === "ai_generated_untouched") {
        mergeText({
          key: fieldKeys.criterionRationale(entry.criterion),
          semanticKey: `step1:${entry.criterion}`,
          current: draft.contract.criteria[entry.criterion].rationale,
          proposed: entry.judgment.rationale,
          apply: (value) => {
            draft.contract = {
              ...draft.contract,
              criteria: {
                ...draft.contract.criteria,
                [entry.criterion]: {
                  ...draft.contract.criteria[entry.criterion],
                  rationale: value,
                },
              },
            };
          },
          section,
          guidanceIds: entry.judgment.guidanceIds,
          citations: entry.judgment.citations,
          aiReviewState: entry.judgment.reviewState,
          label: `${entry.label} rationale`,
        });
      }
    }

    // Phase 9G-R Task R2. A positive Step 1 criterion the contract's own terms
    // support is a routine drafting assumption, not a queue item: it is stated
    // and evidenced, but the accountant is not asked to click through five
    // confirmations to get to real work. Anything unsupported, conflicting or
    // negative keeps its existing actionable treatment.
    const routineStep1 =
      answer === true &&
      (entry.judgment.reviewState === "supported" || entry.judgment.reviewState === "inference");

    raise({
      targetKey: key,
      section,
      reasonCode:
        answer === null
          ? "missing_required_input"
          : routineStep1
            ? "routine_assumption"
            : "accountant_affirmation_required",
      reason:
        answer === null
          ? `${entry.label}: the contract does not establish this criterion. An accountant judgment is required.`
          : routineStep1
            ? `${entry.label}: ARC concluded this from the contract's own terms.`
            : `${entry.label}: affirm the AI conclusion.`,
      guidanceIds: entry.judgment.guidanceIds,
      citations: entry.judgment.citations,
      value: draft.contract.criteria[entry.criterion]?.answer ?? null,
      material: {
        criterion: entry.criterion,
        answer: draft.contract.criteria[entry.criterion]?.answer ?? null,
        proposedOutcome: entry.judgment.outcome,
        rationale: entry.judgment.rationale,
      },
      aiReviewState: entry.judgment.reviewState,
      blocking: answer === null && draft.contract.criteria[entry.criterion]?.answer === null,
    });
  }

  /* -------------------------------------------------------------- promises */

  const promiseIdBySemanticKey = new Map<string, string>();
  const manualPromiseByText = new Map<string, PromiseDraft>();
  for (const promise of manualPromises) {
    const text = normalizedText(promise.description);
    if (text !== "" && !manualPromiseByText.has(text)) manualPromiseByText.set(text, promise);
  }

  for (const aiPromise of analysis.promises) {
    proposedSemanticKeys.add(aiPromise.semanticKey);
    if (tombstones.has(aiPromise.semanticKey)) {
      raise({
        targetKey: `promise:${aiPromise.semanticKey}`,
        section: "step_2",
        reasonCode: "ai_proposal_tombstoned",
        reason: `The AI analysis still proposes "${aiPromise.description.slice(0, 120)}", which you previously removed. It has not been recreated.`,
        guidanceIds: aiPromise.guidanceIds,
        citations: aiPromise.citations,
        value: aiPromise.semanticKey,
        material: promiseMaterial(aiPromise),
        aiReviewState: "needs_review",
      });
      continue;
    }

    // Exact-text collision with a pre-existing MANUAL promise. No fuzzy or
    // semantic similarity matching is performed in v1.
    const manualTwin = manualPromiseByText.get(normalizedText(aiPromise.description));
    if (manualTwin !== undefined && objectProvenance[aiPromise.semanticKey] === undefined) {
      raise({
        targetKey: `promise:${manualTwin.id}`,
        section: "step_2",
        reasonCode: "manual_structure_preserved",
        reason:
          "The AI analysis proposes a promise that matches one you entered manually. Your promise was kept and no duplicate was created.",
        guidanceIds: aiPromise.guidanceIds,
        citations: aiPromise.citations,
        value: {
          manualPromiseId: manualTwin.id,
          semanticKey: aiPromise.semanticKey,
          proposed: aiPromise.description.slice(0, 120),
        },
        material: { manualPromiseId: manualTwin.id, ...promiseMaterial(aiPromise) },
        aiReviewState: aiPromise.reviewState,
      });
      promiseIdBySemanticKey.set(aiPromise.semanticKey, manualTwin.id);
      continue;
    }

    const canonicalId = canonicalIdFor("promise", aiPromise.semanticKey);
    promiseIdBySemanticKey.set(aiPromise.semanticKey, canonicalId);

    let createdRow = false;
    if (draft.promises.every((promise) => promise.id !== canonicalId)) {
      draft.promises = [
        ...draft.promises,
        createPromiseDraft(draft.promises.length + 1, canonicalId),
      ];
      createdRow = true;
    }
    const section = sectionFor(aiPromise.guidanceIds, "step_2");

    const update = (patch: Partial<PromiseDraft>) => {
      draft.promises = draft.promises.map((promise) =>
        promise.id === canonicalId ? { ...promise, ...patch } : promise,
      );
    };
    const current = () => draft.promises.find((promise) => promise.id === canonicalId)!;

    // The promise kind is AI-owned and refreshes on re-analysis: a later
    // analysis that reclassifies a promise as a customer option must not be
    // silently ignored, because it changes the material-right question below.
    mergeScalar<PromiseDraft["kind"]>({
      key: fieldKeys.promise(canonicalId, "kind"),
      semanticKey: aiPromise.semanticKey,
      current: current().kind,
      proposed: aiPromise.promiseType === "option" ? "customer_option" : "good_or_service",
      unclaimed: createdRow,
      apply: (value) => update({ kind: value }),
      section,
      guidanceIds: aiPromise.guidanceIds,
      citations: aiPromise.citations,
      aiReviewState: aiPromise.reviewState,
      label: "Promise type",
    });

    mergeText({
      key: fieldKeys.promise(canonicalId, "description"),
      semanticKey: aiPromise.semanticKey,
      current: current().description,
      proposed: aiPromise.description,
      apply: (value) => update({ description: value }),
      section,
      guidanceIds: aiPromise.guidanceIds,
      citations: aiPromise.citations,
      aiReviewState: aiPromise.reviewState,
      label: "Promise description",
    });
    for (const spec of [
      {
        field: "capableOfBeingDistinct" as const,
        outcome: aiPromise.distinctCapableOfBeingDistinct,
        label: "Capable of being distinct",
      },
      {
        field: "distinctWithinContractContext" as const,
        outcome: aiPromise.distinctSeparatelyIdentifiable,
        label: "Distinct within the context of the contract",
      },
    ]) {
      const proposed = mapOutcome(spec.outcome);
      if (proposed === null) continue;
      mergeScalar<Judgment>({
        key: fieldKeys.promise(canonicalId, spec.field),
        semanticKey: aiPromise.semanticKey,
        current: current()[spec.field],
        proposed,
        unclaimed: current()[spec.field] === null,
        apply: (value) => update({ [spec.field]: value } as Partial<PromiseDraft>),
        section,
        guidanceIds: aiPromise.guidanceIds,
        citations: aiPromise.citations,
        aiReviewState: aiPromise.reviewState,
        label: spec.label,
      });
    }
    mergeText({
      key: fieldKeys.promise(canonicalId, "distinctRationale"),
      semanticKey: aiPromise.semanticKey,
      current: current().distinctRationale,
      proposed: aiPromise.distinctnessRationale,
      apply: (value) => update({ distinctRationale: value }),
      section,
      guidanceIds: aiPromise.guidanceIds,
      citations: aiPromise.citations,
      aiReviewState: aiPromise.reviewState,
      label: "Distinctness rationale",
    });

    // A customer option's material-right conclusion has no structured field in
    // the accepted Phase 9D schema. It is left unanswered, never inferred.
    if (current().kind === "customer_option" && current().conveysMaterialRight === null) {
      raise({
        targetKey: fieldKeys.promise(canonicalId, "conveysMaterialRight"),
        section: "additional_topics",
        reasonCode: "missing_required_input",
        reason:
          "This customer option needs your judgment on whether it conveys a material right. The AI analysis does not supply that conclusion structurally.",
        guidanceIds: aiPromise.guidanceIds,
        citations: aiPromise.citations,
        value: null,
        material: { promiseId: canonicalId, ...promiseMaterial(aiPromise) },
        aiReviewState: "needs_user_input",
        blocking: true,
      });
    }

    claimObject(aiPromise.semanticKey, canonicalId);
  }

  /* ------------------------------------------------ performance obligations */

  const poIdBySemanticKey = new Map<string, string>();

  for (const aiPo of analysis.performanceObligations) {
    proposedSemanticKeys.add(aiPo.semanticKey);
    if (tombstones.has(aiPo.semanticKey)) {
      raise({
        targetKey: `po:${aiPo.semanticKey}`,
        section: "step_2",
        reasonCode: "ai_proposal_tombstoned",
        reason:
          "The AI analysis still proposes a performance obligation you previously removed. It has not been recreated.",
        guidanceIds: aiPo.guidanceIds,
        citations: aiPo.citations,
        value: aiPo.semanticKey,
        material: poMaterial(aiPo),
        aiReviewState: "needs_review",
      });
      continue;
    }

    const section = sectionFor(aiPo.guidanceIds, "step_2");

    // Promise membership is resolved BEFORE any canonical performance
    // obligation is created. A grouping the accountant has already recorded
    // manually must never gain a duplicate AI twin beside it.
    const mappedPromiseIds: string[] = [];
    for (const promiseKey of aiPo.promiseKeys) {
      const promiseId = promiseIdBySemanticKey.get(promiseKey);
      if (promiseId === undefined) {
        raise({
          targetKey: `po:${aiPo.semanticKey}.promiseKeys`,
          section,
          reasonCode: "unsafe_semantic_relationship",
          reason: `The AI analysis groups an unknown promise (${promiseKey}) into this performance obligation. The relationship was not applied.`,
          guidanceIds: aiPo.guidanceIds,
          citations: aiPo.citations,
          value: promiseKey,
          material: { unknownPromiseKey: promiseKey, ...poMaterial(aiPo) },
          aiReviewState: aiPo.reviewState,
          blocking: true,
        });
        continue;
      }
      mappedPromiseIds.push(promiseId);
    }

    const hostManualPoIds = new Set(
      mappedPromiseIds
        .map((id) => draft.promises.find((row) => row.id === id)?.performanceObligationId ?? null)
        .filter((id): id is string => id !== null && manualPoIds.has(id)),
    );

    if (hostManualPoIds.size > 1) {
      // The model's grouping contradicts the accountant's own structure. ARC
      // neither re-points their promises nor adds a third performance
      // obligation; it refuses and asks.
      raise({
        targetKey: `po:${aiPo.semanticKey}`,
        section,
        reasonCode: "unsafe_semantic_relationship",
        reason:
          "The AI analysis groups promises you have already assigned to different performance obligations. Nothing was changed and no new performance obligation was created.",
        guidanceIds: aiPo.guidanceIds,
        citations: aiPo.citations,
        value: {
          manualPoIds: [...hostManualPoIds].sort(),
          semanticKey: aiPo.semanticKey,
          proposed: aiPo.description.slice(0, 120),
        },
        material: { manualPoIds: [...hostManualPoIds].sort(), ...poMaterial(aiPo) },
        aiReviewState: aiPo.reviewState,
        blocking: true,
      });
      continue;
    }

    let canonicalId: string;
    let manualHost = false;
    const singleManualHost = [...hostManualPoIds][0];
    if (singleManualHost !== undefined && objectProvenance[aiPo.semanticKey] === undefined) {
      canonicalId = singleManualHost;
      manualHost = true;
      raise({
        targetKey: `po:${canonicalId}`,
        section,
        reasonCode: "manual_structure_preserved",
        reason:
          "The AI analysis proposes a performance obligation grouping you have already recorded. Your performance obligation and its promise assignments were kept and no duplicate was created.",
        guidanceIds: aiPo.guidanceIds,
        citations: aiPo.citations,
        value: {
          manualPoId: canonicalId,
          semanticKey: aiPo.semanticKey,
          proposed: aiPo.description.slice(0, 120),
        },
        material: { manualPoId: canonicalId, ...poMaterial(aiPo) },
        aiReviewState: aiPo.reviewState,
      });
    } else {
      canonicalId = canonicalIdFor("performance_obligation", aiPo.semanticKey);
      if (draft.performanceObligations.every((po) => po.id !== canonicalId)) {
        draft.performanceObligations = [
          ...draft.performanceObligations,
          createPoDraft(draft.performanceObligations.length + 1, canonicalId),
        ];
      }
    }
    poIdBySemanticKey.set(aiPo.semanticKey, canonicalId);

    const update = (patch: Partial<PoDraft>) => {
      draft.performanceObligations = draft.performanceObligations.map((po) =>
        po.id === canonicalId ? { ...po, ...patch } : po,
      );
    };
    const current = () => draft.performanceObligations.find((po) => po.id === canonicalId)!;

    mergeText({
      key: fieldKeys.po(canonicalId, "name"),
      semanticKey: aiPo.semanticKey,
      current: current().name,
      proposed: aiPo.description,
      apply: (value) => update({ name: value }),
      section,
      guidanceIds: aiPo.guidanceIds,
      citations: aiPo.citations,
      aiReviewState: aiPo.reviewState,
      label: "Performance obligation name",
    });

    // Promise → PO relationships always travel through canonical IDs; a Terra
    // semantic key is never written into `performanceObligationId`.
    for (const promiseId of mappedPromiseIds) {
      const promiseRow = draft.promises.find((promise) => promise.id === promiseId)!;
      mergeScalar<string | null>({
        key: fieldKeys.promise(promiseId, "performanceObligationId"),
        semanticKey: aiPo.semanticKey,
        current: promiseRow.performanceObligationId,
        proposed: canonicalId,
        unclaimed: promiseRow.performanceObligationId === null,
        apply: (value) => {
          draft.promises = draft.promises.map((promise) =>
            promise.id === promiseId ? { ...promise, performanceObligationId: value } : promise,
          );
        },
        section,
        guidanceIds: aiPo.guidanceIds,
        citations: aiPo.citations,
        aiReviewState: aiPo.reviewState,
        label: "Performance obligation assignment",
      });
    }

    // Classification is derived from the canonical distinct conclusion, never
    // from grouping prose, and `series` is never inferred.
    let classification: PoDraft["classification"] = null;
    if (mappedPromiseIds.length === 1) {
      const promiseRow = draft.promises.find((row) => row.id === mappedPromiseIds[0]!)!;
      if (
        promiseRow.capableOfBeingDistinct === true &&
        promiseRow.distinctWithinContractContext === true
      ) {
        classification = "single_distinct";
      }
    } else if (mappedPromiseIds.length > 1) {
      classification = "bundle_not_distinct";
    }

    if (classification !== null) {
      mergeScalar<PoDraft["classification"]>({
        key: fieldKeys.po(canonicalId, "classification"),
        semanticKey: aiPo.semanticKey,
        current: current().classification,
        proposed: classification,
        unclaimed: current().classification === null,
        apply: (value) => update({ classification: value }),
        section,
        guidanceIds: aiPo.guidanceIds,
        citations: aiPo.citations,
        aiReviewState: aiPo.reviewState,
        label: "Performance obligation classification",
      });
      // The grouping rationale explains the classification. It is written only
      // where ARC owns the classification it purports to explain.
      if (
        fieldProvenance[fieldKeys.po(canonicalId, "classification")]?.state ===
        "ai_generated_untouched"
      ) {
        mergeText({
          key: fieldKeys.po(canonicalId, "classificationRationale"),
          semanticKey: aiPo.semanticKey,
          current: current().classificationRationale,
          proposed: aiPo.groupingRationale,
          apply: (value) => update({ classificationRationale: value }),
          section,
          guidanceIds: aiPo.guidanceIds,
          citations: aiPo.citations,
          aiReviewState: aiPo.reviewState,
          label: "Classification rationale",
        });
      }
    } else if (current().classification === null) {
      raise({
        targetKey: fieldKeys.po(canonicalId, "classification"),
        section,
        reasonCode: "missing_required_input",
        reason:
          "ARC could not determine this performance obligation's classification deterministically. Select it yourself.",
        guidanceIds: aiPo.guidanceIds,
        citations: aiPo.citations,
        value: null,
        material: { performanceObligationId: canonicalId, ...poMaterial(aiPo) },
        aiReviewState: aiPo.reviewState,
        blocking: true,
      });
    }

    // A preserved manual performance obligation stays manual: ARC does not
    // claim ownership of a row the accountant built.
    if (!manualHost) claimObject(aiPo.semanticKey, canonicalId);
  }

  /* ----------------------------------------------------------- recognition */

  for (const proposal of analysis.recognitionProposals) {
    const canonicalId = poIdBySemanticKey.get(proposal.performanceObligationKey);
    const section = sectionFor(proposal.guidanceIds, "step_5");
    if (canonicalId === undefined) {
      raise({
        targetKey: `recognition:${proposal.performanceObligationKey}`,
        section,
        reasonCode: "unsafe_semantic_relationship",
        reason:
          "A recognition proposal refers to a performance obligation ARC did not create. It was not applied.",
        guidanceIds: proposal.guidanceIds,
        citations: proposal.citations,
        value: proposal.performanceObligationKey,
        material: recognitionMaterial(proposal),
        aiReviewState: proposal.reviewState,
        blocking: true,
      });
      continue;
    }
    const update = (patch: Partial<PoDraft>) => {
      draft.performanceObligations = draft.performanceObligations.map((po) =>
        po.id === canonicalId ? { ...po, ...patch } : po,
      );
    };
    const current = () => draft.performanceObligations.find((po) => po.id === canonicalId)!;

    const mapping = mapRecognitionMethod(proposal.recognitionMethod);
    if (!mapping.supported) {
      if (current().recognitionMethod === null) {
        raise({
          targetKey: fieldKeys.po(canonicalId, "recognitionMethod"),
          section,
          reasonCode:
            mapping.reason === "engine_support_gap"
              ? "unsupported_recognition_method"
              : "missing_required_input",
          reason:
            mapping.reason === "engine_support_gap"
              ? `ARC's deterministic engine recognizes revenue ratably over time or at a point in time. The proposed ${proposal.recognitionMethod.replace("_", " ")} is not supported, so no recognition method was set.`
              : "The AI analysis could not determine a recognition method. Select one yourself.",
          guidanceIds: proposal.guidanceIds,
          citations: proposal.citations,
          value: null,
          material: recognitionMaterial(proposal),
          aiReviewState: proposal.reviewState,
          blocking: true,
        });
      }
      continue;
    }

    mergeScalar<PoDraft["recognitionMethod"]>({
      key: fieldKeys.po(canonicalId, "recognitionMethod"),
      semanticKey: proposal.performanceObligationKey,
      current: current().recognitionMethod,
      proposed: mapping.method,
      unclaimed: current().recognitionMethod === null,
      apply: (value) => update({ recognitionMethod: value }),
      section,
      guidanceIds: proposal.guidanceIds,
      citations: proposal.citations,
      aiReviewState: proposal.reviewState,
      label: "Recognition method",
    });
    // Phase 9G-R3 L. The over-time MEASURE is its own AI-owned canonical fact,
    // merged through the same provenance machinery: an accountant-owned measure
    // is preserved, never silently overwritten by a later re-analysis.
    if (mapping.overTimeMeasure !== undefined) {
      mergeScalar<PoDraft["overTimeMeasure"]>({
        key: fieldKeys.po(canonicalId, "overTimeMeasure"),
        semanticKey: proposal.performanceObligationKey,
        current: current().overTimeMeasure,
        proposed: mapping.overTimeMeasure,
        unclaimed: current().overTimeMeasure === undefined,
        apply: (value) => update({ overTimeMeasure: value }),
        section,
        guidanceIds: proposal.guidanceIds,
        citations: proposal.citations,
        aiReviewState: proposal.reviewState,
        label: "Measure of progress",
      });
    }
    // The rationale and the AI-derived service dates explain the AI method.
    // If the accountant owns the method, none of them may be attached to it.
    const methodIsAiOwned =
      fieldProvenance[fieldKeys.po(canonicalId, "recognitionMethod")]?.state ===
      "ai_generated_untouched";
    if (methodIsAiOwned) {
      mergeText({
        key: fieldKeys.po(canonicalId, "recognitionRationale"),
        semanticKey: proposal.performanceObligationKey,
        current: current().recognitionRationale,
        proposed: proposal.rationale,
        apply: (value) => update({ recognitionRationale: value }),
        section,
        guidanceIds: proposal.guidanceIds,
        citations: proposal.citations,
        aiReviewState: proposal.reviewState,
        label: "Recognition rationale",
      });
    }

    // An input-measure obligation is measured by units incurred, not by a
    // calendar period, so no service period is demanded of it here.
    const usesInputMeasure = current().overTimeMeasure === "input_measure";
    if (mapping.method === "over_time_ratable" && !usesInputMeasure) {
      const start = parseIsoDate(proposal.serviceStartDate);
      const end = parseIsoDate(proposal.serviceEndDate);
      if (start !== null && end !== null && methodIsAiOwned) {
        mergeText({
          key: fieldKeys.po(canonicalId, "serviceStart"),
          semanticKey: proposal.performanceObligationKey,
          current: current().serviceStart,
          proposed: start,
          apply: (value) => update({ serviceStart: value as IsoDate }),
          section,
          guidanceIds: proposal.guidanceIds,
          citations: proposal.citations,
          aiReviewState: proposal.reviewState,
          label: "Service start",
        });
        mergeText({
          key: fieldKeys.po(canonicalId, "serviceEnd"),
          semanticKey: proposal.performanceObligationKey,
          current: current().serviceEnd,
          proposed: end,
          apply: (value) => update({ serviceEnd: value as IsoDate }),
          section,
          guidanceIds: proposal.guidanceIds,
          citations: proposal.citations,
          aiReviewState: proposal.reviewState,
          label: "Service end",
        });
      } else if (current().serviceStart === "" || current().serviceEnd === "") {
        raise({
          targetKey: fieldKeys.po(canonicalId, "servicePeriod"),
          section,
          reasonCode: "missing_required_input",
          reason:
            "The service period could not be read as exact calendar dates, so it was left blank. Enter the start and end dates.",
          guidanceIds: proposal.guidanceIds,
          citations: proposal.citations,
          value: null,
          material: recognitionMaterial(proposal),
          aiReviewState: proposal.reviewState,
          blocking: true,
        });
      }
    } else {
      const date = parseIsoDate(proposal.recognitionDateIfContractuallyDeterminable);
      if (date !== null && methodIsAiOwned) {
        mergeText({
          key: fieldKeys.po(canonicalId, "recognitionDate"),
          semanticKey: proposal.performanceObligationKey,
          current: current().recognitionDate,
          proposed: date,
          apply: (value) => update({ recognitionDate: value as IsoDate }),
          section,
          guidanceIds: proposal.guidanceIds,
          citations: proposal.citations,
          aiReviewState: proposal.reviewState,
          label: "Recognition date",
        });
      } else if (current().recognitionDate === "") {
        raise({
          targetKey: fieldKeys.po(canonicalId, "recognitionDate"),
          section,
          reasonCode: "missing_required_input",
          reason:
            "The point-in-time recognition date is not contractually determinable. Enter the transfer date.",
          guidanceIds: proposal.guidanceIds,
          citations: proposal.citations,
          value: null,
          material: recognitionMaterial(proposal),
          aiReviewState: proposal.reviewState,
          blocking: true,
        });
      }
    }
  }

  /* ------------------------------------------------------------------- SSP */

  /** Phase 9G-R Task R2. Every provisionally priced obligation, in one group. */
  const provisionalSsp: Array<{
    item: (typeof analysis.sspAndAllocation.items)[number];
    canonicalId: string;
    amount: string;
  }> = [];

  for (const item of analysis.sspAndAllocation.items) {
    const canonicalId = poIdBySemanticKey.get(item.appliesToKey);
    const section = sectionFor(item.guidanceIds, "step_4");
    if (canonicalId === undefined) {
      raise({
        targetKey: `ssp:${item.semanticKey}`,
        section,
        reasonCode: "unsafe_semantic_relationship",
        reason:
          "A standalone selling price refers to a performance obligation ARC did not create. It was not applied.",
        guidanceIds: item.guidanceIds,
        citations: item.citations,
        value: item.appliesToKey,
        material: sspMaterial(item),
        aiReviewState: item.reviewState,
        blocking: true,
      });
      continue;
    }
    const update = (patch: Partial<PoDraft>) => {
      draft.performanceObligations = draft.performanceObligations.map((po) =>
        po.id === canonicalId ? { ...po, ...patch } : po,
      );
    };
    const current = () => draft.performanceObligations.find((po) => po.id === canonicalId)!;

    const amount = usableAmount(item.observedAmountInput);
    const provisionalAmount = usableAmount(item.proposedSspAmountInput);
    // Phase 9G-R Task R2. A separately stated contract price may be used as a
    // PROVISIONAL standalone selling price so the workpaper can be drafted and
    // allocated — it is never observable evidence and never silently accepted:
    // one consolidated yellow item below asks the accountant to confirm it.
    const provisional =
      !(item.observableSspEvidence === "observable" && amount !== null) &&
      item.proposedMethod === "stated_contract_price_assumption" &&
      provisionalAmount !== null &&
      isUnclaimedString(current().sspInput);

    // ARC never assumes the contract price is the standalone selling price.
    if (item.observableSspEvidence === "observable" && amount !== null) {
      mergeText({
        key: fieldKeys.po(canonicalId, "sspInput"),
        semanticKey: item.semanticKey,
        current: current().sspInput,
        proposed: amount,
        apply: (value) => update({ sspInput: value }),
        section,
        guidanceIds: item.guidanceIds,
        citations: item.citations,
        aiReviewState: item.reviewState,
        label: "Standalone selling price",
      });
      // The basis explains the amount; it is only written when ARC owns it.
      if (
        fieldProvenance[fieldKeys.po(canonicalId, "sspInput")]?.state === "ai_generated_untouched"
      ) {
        mergeText({
          key: fieldKeys.po(canonicalId, "sspBasis"),
          semanticKey: item.semanticKey,
          current: current().sspBasis,
          proposed: item.methodRationale,
          apply: (value) => update({ sspBasis: value }),
          section,
          guidanceIds: item.guidanceIds,
          citations: item.citations,
          aiReviewState: item.reviewState,
          label: "Standalone selling price basis",
        });
      }
    } else if (provisional) {
      mergeText({
        key: fieldKeys.po(canonicalId, "sspInput"),
        semanticKey: item.semanticKey,
        current: current().sspInput,
        proposed: provisionalAmount!,
        apply: (value) => update({ sspInput: value }),
        section,
        guidanceIds: item.guidanceIds,
        citations: item.citations,
        aiReviewState: item.reviewState,
        label: "Standalone selling price",
      });
      if (
        fieldProvenance[fieldKeys.po(canonicalId, "sspInput")]?.state === "ai_generated_untouched"
      ) {
        mergeText({
          key: fieldKeys.po(canonicalId, "sspBasis"),
          semanticKey: item.semanticKey,
          current: current().sspBasis,
          proposed: item.methodRationale,
          apply: (value) => update({ sspBasis: value }),
          section,
          guidanceIds: item.guidanceIds,
          citations: item.citations,
          aiReviewState: item.reviewState,
          label: "Standalone selling price basis",
        });
      }
      provisionalSsp.push({ item, canonicalId, amount: provisionalAmount! });
    } else if (isUnclaimedString(current().sspInput)) {
      raise({
        targetKey: fieldKeys.po(canonicalId, "sspInput"),
        section,
        reasonCode: "missing_ssp",
        reason: `A standalone selling price is required to allocate the transaction price and the contract does not evidence one. ${item.missingInformation}`,
        guidanceIds: item.guidanceIds,
        citations: item.citations,
        value: null,
        material: sspMaterial(item),
        aiReviewState: item.reviewState,
        blocking: true,
      });
    }
  }

  // One consolidated judgment for the whole provisional-SSP basis. Not one
  // item per obligation: the accountant confirms the basis once, against a
  // real canonical fingerprint of the entire Step 4 SSP workpaper.
  if (provisionalSsp.length > 0) {
    const names = provisionalSsp
      .map(({ canonicalId }) => draft.performanceObligations.find((po) => po.id === canonicalId))
      .map((po, index) => po?.name?.trim() || `Performance obligation ${index + 1}`);
    raise({
      targetKey: PROVISIONAL_SSP_TARGET_KEY,
      section: "step_4",
      reasonCode: "provisional_ssp_basis",
      reason: `ARC used the separately stated contract price as a provisional standalone selling price for ${names.join(", ")}. The contract evidences no observable standalone selling price, so confirm this basis or enter your own.`,
      guidanceIds: [...new Set(provisionalSsp.flatMap(({ item }) => item.guidanceIds))].sort(
        (a, b) => a - b,
      ),
      citations: provisionalSsp.flatMap(({ item }) => item.citations),
      value: provisionalSsp.map(({ amount }) => amount).join("|"),
      material: {
        provisionalSsp: provisionalSsp
          .map(({ canonicalId, amount, item }) => ({
            id: canonicalId,
            amount,
            method: item.proposedMethod,
          }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      },
      aiReviewState: "inference",
      blocking: false,
    });
  }

  /* ------------------------------------------------------- transaction price */

  // Model arithmetic is never authoritative. When the contract's own billing
  // schedule unambiguously determines the full-term fixed total, ARC's
  // deterministic total is the canonical amount whatever the model reported —
  // a period fee, the correct total, a wrong total or nothing at all. The
  // model's validated full-term conclusion is used only when no unambiguous
  // schedule exists, and neither ever overwrites the accountant's own amount.
  const fixedDerivation = deriveUnambiguousFixedBillingTotal({
    billingTerms: analysis.billingTerms,
    servicePeriod: deriveContractServicePeriod(draft),
  });
  const proposedFixed = usableAmount(analysis.transactionPrice.fixedConsiderationInput);
  const derivedTotal = fixedDerivation.ok ? fixedDerivation.totalInput : null;
  const fixed = derivedTotal ?? proposedFixed;
  if (fixed !== null) {
    mergeText({
      key: fieldKeys.transactionPrice("input"),
      semanticKey: "transaction-price:fixed",
      current: draft.transactionPriceInput,
      proposed: fixed,
      apply: (value) => {
        draft.transactionPriceInput = value;
      },
      section: sectionFor(
        analysis.transactionPrice.transactionPriceConclusion.guidanceIds,
        "step_3",
      ),
      guidanceIds: analysis.transactionPrice.transactionPriceConclusion.guidanceIds,
      citations: analysis.transactionPrice.transactionPriceConclusion.citations,
      aiReviewState: analysis.transactionPrice.transactionPriceConclusion.reviewState,
      label: "Fixed transaction price",
    });
    // An AI explanation is only ever written for an AI-owned amount. Attaching
    // the model's reasoning about a different number to the accountant's own
    // transaction price would make the audit trail self-contradictory.
    if (fieldProvenance[fieldKeys.transactionPrice("input")]?.state === "ai_generated_untouched") {
      mergeText({
        key: fieldKeys.transactionPrice("notes"),
        semanticKey: "transaction-price:fixed",
        current: draft.transactionPriceNotes,
        // When ARC replaced the amount, the note must describe ARC's own
        // derivation. Keeping the model's wording beside a different number
        // would make the audit trail self-contradictory.
        proposed:
          derivedTotal !== null && fixedDerivation.ok
            ? `ARC derived the full-term fixed consideration of ${derivedTotal} from the contract's ${fixedDerivation.frequency.replace(/_/g, " ")} billing schedule of ${fixedDerivation.amountInput} across ${fixedDerivation.eventCount} billing periods in the contract service period.`
            : `${analysis.transactionPrice.fixedConsiderationRationale}\n\n${analysis.transactionPrice.transactionPriceConclusion.conclusion}`,
        apply: (value) => {
          draft.transactionPriceNotes = value;
        },
        section: "step_3",
        guidanceIds: analysis.transactionPrice.transactionPriceConclusion.guidanceIds,
        citations: analysis.transactionPrice.transactionPriceConclusion.citations,
        aiReviewState: analysis.transactionPrice.transactionPriceConclusion.reviewState,
        label: "Transaction price notes",
      });
    }
  } else if (isUnclaimedString(draft.transactionPriceInput)) {
    raise({
      targetKey: fieldKeys.transactionPrice("input"),
      section: "step_3",
      reasonCode: "missing_required_input",
      reason:
        "No exact fixed consideration amount was determinable from the contract. Enter the transaction price.",
      guidanceIds: analysis.transactionPrice.transactionPriceConclusion.guidanceIds,
      // The evidence of this conclusion is both the fixed-consideration
      // evidence and the transaction-price conclusion's own evidence.
      citations: [
        ...analysis.transactionPrice.fixedConsiderationCitations,
        ...analysis.transactionPrice.transactionPriceConclusion.citations,
      ],
      value: null,
      material: {
        fixedConsiderationInput: analysis.transactionPrice.fixedConsiderationInput,
        fixedConsiderationRationale: analysis.transactionPrice.fixedConsiderationRationale,
        currency: analysis.transactionPrice.currency.value,
        currencyRationale: analysis.transactionPrice.currency.rationale,
        conclusion: analysis.transactionPrice.transactionPriceConclusion.conclusion,
        conclusionRationale: analysis.transactionPrice.transactionPriceConclusion.rationale,
      },
      aiReviewState: "needs_user_input",
      blocking: true,
    });
  }

  for (const judgment of [
    {
      key: "financing",
      value: analysis.transactionPrice.financingAssessment,
      label: "Significant financing component",
    },
    {
      key: "noncash",
      value: analysis.transactionPrice.noncashConsideration,
      label: "Noncash consideration",
    },
    {
      key: "payableToCustomer",
      value: analysis.transactionPrice.considerationPayableToCustomer,
      label: "Consideration payable to the customer",
    },
  ]) {
    // Phase 9G-R Task R2. A confident "this does not arise here" — no
    // financing component, monetary consideration, nothing payable to the
    // customer — is a routine assumption, not a queue item. Anything the model
    // answered "yes" or could not determine stays advisory and visible.
    const routine =
      judgment.value.outcome === "no" &&
      (judgment.value.reviewState === "supported" || judgment.value.reviewState === "inference");

    // ARC has no canonical field for these; they are advisory review state only.
    raise({
      targetKey: fieldKeys.transactionPrice(judgment.key),
      section: sectionFor(judgment.value.guidanceIds, "step_3"),
      reasonCode: routine ? "routine_assumption" : "advisory_topic",
      reason: `${judgment.label}: ${judgment.value.rationale}`,
      guidanceIds: judgment.value.guidanceIds,
      citations: judgment.value.citations,
      value: judgment.value.outcome,
      material: {
        judgment: judgment.key,
        outcome: judgment.value.outcome,
        rationale: judgment.value.rationale,
      },
      aiReviewState: judgment.value.reviewState,
    });
  }

  /* --------------------------------------------------- variable consideration */

  const manualVcByText = new Map<string, VcComponentDraft>();
  for (const row of manualVcComponents) {
    const text = normalizedText(row.description);
    if (text !== "" && !manualVcByText.has(text)) manualVcByText.set(text, row);
  }

  for (const component of analysis.transactionPrice.variableConsiderationComponents) {
    proposedSemanticKeys.add(component.semanticKey);
    const section = sectionFor(component.guidanceIds, "step_3");
    if (tombstones.has(component.semanticKey)) {
      raise({
        targetKey: `vc:${component.semanticKey}`,
        section,
        reasonCode: "ai_proposal_tombstoned",
        reason:
          "The AI analysis still proposes a variable-consideration component you previously removed. It has not been recreated.",
        guidanceIds: component.guidanceIds,
        citations: component.citations,
        value: component.semanticKey,
        material: vcMaterial(component),
        aiReviewState: "needs_review",
      });
      continue;
    }

    const effect = mapVcEffect(component.type);
    if (effect === null) {
      // `penalty` and `other` have no deterministic direction. ARC refuses to
      // guess an engine effect from prose.
      raise({
        targetKey: `vc:${component.semanticKey}`,
        section,
        reasonCode: "missing_required_input",
        reason: `"${component.description.slice(0, 120)}" could increase or decrease the transaction price. ARC will not guess the direction — record this component yourself.`,
        guidanceIds: component.guidanceIds,
        citations: component.citations,
        value: component.type,
        material: vcMaterial(component),
        aiReviewState: component.reviewState,
        blocking: true,
      });
      continue;
    }

    // An exact normalized description match with an unowned manual component
    // is a duplicate, not a new component. No fuzzy matching is performed.
    const manualVcTwin = manualVcByText.get(normalizedText(component.description));
    if (manualVcTwin !== undefined && objectProvenance[component.semanticKey] === undefined) {
      raise({
        targetKey: `vc:${manualVcTwin.id}`,
        section,
        reasonCode: "manual_structure_preserved",
        reason:
          "The AI analysis proposes a variable-consideration component that matches one you entered manually. Yours was kept and no duplicate was created.",
        guidanceIds: component.guidanceIds,
        citations: component.citations,
        value: {
          manualVcId: manualVcTwin.id,
          semanticKey: component.semanticKey,
          proposed: component.description.slice(0, 120),
        },
        material: { manualVcId: manualVcTwin.id, ...vcMaterial(component) },
        aiReviewState: component.reviewState,
      });
      continue;
    }

    const isUsage = component.type === "usage";
    const proposedTreatment: VcComponentDraft["treatment"] = isUsage
      ? "usage_as_incurred"
      : "estimated";
    const canonicalId = canonicalIdFor("variable_component", component.semanticKey);
    const existingRow = draft.variableConsiderationComponents.find((row) => row.id === canonicalId);
    if (existingRow === undefined) {
      draft.variableConsiderationComponents = [
        ...draft.variableConsiderationComponents,
        {
          ...createVcComponentDraft(
            draft.variableConsiderationComponents.length + 1,
            canonicalId,
            proposedTreatment,
          ),
          effect,
        },
      ];
      // A structural default flag may become true only because ARC added a
      // valid AI-owned child object to an otherwise empty structure.
      draft.hasVariableConsideration = true;
    } else if (existingRow.treatment !== proposedTreatment) {
      // Usage-as-incurred and estimated are different treatment families with
      // different nested structures. Repurposing one into the other would
      // either strand stale values or destroy nested work, so ARC preserves
      // the canonical component and surfaces the structural change instead.
      raise({
        targetKey: fieldKeys.vc(canonicalId, "treatment"),
        section,
        reasonCode: "manual_structure_preserved",
        reason:
          "The latest AI analysis treats this variable consideration as a different kind of component than the one in your workpaper. ARC kept the existing component — review the change yourself.",
        guidanceIds: component.guidanceIds,
        citations: component.citations,
        value: { current: existingRow.treatment, proposed: proposedTreatment },
        material: {
          current: existingRow.treatment,
          proposed: proposedTreatment,
          ...vcMaterial(component),
        },
        aiReviewState: component.reviewState,
        blocking: true,
      });
      claimObject(component.semanticKey, canonicalId);
      continue;
    }
    const update = (patch: Partial<VcComponentDraft>) => {
      draft.variableConsiderationComponents = draft.variableConsiderationComponents.map((row) =>
        row.id === canonicalId ? { ...row, ...patch } : row,
      );
    };
    const current = () =>
      draft.variableConsiderationComponents.find((row) => row.id === canonicalId)!;

    mergeText({
      key: fieldKeys.vc(canonicalId, "description"),
      semanticKey: component.semanticKey,
      current: current().description,
      proposed: component.description,
      apply: (value) => update({ description: value }),
      section,
      guidanceIds: component.guidanceIds,
      citations: component.citations,
      aiReviewState: component.reviewState,
      label: "Variable-consideration description",
    });

    /* --------------------------------------- allocation of this component */

    // A semantic key is never written into a canonical field. A specific
    // allocation requires a real canonical performance obligation; when the
    // proposed target cannot be mapped ARC fails closed to the general
    // treatment and raises the relationship for review.
    const allocationProposal = component.allocationTreatmentProposal;
    const targetKey = component.targetPerformanceObligationKey;
    const needsTarget =
      allocationProposal === "specific_po" || allocationProposal === "specific_series_period";
    const mappedTargetPoId =
      targetKey === null || targetKey.trim() === ""
        ? null
        : (poIdBySemanticKey.get(targetKey) ?? null);

    if (needsTarget && mappedTargetPoId === null) {
      raise({
        targetKey: fieldKeys.vc(canonicalId, "allocation"),
        section,
        reasonCode: "unsafe_semantic_relationship",
        reason:
          "The AI analysis allocates this variable consideration to a specific performance obligation ARC could not identify in your workpaper. It was left allocated across the contract — set the allocation yourself.",
        guidanceIds: component.guidanceIds,
        citations: component.citations,
        value: { proposedTreatment: allocationProposal, targetKey },
        material: { proposedTreatment: allocationProposal, targetKey, ...vcMaterial(component) },
        aiReviewState: component.reviewState,
        blocking: true,
      });
    } else if (allocationProposal !== "unknown") {
      // The allocation of a variable-consideration component is ONE accounting
      // judgment: its treatment, its specific target, the two ASC 606-85
      // conclusions and the supporting rationale stand or fall together. Every
      // value AI writes carries its own field provenance so a later run can
      // tell whether the accountant changed it, and an edit to any material
      // field makes the whole judgment theirs — surfaced as a single
      // difference, never five, and never silently overwritten.
      const allocationUnclaimed =
        current().targetPoId === null &&
        current().relatesSpecifically === null &&
        current().consistentWithAllocationObjective === null &&
        isUnclaimedString(current().allocationRationale);

      const allocationSpecs = [
        {
          key: fieldKeys.vc(canonicalId, "allocationTreatment"),
          label: "Allocation treatment",
          current: current().allocationTreatment as unknown,
          proposed: allocationProposal as unknown,
          apply: () => update({ allocationTreatment: allocationProposal }),
        },
        {
          key: fieldKeys.vc(canonicalId, "targetPoId"),
          label: "Allocation target performance obligation",
          current: current().targetPoId as unknown,
          proposed: (needsTarget ? mappedTargetPoId : null) as unknown,
          apply: () => update({ targetPoId: needsTarget ? mappedTargetPoId : null }),
        },
        {
          key: fieldKeys.vc(canonicalId, "relatesSpecifically"),
          label: "Relates specifically to the performance obligation",
          current: current().relatesSpecifically as unknown,
          proposed: mapOutcome(component.relatesSpecifically) as unknown,
          apply: () => update({ relatesSpecifically: mapOutcome(component.relatesSpecifically) }),
        },
        {
          key: fieldKeys.vc(canonicalId, "consistentWithAllocationObjective"),
          label: "Consistent with the allocation objective",
          current: current().consistentWithAllocationObjective as unknown,
          proposed: mapOutcome(component.consistentWithAllocationObjective) as unknown,
          apply: () =>
            update({
              consistentWithAllocationObjective: mapOutcome(
                component.consistentWithAllocationObjective,
              ),
            }),
        },
        {
          key: fieldKeys.vc(canonicalId, "allocationRationale"),
          label: "Allocation rationale",
          current: current().allocationRationale as unknown,
          proposed: component.allocationRationale as unknown,
          apply: () => update({ allocationRationale: component.allocationRationale }),
        },
      ];

      type AllocationOwnership = "prior_finalized" | "manual_from_start" | "user_edited" | null;
      let ownership: AllocationOwnership = null;
      for (const spec of allocationSpecs) {
        const prior = fieldProvenance[spec.key];
        if (prior?.state === "prior_finalized") {
          ownership = "prior_finalized";
          break;
        }
        if (prior === undefined) {
          if (!allocationUnclaimed && ownership === null) ownership = "manual_from_start";
        } else if (prior.state === "manual_from_start") {
          if (ownership === null) ownership = "manual_from_start";
        } else if (valueFingerprint(spec.current) !== prior.valueFingerprint) {
          if (ownership === null) ownership = "user_edited";
        }
      }

      const anyDiffers = allocationSpecs.some(
        (spec) => valueFingerprint(spec.current) !== valueFingerprint(spec.proposed),
      );

      if (ownership === null) {
        for (const spec of allocationSpecs) {
          spec.apply();
          fieldProvenance[spec.key] = {
            state: "ai_generated_untouched",
            semanticKey: component.semanticKey,
            lastAiRunId: runId,
            valueFingerprint: valueFingerprint(spec.proposed),
          };
        }
      } else {
        for (const spec of allocationSpecs) {
          const prior = fieldProvenance[spec.key];
          const differsField = valueFingerprint(spec.current) !== valueFingerprint(spec.proposed);
          if (prior === undefined) {
            fieldProvenance[spec.key] = {
              state: "manual_from_start",
              semanticKey: component.semanticKey,
              lastAiRunId: null,
              valueFingerprint: valueFingerprint(spec.current),
            };
          } else if (prior.state === "manual_from_start" || prior.state === "prior_finalized") {
            fieldProvenance[spec.key] = { ...prior, semanticKey: component.semanticKey };
          } else {
            fieldProvenance[spec.key] = {
              state: differsField
                ? "ai_difference_preserved_user_override"
                : "ai_generated_user_edited",
              semanticKey: component.semanticKey,
              lastAiRunId: prior.lastAiRunId,
              valueFingerprint: prior.valueFingerprint,
            };
          }
        }
        if (anyDiffers) {
          const preservedAllocation = {
            allocationTreatment: current().allocationTreatment,
            targetPoId: current().targetPoId,
            relatesSpecifically: current().relatesSpecifically,
            consistentWithAllocationObjective: current().consistentWithAllocationObjective,
            allocationRationale: current().allocationRationale,
          };
          const proposedAllocation = {
            allocationTreatment: allocationProposal,
            targetPoId: needsTarget ? mappedTargetPoId : null,
            targetKey,
            relatesSpecifically: mapOutcome(component.relatesSpecifically),
            consistentWithAllocationObjective: mapOutcome(
              component.consistentWithAllocationObjective,
            ),
            allocationRationale: component.allocationRationale,
          };
          raise({
            targetKey: fieldKeys.vc(canonicalId, "allocation"),
            section,
            reasonCode:
              ownership === "prior_finalized"
                ? "prior_finalized_conflict"
                : "manual_value_preserved",
            reason:
              "Variable-consideration allocation: your recorded allocation judgment was kept; the AI analysis proposed a different allocation.",
            guidanceIds: component.guidanceIds,
            citations: component.citations,
            value: {
              preservedValue: preservedAllocation,
              proposedValue: proposedAllocation,
            },
            // The whole allocation judgment is the material: a change to the
            // target, either ASC 606-85 conclusion, the treatment or the
            // rationale must reopen the item rather than inherit a resolution.
            material: {
              preserved: preservedAllocation,
              proposed: proposedAllocation,
              ...vcMaterial(component),
            },
            aiReviewState: component.reviewState,
            blocking: ownership === "prior_finalized",
          });
        }
      }
    }

    if (isUsage) {
      const rate = usableAmount(component.contractualRateOrAmountInput);
      const meterId = `${canonicalId}-m1`;
      if (rate !== null) {
        let meterCreated = false;
        if (current().meters.length === 0) {
          // Future usage volume is never invented, so no usage period is added.
          update({ meters: [createVcMeterDraft(1, meterId)], usagePeriods: [] });
          meterCreated = true;
        }
        const meter = () => current().meters.find((row) => row.id === meterId);
        if (meter() !== undefined) {
          const patchMeter = (patch: Partial<VcMeterDraft>) =>
            update({
              meters: current().meters.map((row) =>
                row.id === meterId ? { ...row, ...patch } : row,
              ),
            });
          // Every meter field is tracked through field provenance, so a later
          // contractual rate change refreshes an untouched AI meter instead of
          // silently going stale — and never overwrites an edited one.
          const meterFields = [
            { field: "name" as const, proposed: component.description.slice(0, 120) },
            { field: "rateAmountInput" as const, proposed: rate },
            // A contractual per-unit rate is a one-unit rate.
            { field: "rateQuantityInput" as const, proposed: "1" },
            {
              field: "unit" as const,
              proposed: (component.unitDescription ?? "unit").replace(/^per\s+/i, ""),
            },
          ];
          for (const spec of meterFields) {
            mergeScalar<string>({
              key: fieldKeys.vc(canonicalId, `meter.${spec.field}`),
              semanticKey: component.semanticKey,
              current: meter()![spec.field],
              proposed: spec.proposed,
              unclaimed: meterCreated || isUnclaimedString(meter()![spec.field]),
              apply: (value) => patchMeter({ [spec.field]: value } as Partial<VcMeterDraft>),
              section,
              guidanceIds: component.guidanceIds,
              citations: component.citations,
              aiReviewState: component.reviewState,
              label: `Usage meter ${spec.field}`,
            });
          }
        }
      }
      raise({
        targetKey: fieldKeys.vc(canonicalId, "usagePeriods"),
        section,
        reasonCode: "missing_required_input",
        reason:
          "Usage-based consideration is recognized as usage occurs. Enter actual usage quantities — ARC never forecasts volume from the contract.",
        guidanceIds: component.guidanceIds,
        citations: component.citations,
        value: null,
        material: vcMaterial(component),
        aiReviewState: "needs_user_input",
        blocking: true,
      });
    } else {
      // Post-R2 live regression patch. A zero-at-inception routine assumption
      // must be COMPLETE and internally valid, or the deterministic engine
      // rejects ARC's own supposedly nonblocking draft. It is decided before
      // the estimation method is merged, because a nil assumption is a most
      // likely amount of $0 — never an expected-value distribution that would
      // then demand probabilities the contract cannot supply.
      // Post-R2 acceptance patch. Blank amount fields alone do NOT prove the
      // inception judgment is unclaimed: an accountant may own the estimation
      // method, an outcome probability, a most-likely designation or the
      // constraint rationale while the amounts are still empty. Rewriting over
      // that would destroy their work and could leave an internally
      // inconsistent assessment, so every material part of the judgment must be
      // either genuinely empty or ARC's own untouched draft (which keeps
      // re-analysis deterministic).
      const inceptionKey = fieldKeys.vc(canonicalId, "inception");
      const methodKey = fieldKeys.vc(canonicalId, "estimationMethod");
      const inceptionAiOwned = fieldProvenance[inceptionKey]?.state === "ai_generated_untouched";
      const inceptionEmpty =
        isUnclaimedString(current().inception.includedInput) &&
        isUnclaimedString(current().inception.constraintRationale) &&
        current().inception.outcomes.every(
          (outcome) =>
            isUnclaimedString(outcome.amountInput) &&
            isUnclaimedString(outcome.probabilityInput) &&
            outcome.isMostLikely !== true,
        );
      // The effective date is exempt: a manually supplied assessment date is
      // preserved, not treated as ownership of the estimation judgment.
      const methodUnclaimed =
        current().estimationMethod === null ||
        fieldProvenance[methodKey]?.state === "ai_generated_untouched";
      const zeroCandidate =
        component.initialEstimateBasis === "zero_no_expected_trigger" &&
        methodUnclaimed &&
        (inceptionAiOwned || inceptionEmpty);
      // The inception date is taken from an authoritative canonical date ARC
      // already holds. If there is none, the assumption fails closed on the
      // missing date rather than inventing one.
      const inceptionDate = zeroCandidate ? canonicalInceptionDate(draft) : null;
      const zeroAtInception = zeroCandidate && inceptionDate !== null;

      const method = zeroAtInception
        ? "most_likely_amount"
        : mapEstimationMethod(component.estimationMethodProposal);
      if (method !== null) {
        mergeScalar<VcComponentDraft["estimationMethod"]>({
          key: fieldKeys.vc(canonicalId, "estimationMethod"),
          semanticKey: component.semanticKey,
          current: current().estimationMethod,
          proposed: method,
          unclaimed: current().estimationMethod === null,
          apply: (value) => update({ estimationMethod: value }),
          section,
          guidanceIds: component.guidanceIds,
          citations: component.citations,
          aiReviewState: component.reviewState,
          label: "Estimation method",
        });
      }
      // Phase 9G-R Task R2. Where the evidence gives no indication a trigger
      // is expected — the ordinary service-level-credit case — the honest
      // initial estimate is zero, and ARC drafts it as a stated assumption
      // instead of blocking the whole workpaper. Zero is never invented: the
      // model must have concluded it explicitly, with both amounts exactly 0.
      const assessment = current().inception;

      if (zeroAtInception) {
        mergeScalar<string>({
          key: fieldKeys.vc(canonicalId, "inception"),
          semanticKey: component.semanticKey,
          current: assessment.includedInput,
          proposed: "0",
          unclaimed: true,
          // The whole inception assessment is written as one complete, valid
          // most-likely-amount assumption: a single $0 most-likely outcome, $0
          // included, the authoritative inception date and the model's own
          // rationale. No probability is required, and nothing here overwrites
          // an accountant-owned assessment — it is reached only when every
          // inception amount was still unclaimed.
          apply: (value) =>
            update({
              inception: {
                ...current().inception,
                effectiveDate: current().inception.effectiveDate || inceptionDate!,
                includedInput: value,
                outcomes: current()
                  .inception.outcomes.slice(0, 1)
                  .map((outcome) => ({
                    ...outcome,
                    amountInput: value,
                    probabilityInput: "",
                    isMostLikely: true,
                  })),
                constraintRationale: component.initialEstimateRationale,
              },
            }),
          section,
          guidanceIds: component.guidanceIds,
          citations: component.citations,
          aiReviewState: component.reviewState,
          label: "Initial variable-consideration estimate",
        });
        raise({
          targetKey: fieldKeys.vc(canonicalId, "inception"),
          section,
          reasonCode: "routine_assumption",
          reason: `Initial estimate of nil for "${component.description.slice(0, 80)}": the contract gives no indication of an expected trigger. ${component.initialEstimateRationale}`,
          guidanceIds: component.guidanceIds,
          citations: component.citations,
          value: "0",
          material: vcMaterial(component),
          aiReviewState:
            component.reviewState === "source_conflict" ? component.reviewState : "inference",
          blocking: false,
        });
      } else {
        // Outcome probabilities, the constrained included amount and any
        // resolution amount are deliberately left blank rather than invented.
        // A nil assumption with no defensible contract date fails closed here
        // on the missing date rather than assuming when the estimate was made.
        raise({
          targetKey: fieldKeys.vc(canonicalId, "inception"),
          section,
          reasonCode: "missing_required_input",
          reason: zeroCandidate
            ? `The contract gives no indication of an expected trigger for "${component.description.slice(0, 80)}", but it carries no date ARC can use as the date of the estimate. Enter the assessment date and the amount to include.`
            : `Estimate the variable amount and the constrained amount to include for "${component.description.slice(0, 80)}". ${component.constraintAssessment}`,
          guidanceIds: component.guidanceIds,
          citations: component.citations,
          value: null,
          material: vcMaterial(component),
          aiReviewState:
            component.reviewState === "supported" ? "needs_user_input" : component.reviewState,
          blocking: true,
        });
      }
    }

    claimObject(component.semanticKey, canonicalId);
  }

  /* ------------------------------------------------------------ modifications */

  const modifications = analysis.contractModifications;
  const modificationSection = sectionFor(modifications.guidanceIds, "additional_topics");
  if (modifications.hasModification === "yes") {
    const semanticKey = "modification:primary";
    proposedSemanticKeys.add(semanticKey);
    // The semantic schema carries one high-level modification conclusion while
    // the canonical workpaper may already hold richer manual modifications.
    // ARC will not guess which manual modification the model meant, and it
    // will not stand a second shell beside them.
    const manualModificationConflict =
      manualModifications.length > 0 && objectProvenance[semanticKey] === undefined;
    if (manualModificationConflict) {
      raise({
        targetKey: "modification:manual",
        section: modificationSection,
        reasonCode: "manual_structure_preserved",
        reason:
          "The AI analysis also identifies a contract modification. Your own modification workpaper was kept and no duplicate was created — confirm they describe the same amendment.",
        guidanceIds: modifications.guidanceIds,
        citations: modifications.citations,
        value: {
          manualModificationIds: manualModifications.map((row) => row.id).sort(),
          semanticKey,
          proposed: modifications.rationale.slice(0, 120),
        },
        material: {
          manualModificationIds: manualModifications.map((row) => row.id).sort(),
          ...modificationMaterial(),
        },
        aiReviewState: modifications.reviewState,
      });
    }
    if (!tombstones.has(semanticKey) && !manualModificationConflict) {
      const canonicalId = canonicalIdFor("modification", semanticKey);
      if (draft.contractModifications.every((row) => row.id !== canonicalId)) {
        draft.contractModifications = [
          ...draft.contractModifications,
          {
            ...createModificationDraft(draft.contractModifications.length + 1),
            id: canonicalId,
            seq: draft.contractModifications.length + 1,
          },
        ];
        draft.hasContractModifications = true;
      }
      const update = (patch: Partial<ModificationDraft>) => {
        draft.contractModifications = draft.contractModifications.map((row) =>
          row.id === canonicalId ? { ...row, ...patch } : row,
        );
      };
      const current = () => draft.contractModifications.find((row) => row.id === canonicalId)!;

      const effectiveDate = parseIsoDate(modifications.effectiveDate);
      if (effectiveDate !== null) {
        mergeText({
          key: fieldKeys.modification(canonicalId, "modificationDate"),
          semanticKey,
          current: current().modificationDate,
          proposed: effectiveDate,
          apply: (value) => update({ modificationDate: value as IsoDate }),
          section: modificationSection,
          guidanceIds: modifications.guidanceIds,
          citations: modifications.citations,
          aiReviewState: modifications.reviewState,
          label: "Modification date",
        });
      }
      mergeText({
        key: fieldKeys.modification(canonicalId, "scopeChangeDescription"),
        semanticKey,
        current: current().scopeChangeDescription,
        proposed: modifications.addedGoodsOrServices ?? modifications.rationale,
        apply: (value) => update({ scopeChangeDescription: value }),
        section: modificationSection,
        guidanceIds: modifications.guidanceIds,
        citations: modifications.citations,
        aiReviewState: modifications.reviewState,
        label: "Scope change",
      });
      const priceIncrease = usableAmount(modifications.priceIncreaseInput);
      if (priceIncrease !== null) {
        mergeText({
          key: fieldKeys.modification(canonicalId, "considerationMagnitudeInput"),
          semanticKey,
          current: current().considerationMagnitudeInput,
          proposed: priceIncrease,
          apply: (value) => update({ considerationMagnitudeInput: value }),
          section: modificationSection,
          guidanceIds: modifications.guidanceIds,
          citations: modifications.citations,
          aiReviewState: modifications.reviewState,
          label: "Change in consideration",
        });
      }
      const reflectsSsp = mapOutcome(modifications.priceReflectsSsp);
      if (reflectsSsp !== null) {
        mergeScalar<Judgment>({
          key: fieldKeys.modification(canonicalId, "priceReflectsAddedGoodsSsp"),
          semanticKey,
          current: current().priceReflectsAddedGoodsSsp,
          proposed: reflectsSsp,
          unclaimed: current().priceReflectsAddedGoodsSsp === null,
          apply: (value) => update({ priceReflectsAddedGoodsSsp: value }),
          section: modificationSection,
          guidanceIds: modifications.guidanceIds,
          citations: modifications.citations,
          aiReviewState: modifications.reviewState,
          label: "Price reflects standalone selling price of added goods",
        });
      }

      // Phase 5C needs far more structure than the semantic schema carries.
      // The remainder is left unanswered; ARC's own classifier stays
      // authoritative once the accountant supplies those facts.
      raise({
        targetKey: fieldKeys.modification(canonicalId, "phase5cFacts"),
        section: modificationSection,
        reasonCode: "modification_facts_incomplete",
        reason:
          "A contract modification was identified. Complete the modification workpaper — approval, scope effects, remaining and modified standalone selling prices and recognition — before this analysis can be finalized.",
        guidanceIds: modifications.guidanceIds,
        citations: modifications.citations,
        value: canonicalId,
        material: { modificationId: canonicalId, ...modificationMaterial() },
        aiReviewState: modifications.reviewState,
        blocking: true,
      });

      claimObject(semanticKey, canonicalId);
    }
  } else if (
    modifications.hasModification === "no" &&
    draft.contractModifications.length === 0 &&
    draft.hasContractModifications === false
  ) {
    // Already the unclaimed default; nothing to change and nothing to review.
  } else if (modifications.hasModification === "unknown") {
    raise({
      targetKey: fieldKeys.structural("hasContractModifications"),
      section: modificationSection,
      reasonCode: "missing_required_input",
      reason:
        "ARC could not determine from the evidence whether this contract has been modified. Answer this yourself.",
      guidanceIds: modifications.guidanceIds,
      citations: modifications.citations,
      value: draft.hasContractModifications,
      material: modificationMaterial(),
      aiReviewState: "needs_user_input",
      blocking: true,
    });
  }

  /* -------------------------------------------- billing + projected collections */

  const servicePeriod = deriveContractServicePeriod(draft);
  const projection = analysis.projectedCollectionAssumptions;

  for (const term of analysis.billingTerms) {
    const semanticKey = term.semanticKey;
    proposedSemanticKeys.add(semanticKey);
    if (tombstones.has(semanticKey)) {
      raise({
        targetKey: `billing:${semanticKey}`,
        section: "additional_topics",
        reasonCode: "ai_proposal_tombstoned",
        reason:
          "The AI analysis still proposes a billing schedule you previously removed. It has not been recreated.",
        guidanceIds: [],
        citations: term.citations,
        value: semanticKey,
        material: billingMaterial(term),
        aiReviewState: "needs_review",
      });
      continue;
    }

    // The accountant's own billing events are stronger than any derived
    // schedule. ARC will not layer a synthetic recurring invoice run on top of
    // them, and it never attempts fuzzy invoice-by-invoice matching.
    if (manualConsiderationEvents.length > 0 && objectProvenance[semanticKey] === undefined) {
      raise({
        targetKey: `billing:${semanticKey}`,
        section: "additional_topics",
        reasonCode: "manual_structure_preserved",
        reason: `You have already entered billing events, so ARC did not create a second schedule for "${term.description.slice(0, 100)}". Compare the AI billing terms with your own events.`,
        guidanceIds: [],
        citations: term.citations,
        value: {
          manualConsiderationEventIds: manualConsiderationEvents.map((row) => row.id).sort(),
          semanticKey,
          proposed: term.description.slice(0, 120),
        },
        material: {
          manualConsiderationEventIds: manualConsiderationEvents.map((row) => row.id).sort(),
          ...billingMaterial(term),
        },
        aiReviewState: term.reviewState,
      });
      continue;
    }

    const schedule = deriveBillingSchedule({
      billingTiming: term.billingTiming,
      frequency: term.frequency,
      amountOrRateInput: term.amountOrRateInput,
      serviceStart: servicePeriod?.start ?? null,
      serviceEnd: servicePeriod?.end ?? null,
    });

    if (!schedule.ok) {
      raise({
        targetKey: `billing:${semanticKey}`,
        section: "additional_topics",
        reasonCode: "billing_schedule_not_derivable",
        reason: `ARC could not construct a billing schedule for "${term.description.slice(0, 100)}" from structured contract terms alone (${schedule.reason.replace(/_/g, " ")}). Enter the billing events yourself.`,
        guidanceIds: [],
        citations: term.citations,
        value: schedule.reason,
        material: {
          reason: schedule.reason,
          serviceStart: servicePeriod?.start ?? null,
          serviceEnd: servicePeriod?.end ?? null,
          ...billingMaterial(term),
        },
        aiReviewState: term.reviewState,
        blocking: true,
      });
      continue;
    }

    for (const event of schedule.events) {
      const eventSemanticKey = `${semanticKey}#${event.period}`;
      proposedSemanticKeys.add(eventSemanticKey);
      if (tombstones.has(eventSemanticKey)) continue;

      const eventId = canonicalIdFor("consideration_event", eventSemanticKey);
      if (draft.contractBalances.considerationEvents.every((row) => row.id !== eventId)) {
        const created: ConsiderationEventDraft = {
          ...createConsiderationEventDraft(
            draft.contractBalances.considerationEvents.length + 1,
            eventId,
          ),
          amountInput: event.amountInput,
          invoiceDate: event.invoiceDate,
          unconditionalRightDate: event.unconditionalRightDate,
        };
        draft.contractBalances = {
          ...draft.contractBalances,
          considerationEvents: [...draft.contractBalances.considerationEvents, created],
        };
        fieldProvenance[fieldKeys.billing(eventId, "invoiceDate")] = {
          state: "ai_generated_untouched",
          semanticKey: eventSemanticKey,
          lastAiRunId: runId,
          valueFingerprint: valueFingerprint(event.invoiceDate),
        };
      }
      claimObject(eventSemanticKey, eventId);

      // The contract never proves cash was received. The only derived cash row
      // is the contractual due date, always recorded as a projection.
      const projected = deriveProjectedCollectionDate({
        invoiceDate: event.invoiceDate,
        contractualDueDateBasis: projection.contractualDueDateBasis,
        paymentTermsDays: projection.paymentTermsDays ?? term.paymentTermsDays,
      });
      const cashSemanticKey = `${eventSemanticKey}#collection`;
      proposedSemanticKeys.add(cashSemanticKey);
      if (!projected.ok) {
        raise({
          targetKey: `cash:${eventSemanticKey}`,
          section: "additional_topics",
          reasonCode: "projected_collection_not_derivable",
          reason:
            "ARC could not derive a contractual due date for this invoice from structured terms, so no projected collection was created.",
          guidanceIds: [],
          citations: projection.citations,
          value: projected.reason,
          material: {
            reason: projected.reason,
            invoiceDate: event.invoiceDate,
            termPaymentTermsDays: term.paymentTermsDays,
            ...projectionMaterial(),
          },
          aiReviewState: projection.reviewState,
        });
        continue;
      }
      if (tombstones.has(cashSemanticKey)) continue;
      const cashId = canonicalIdFor("cash_collection", cashSemanticKey);
      if (draft.contractBalances.cashCollections.every((row) => row.id !== cashId)) {
        const created: CashCollectionDraft = {
          ...createCashCollectionDraft(draft.contractBalances.cashCollections.length + 1, cashId),
          considerationEventId: eventId,
          amountInput: event.amountInput,
          collectionDate: projected.collectionDate,
          basis: "projected_contract_due_date",
        };
        draft.contractBalances = {
          ...draft.contractBalances,
          cashCollections: [...draft.contractBalances.cashCollections, created],
        };
      }
      claimObject(cashSemanticKey, cashId);
    }
  }

  /* ------------------------------------------------------- additional topics */

  // Phase 9G-R Task R2. A deterministic defence, not a matter of trust: the
  // same topic reported twice, however differently worded, is raised once.
  const seenTopics = new Set<string>();

  for (const topic of analysis.additionalTopics) {
    if (topic.applicable === "no") continue;
    if (seenTopics.has(topic.topic)) continue;
    seenTopics.add(topic.topic);
    // There is no canonical WorkflowDraft field for these conclusions, so they
    // live entirely in review state — never as invented draft properties.
    raise({
      targetKey: fieldKeys.topic(topic.topic),
      section: sectionFor(topic.guidanceIds, "additional_topics"),
      reasonCode: "advisory_topic",
      reason: `${topic.topic.replace(/_/g, " ")}: ${topic.conclusion}`,
      guidanceIds: topic.guidanceIds,
      citations: topic.citations,
      value: topic.conclusion,
      material: {
        topic: topic.topic,
        applicable: topic.applicable,
        conclusion: topic.conclusion,
        rationale: topic.rationale,
      },
      aiReviewState: topic.reviewState,
      blocking: topic.applicable === "unknown" ? false : false,
    });
  }

  /* --------------------------------------------------------- reported issues */

  const ISSUE_SECTIONS: Record<string, GuidanceReviewSection> = {
    documents: "additional_topics",
    step_1: "step_1",
    step_2: "step_2",
    step_3: "step_3",
    step_4: "step_4",
    step_5: "step_5",
    billing: "additional_topics",
    modifications: "additional_topics",
    additional_topics: "additional_topics",
  };

  const seenIssues = new Set<string>();

  for (const issue of analysis.issues) {
    // The same underlying issue is one item, whatever the model repeated.
    const issueIdentity = `${issue.section}\u0000${issue.semanticKey}`;
    if (seenIssues.has(issueIdentity)) continue;
    seenIssues.add(issueIdentity);
    raise({
      targetKey: fieldKeys.issue(issue.semanticKey),
      section: ISSUE_SECTIONS[issue.section] ?? "additional_topics",
      reasonCode:
        issue.reviewState === "source_conflict"
          ? "source_conflict"
          : issue.reviewState === "needs_user_input"
            ? "missing_required_input"
            : "accountant_affirmation_required",
      reason: issue.message,
      guidanceIds: issue.guidanceIds,
      citations: issue.citations,
      value: issue.message,
      material: {
        semanticKey: issue.semanticKey,
        section: issue.section,
        reviewState: issue.reviewState,
        message: issue.message,
        relatedSemanticKeys: [...issue.relatedSemanticKeys].sort(),
      },
      aiReviewState: issue.reviewState,
      blocking: issue.reviewState === "needs_user_input" || issue.reviewState === "source_conflict",
    });
  }

  /* ---------------------------------------- AI objects the model stopped proposing */

  for (const [semanticKey, provenance] of Object.entries(objectProvenance)) {
    if (proposedSemanticKeys.has(semanticKey)) continue;
    if (!takenIds.has(provenance.canonicalId)) continue;
    // A later run omitting an object is NOT a user deletion. ARC never removes
    // canonical accounting structure on that basis.
    raise({
      targetKey: `object:${provenance.canonicalId}`,
      section: "additional_topics",
      reasonCode: "ai_proposal_omitted",
      reason:
        "This item was created by an earlier AI analysis and the latest analysis no longer proposes it. It has been kept — remove it yourself if it does not belong.",
      guidanceIds: [],
      value: provenance.canonicalId,
      aiReviewState: "needs_review",
    });
  }

  for (const semanticKey of deletedSemanticKeys) {
    raise({
      targetKey: `tombstone:${semanticKey}`,
      section: "additional_topics",
      reasonCode: "ai_proposal_tombstoned",
      reason: "You removed this AI-created item. It will not be recreated by later AI analyses.",
      guidanceIds: [],
      value: semanticKey,
      aiReviewState: "needs_review",
    });
  }

  /* -------------------------------------------- final AI object fingerprints */

  // Object provenance is finalized only now, after EVERY dependent mapping
  // step has run. A promise is fingerprinted with its final performance
  // obligation assignment; a performance obligation with its final
  // classification, recognition and standalone selling price. Recording an
  // intermediate fingerprint would make an identical re-run look like a user
  // edit on the next merge.
  for (const { semanticKey, canonicalId } of claimedObjects) {
    const prior = previousState.objectProvenance[semanticKey];
    const preMerge = preMergeFingerprints.get(semanticKey);
    // User-edit detection compares the PRE-merge canonical object with what
    // ARC last wrote. A difference created by ARC applying this very analysis
    // proves nothing about the user, so it is never consulted here.
    const userModified =
      prior !== undefined &&
      (prior.userModified || (preMerge !== undefined && preMerge !== prior.valueFingerprint));
    const finalFingerprint =
      aiObjectFingerprint(draft, canonicalId) ?? valueFingerprint(canonicalId);
    objectProvenance[semanticKey] = {
      state: userModified
        ? "ai_generated_user_edited"
        : prior?.state === "manual_from_start"
          ? "manual_from_start"
          : "ai_generated_untouched",
      semanticKey,
      lastAiRunId: userModified ? (prior?.lastAiRunId ?? runId) : runId,
      valueFingerprint: userModified
        ? (prior?.valueFingerprint ?? finalFingerprint)
        : finalFingerprint,
      canonicalId,
      userModified,
    };
  }

  /* ---------------------------------------------------------------- finalize */

  const ranked = rankReviewItems(sortReviewItems(issues));
  // The previous review array is data of unknown provenance whatever its
  // static type: every caller's value passes through the Phase 9G normalizer
  // before any resolution can be carried forward.
  const reviewItems = carryForwardReviewResolutions(
    ranked,
    normalizePersistedReviewItems(previousState.reviewItems),
  );

  const validated = validateDraftForPersistence(draft);
  if (!validated.ok) {
    throw new AiMergeError(validated.reason);
  }

  const aiState: AiAnalysisState = {
    lastSuccessfulRunId: runId,
    // The new source-set fingerprint is not an input to this function, so it
    // is carried forward untouched. Phase 9F owns source-state transitions.
    sourceSetFingerprint: previousState.sourceSetFingerprint,
    sourceState: previousState.sourceState,
    fieldProvenance,
    objectProvenance,
    tombstones: [...tombstones].sort(),
    reviewItems,
  };

  return { draft: validated.draft, aiState, issues: reviewItems };
}

/* --------------------------------------------- AI-owned fingerprint subsets */

function promiseFingerprintValue(row: PromiseDraft) {
  return {
    description: row.description,
    kind: row.kind,
    capableOfBeingDistinct: row.capableOfBeingDistinct,
    distinctWithinContractContext: row.distinctWithinContractContext,
    distinctRationale: row.distinctRationale,
    performanceObligationId: row.performanceObligationId,
  };
}

function poFingerprintValue(row: PoDraft) {
  return {
    name: row.name,
    classification: row.classification,
    classificationRationale: row.classificationRationale,
    sspInput: row.sspInput,
    sspBasis: row.sspBasis,
    recognitionMethod: row.recognitionMethod,
    serviceStart: row.serviceStart,
    serviceEnd: row.serviceEnd,
    recognitionDate: row.recognitionDate,
    recognitionRationale: row.recognitionRationale,
  };
}

function vcFingerprintValue(row: VcComponentDraft) {
  return {
    treatment: row.treatment,
    description: row.description,
    effect: row.effect,
    estimationMethod: row.estimationMethod,
    meters: row.meters,
  };
}

function modificationFingerprintValue(row: ModificationDraft) {
  return {
    modificationDate: row.modificationDate,
    scopeChangeDescription: row.scopeChangeDescription,
    considerationMagnitudeInput: row.considerationMagnitudeInput,
    priceReflectsAddedGoodsSsp: row.priceReflectsAddedGoodsSsp,
  };
}

function considerationFingerprintValue(row: ConsiderationEventDraft) {
  return {
    amountInput: row.amountInput,
    invoiceDate: row.invoiceDate,
    unconditionalRightDate: row.unconditionalRightDate,
  };
}

function cashFingerprintValue(row: CashCollectionDraft) {
  return {
    considerationEventId: row.considerationEventId,
    amountInput: row.amountInput,
    collectionDate: row.collectionDate,
    basis: row.basis ?? "actual",
  };
}

/**
 * The contract-level service period, taken from canonical over-time
 * performance obligations only. It is never parsed from prose.
 *
 * It exists ONLY when every qualifying performance obligation shares exactly
 * the same start and end. The accepted Phase 9D billing schema does not say
 * which performance obligation a billing term belongs to, so widening several
 * different periods into one min/max window would manufacture a continuous
 * service period the contract never states.
 */
function deriveContractServicePeriod(
  draft: WorkflowDraft,
): { start: IsoDate; end: IsoDate } | null {
  const periods = draft.performanceObligations
    .filter((po) => po.recognitionMethod === "over_time_ratable")
    .map((po) => ({ start: parseIsoDate(po.serviceStart), end: parseIsoDate(po.serviceEnd) }))
    .filter(
      (period): period is { start: IsoDate; end: IsoDate } =>
        period.start !== null && period.end !== null,
    );
  if (periods.length === 0) return null;
  const distinct = new Set(periods.map((period) => `${period.start}\u0000${period.end}`));
  if (distinct.size !== 1) return null;
  return periods[0]!;
}

/**
 * The AI-owned fingerprint subset of whichever canonical object carries this
 * ID, or null when no canonical row does. One helper serves both the
 * pre-merge user-edit baseline and the post-merge AI baseline, so the two can
 * never drift apart.
 */
export function aiObjectFingerprint(draft: WorkflowDraft, canonicalId: string): string | null {
  const promise = draft.promises.find((row) => row.id === canonicalId);
  if (promise !== undefined) return valueFingerprint(promiseFingerprintValue(promise));
  const po = draft.performanceObligations.find((row) => row.id === canonicalId);
  if (po !== undefined) return valueFingerprint(poFingerprintValue(po));
  const vc = draft.variableConsiderationComponents.find((row) => row.id === canonicalId);
  if (vc !== undefined) return valueFingerprint(vcFingerprintValue(vc));
  const modification = draft.contractModifications.find((row) => row.id === canonicalId);
  if (modification !== undefined) {
    return valueFingerprint(modificationFingerprintValue(modification));
  }
  const event = draft.contractBalances.considerationEvents.find((row) => row.id === canonicalId);
  if (event !== undefined) return valueFingerprint(considerationFingerprintValue(event));
  const cash = draft.contractBalances.cashCollections.find((row) => row.id === canonicalId);
  if (cash !== undefined) return valueFingerprint(cashFingerprintValue(cash));
  return null;
}

/**
 * Post-R2 live regression patch. The one authoritative date ARC may use as the
 * date of a zero-at-inception estimate: the contract's execution date, and
 * otherwise the earliest obligation service start already in the workpaper.
 * It never invents a date — when neither exists it returns null and the caller
 * fails closed.
 */
export function canonicalInceptionDate(draft: WorkflowDraft): IsoDate | null {
  const execution = draft.contract.executionDate.trim();
  if (execution !== "") return execution as IsoDate;
  const starts = draft.performanceObligations
    .map((po) => po.serviceStart)
    .filter((value): value is IsoDate => value !== "")
    .sort();
  return starts[0] ?? null;
}
