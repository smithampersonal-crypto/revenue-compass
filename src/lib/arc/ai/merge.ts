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
  resolveUniqueId,
  valueFingerprint,
  type AiObjectKind,
} from "./identity";
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
    value: unknown;
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
      aiReviewState: input.aiReviewState ?? null,
      blocking: input.blocking ?? false,
    });
    if (item !== null) issues.push(item);
  };

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

  // `contractNumber` is deliberately never populated: the semantic schema has
  // no structured field for it and ARC does not scrape identifiers from prose.
  // It is required to finalize, so its absence is surfaced as required input.
  if (isUnclaimedString(draft.contract.contractNumber)) {
    raise({
      targetKey: fieldKeys.contract("contractNumber"),
      section: "step_1",
      reasonCode: "missing_required_input",
      reason:
        "Enter the contract number or reference. ARC never takes an identifier from the AI analysis.",
      value: null,
      aiReviewState: "needs_user_input",
      blocking: true,
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

    raise({
      targetKey: key,
      section,
      reasonCode: answer === null ? "missing_required_input" : "accountant_affirmation_required",
      reason:
        answer === null
          ? `${entry.label}: the contract does not establish this criterion. An accountant judgment is required.`
          : `${entry.label}: affirm the AI conclusion.`,
      guidanceIds: entry.judgment.guidanceIds,
      citations: entry.judgment.citations,
      value: draft.contract.criteria[entry.criterion]?.answer ?? null,
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

    if (mapping.method === "over_time_ratable") {
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
          aiReviewState: proposal.reviewState,
          blocking: true,
        });
      }
    }
  }

  /* ------------------------------------------------------------------- SSP */

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
    } else if (isUnclaimedString(current().sspInput)) {
      raise({
        targetKey: fieldKeys.po(canonicalId, "sspInput"),
        section,
        reasonCode: "missing_ssp",
        reason: `A standalone selling price is required to allocate the transaction price and the contract does not evidence one. ${item.missingInformation}`,
        guidanceIds: item.guidanceIds,
        citations: item.citations,
        value: null,
        aiReviewState: item.reviewState,
        blocking: true,
      });
    }
  }

  /* ------------------------------------------------------- transaction price */

  const fixed = usableAmount(analysis.transactionPrice.fixedConsiderationInput);
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
        proposed: `${analysis.transactionPrice.fixedConsiderationRationale}\n\n${analysis.transactionPrice.transactionPriceConclusion.conclusion}`,
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
      citations: analysis.transactionPrice.transactionPriceConclusion.citations,
      value: null,
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
    // ARC has no canonical field for these; they are advisory review state only.
    raise({
      targetKey: fieldKeys.transactionPrice(judgment.key),
      section: sectionFor(judgment.value.guidanceIds, "step_3"),
      reasonCode: "advisory_topic",
      reason: `${judgment.label}: ${judgment.value.rationale}`,
      guidanceIds: judgment.value.guidanceIds,
      citations: judgment.value.citations,
      value: judgment.value.outcome,
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
        aiReviewState: "needs_user_input",
        blocking: true,
      });
    } else {
      const method = mapEstimationMethod(component.estimationMethodProposal);
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
      // Outcome probabilities, the constrained included amount and any
      // resolution amount are deliberately left blank rather than invented.
      raise({
        targetKey: fieldKeys.vc(canonicalId, "inception"),
        section,
        reasonCode: "missing_required_input",
        reason: `Estimate the variable amount and the constrained amount to include for "${component.description.slice(0, 80)}". ${component.constraintAssessment}`,
        guidanceIds: component.guidanceIds,
        citations: component.citations,
        value: null,
        aiReviewState:
          component.reviewState === "supported" ? "needs_user_input" : component.reviewState,
        blocking: true,
      });
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
        value: semanticKey,
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
        value: {
          manualConsiderationEventIds: manualConsiderationEvents.map((row) => row.id).sort(),
          semanticKey,
          proposed: term.description.slice(0, 120),
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
        value: schedule.reason,
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
          value: projected.reason,
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

  for (const topic of analysis.additionalTopics) {
    if (topic.applicable === "no") continue;
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

  for (const issue of analysis.issues) {
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
  const reviewItems = carryForwardReviewResolutions(ranked, previousState.reviewItems);

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
