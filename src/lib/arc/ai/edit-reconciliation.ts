/**
 * Phase 9G — Task 4. Pure edit reconciliation.
 *
 * The canonical draft is authoritative accounting. This module makes ARC's AI
 * sidecar FOLLOW an accountant's edit: it never rewrites, reinterprets or
 * second-guesses the edit itself.
 *
 * Pure: no database, no React, no network, no OpenAI, no environment, no
 * clock, no randomness. Timestamps are authored by the trusted persistence
 * layer, which passes the stamp back into `applyEditReviewIntents`.
 */

import { parseUsdToCents, type WorkflowDraft } from "@/lib/asc606-workflow";
import type { GuidanceReviewSection } from "@/lib/arc/guidance/types";

import { PROVISIONAL_SSP_TARGET_KEY, valueFingerprint } from "./identity";
import { type AiAnalysisState } from "./merge";
import type { AiReviewItem, AiReviewSeverity } from "./review-state";

/* ------------------------------------------------------- canonical reading */

type ObjectFamily = "promise" | "po" | "vc" | "modification" | "billing" | "cash";

const OBJECT_FAMILIES: readonly ObjectFamily[] = [
  "promise",
  "po",
  "vc",
  "modification",
  "billing",
  "cash",
];

/**
 * Families that are advisory or diagnostic and have no canonical value, plus
 * relationship and tombstone keys ARC cannot bind to an authoritative
 * canonical object. A tombstoned item legitimately has no current canonical
 * representation, so it is never fingerprinted against a live object.
 */
const UNREPRESENTABLE_PREFIXES = [
  "additionalTopic:",
  "issue:",
  "tombstone:",
  "recognition:",
  "ssp:",
];

interface ParsedKey {
  family:
    ObjectFamily | "contract" | "criterion" | "transactionPrice" | "structural" | "object" | null;
  canonicalId: string | null;
  field: string | null;
  criterionId?: string;
}

/** Parses a stable provenance/review key back into the draft location it names. */
export function parseCanonicalKey(key: string): ParsedKey {
  for (const prefix of UNREPRESENTABLE_PREFIXES) {
    if (key.startsWith(prefix)) return { family: null, canonicalId: null, field: null };
  }
  // A whole object retained across re-analysis: the complete canonical object
  // carrying this ID, whatever family it belongs to.
  if (key.startsWith("object:")) {
    return { family: "object", canonicalId: key.slice("object:".length), field: null };
  }
  for (const family of OBJECT_FAMILIES) {
    if (key.startsWith(`${family}:`)) {
      const rest = key.slice(family.length + 1);
      const dot = rest.indexOf(".");
      if (dot < 0) return { family, canonicalId: rest, field: null };
      return { family, canonicalId: rest.slice(0, dot), field: rest.slice(dot + 1) };
    }
  }
  if (key.startsWith("contract.criteria.")) {
    const rest = key.slice("contract.criteria.".length);
    const dot = rest.indexOf(".");
    if (dot < 0) return { family: null, canonicalId: null, field: null };
    return {
      family: "criterion",
      canonicalId: null,
      field: rest.slice(dot + 1),
      criterionId: rest.slice(0, dot),
    };
  }
  if (key.startsWith("contract.")) {
    return { family: "contract", canonicalId: null, field: key.slice("contract.".length) };
  }
  if (key.startsWith("transactionPrice.")) {
    return {
      family: "transactionPrice",
      canonicalId: null,
      field: key.slice("transactionPrice.".length),
    };
  }
  if (key.startsWith("draft.")) {
    return { family: "structural", canonicalId: null, field: key.slice("draft.".length) };
  }
  return { family: null, canonicalId: null, field: null };
}

function rowFor(draft: WorkflowDraft, family: ObjectFamily, id: string): unknown {
  switch (family) {
    case "promise":
      return draft.promises.find((row) => row.id === id);
    case "po":
      return draft.performanceObligations.find((row) => row.id === id);
    case "vc":
      return draft.variableConsiderationComponents.find((row) => row.id === id);
    case "modification":
      return draft.contractModifications.find((row) => row.id === id);
    case "billing":
      return draft.contractBalances.considerationEvents.find((row) => row.id === id);
    case "cash":
      return draft.contractBalances.cashCollections.find((row) => row.id === id);
  }
}

/**
 * The exact canonical value a field key names. `representable` is false when
 * the key names nothing ARC stores canonically — an advisory topic, say —
 * so silence is never mistaken for an edit.
 */
export function canonicalFieldValue(
  draft: WorkflowDraft,
  key: string,
): { representable: boolean; value: unknown } {
  const parsed = parseCanonicalKey(key);
  if (parsed.family === null || parsed.field === null) {
    return { representable: false, value: null };
  }
  if (parsed.family === "contract") {
    const contract = draft.contract as unknown as Record<string, unknown>;
    return { representable: parsed.field in contract, value: contract[parsed.field] ?? null };
  }
  if (parsed.family === "criterion") {
    const criteria = draft.contract.criteria as unknown as Record<
      string,
      Record<string, unknown> | undefined
    >;
    const criterion = criteria[parsed.criterionId!];
    if (criterion === undefined) return { representable: true, value: null };
    return { representable: true, value: criterion[parsed.field] ?? null };
  }
  if (parsed.family === "transactionPrice") {
    if (parsed.field === "input") {
      return { representable: true, value: draft.transactionPriceInput };
    }
    if (parsed.field === "notes") {
      return { representable: true, value: draft.transactionPriceNotes };
    }
    return { representable: false, value: null };
  }
  if (parsed.family === "structural") {
    const record = draft as unknown as Record<string, unknown>;
    return { representable: parsed.field in record, value: record[parsed.field] ?? null };
  }
  if (parsed.family === "object") return { representable: false, value: null };

  const row = rowFor(draft, parsed.family, parsed.canonicalId!) as
    Record<string, unknown> | undefined;
  if (row === undefined) return { representable: true, value: null };

  // A usage meter created from an AI proposal has ONE deterministic identity,
  // exactly as the merge engine derives it. Meters are never fuzzy-matched.
  if (parsed.family === "vc" && parsed.field.startsWith(`${METER_PREFIX}.`)) {
    const property = parsed.field.slice(METER_PREFIX.length + 1);
    const meter = aiMeterOf(row, parsed.canonicalId!);
    if (meter === undefined) return { representable: true, value: null };
    return { representable: property in meter, value: meter[property] ?? null };
  }

  // `servicePeriod` is a synthetic recognition target, not a stored property:
  // it exists only when BOTH authoritative service dates are present.
  if (parsed.family === "po" && parsed.field === SERVICE_PERIOD_FIELD) {
    const start = row["serviceStart"];
    const end = row["serviceEnd"];
    const complete = isSupplied(start) && isSupplied(end);
    return { representable: true, value: complete ? { start, end } : null };
  }

  // The Phase 5C workpaper is a composite conclusion, never a scalar: it is
  // deliberately not something an automatic red cure can prove complete.
  if (parsed.family === "modification" && parsed.field === PHASE_5C_FIELD) {
    return { representable: false, value: null };
  }

  return { representable: true, value: row[parsed.field] ?? null };
}

const METER_PREFIX = "meter";
const SERVICE_PERIOD_FIELD = "servicePeriod";
const PHASE_5C_FIELD = "phase5cFacts";

/** The single meter identity the merge engine creates for a VC component. */
function aiMeterOf(row: Record<string, unknown>, canonicalId: string): Row | undefined {
  const meters = Array.isArray(row["meters"]) ? (row["meters"] as Row[]) : [];
  return meters.find((meter) => meter["id"] === `${canonicalId}-m1`);
}

/** A deterministic marker for "the object this target names no longer exists". */
function absentMarker(key: string): string {
  return valueFingerprint({ absentCanonicalTarget: key });
}

/* ------------------------------------- Task 4 canonical material projections */

/**
 * These projections answer a DIFFERENT question from `aiObjectFingerprint()`.
 *
 * `aiObjectFingerprint()` is Phase 9E/9F re-analysis provenance: the subset of
 * a canonical object that ARC itself populated from an AI proposal. It is
 * deliberately left exactly as it is.
 *
 * The projections below are Task 4's own:
 *
 *   * `canonicalObjectEditFingerprint()` — has the accountant materially
 *     edited this canonical object, in ANY user-editable material field? A
 *     modification workpaper filled in by hand is a real edit even though not
 *     one of the four fields AI originally supplied moved.
 *   * `canonicalReviewTargetFingerprint()` — has the SPECIFIC accounting
 *     conclusion a review item covers materially changed? Changing a
 *     performance obligation's standalone selling price must never reopen its
 *     recognition conclusion, and vice versa.
 *
 * Display prose that carries an accounting judgment (a rationale) is material.
 * Prose that carries none (a memo) is not.
 */

type Row = Record<string, unknown>;

function pick(row: Row, fields: readonly string[]): Row {
  const projection: Row = {};
  for (const field of fields) projection[field] = row[field] ?? null;
  return projection;
}

const VC_OUTCOME_FIELDS = ["description", "amountInput", "probabilityInput", "isMostLikely"];
const VC_ASSESSMENT_FIELDS = ["effectiveDate", "includedInput", "constraintRationale", "evidence"];
const VC_METER_FIELDS = ["name", "rateAmountInput", "rateQuantityInput", "unit"];
const MODIFIED_PO_FIELDS = [
  "name",
  "status",
  "sourcePoId",
  "scopeEffect",
  "addedGoodsAreDistinct",
  "addedGoodsDistinctnessRationale",
  "remainingGoodsDistinctFromTransferred",
  "remainingDistinctnessRationale",
  "remainingSspInput",
  "remainingSspBasis",
  "totalModifiedSspInput",
  "totalModifiedSspBasis",
  "recognitionMethod",
  "serviceStart",
  "serviceEnd",
  "recognitionDate",
  "recognitionRationale",
];

function assessmentProjection(value: unknown): unknown {
  if (value === null || typeof value !== "object") return null;
  const row = value as Row;
  const outcomes = Array.isArray(row["outcomes"]) ? row["outcomes"] : [];
  return {
    ...pick(row, VC_ASSESSMENT_FIELDS),
    outcomes: outcomes.map((outcome) => pick((outcome ?? {}) as Row, VC_OUTCOME_FIELDS)),
  };
}

function vcEstimationProjection(row: Row): Row {
  return {
    treatment: row["treatment"] ?? null,
    effect: row["effect"] ?? null,
    estimationMethod: row["estimationMethod"] ?? null,
    inception: assessmentProjection(row["inception"]),
    remeasurements: (Array.isArray(row["remeasurements"]) ? row["remeasurements"] : []).map(
      assessmentProjection,
    ),
    hasResolution: row["hasResolution"] ?? null,
    resolutionDate: row["resolutionDate"] ?? null,
    resolutionAmountInput: row["resolutionAmountInput"] ?? null,
    resolutionRationale: row["resolutionRationale"] ?? null,
  };
}

function vcUsageProjection(row: Row): Row {
  return {
    meters: (Array.isArray(row["meters"]) ? row["meters"] : []).map((meter) =>
      pick((meter ?? {}) as Row, VC_METER_FIELDS),
    ),
    usagePeriods: (Array.isArray(row["usagePeriods"]) ? row["usagePeriods"] : []).map((period) => {
      const usage = (period ?? {}) as Row;
      return { month: usage["month"] ?? null, quantities: usage["quantities"] ?? null };
    }),
  };
}

function modificationScopeProjection(row: Row): Row {
  const removed = Array.isArray(row["removedPoIds"]) ? [...(row["removedPoIds"] as string[])] : [];
  const modified = Array.isArray(row["modifiedPerformanceObligations"])
    ? row["modifiedPerformanceObligations"]
    : [];
  return {
    scopeChangeDescription: row["scopeChangeDescription"] ?? null,
    removedPoIds: removed.sort(),
    modifiedPerformanceObligations: modified.map((po) =>
      pick((po ?? {}) as Row, MODIFIED_PO_FIELDS),
    ),
  };
}

/**
 * A named group of canonical fields that together express ONE accounting
 * conclusion. A review item targeting any field of a group is fingerprinted
 * against the whole group and nothing else.
 */
interface MaterialGroup {
  name: string;
  fields: readonly string[];
  project(row: Row): unknown;
}

function plainGroup(name: string, fields: readonly string[]): MaterialGroup {
  return { name, fields, project: (row) => pick(row, fields) };
}

const MATERIAL_GROUPS: Record<ObjectFamily, readonly MaterialGroup[]> = {
  promise: [
    plainGroup("identity", ["description", "kind"]),
    plainGroup("distinct", [
      "capableOfBeingDistinct",
      "distinctWithinContractContext",
      "distinctRationale",
    ]),
    plainGroup("materialRight", ["conveysMaterialRight", "materialRightRationale"]),
    plainGroup("assignment", ["performanceObligationId"]),
  ],
  po: [
    plainGroup("classification", ["kind", "name", "classification", "classificationRationale"]),
    plainGroup("ssp", ["sspInput", "sspBasis"]),
    plainGroup("recognition", [
      "recognitionMethod",
      "serviceStart",
      "serviceEnd",
      "recognitionDate",
      "recognitionRationale",
    ]),
    plainGroup("materialRight", [
      "underlyingGoodOrServiceName",
      "benefitAmountInput",
      "exerciseProbabilityInput",
      "materialRightStatus",
      "exerciseDate",
      "exerciseConsiderationInput",
      "expirationDate",
    ]),
  ],
  vc: [
    plainGroup("description", ["description"]),
    {
      name: "estimation",
      fields: [
        "treatment",
        "effect",
        "estimationMethod",
        "inception",
        "remeasurements",
        "hasResolution",
        "resolutionDate",
        "resolutionAmountInput",
        "resolutionRationale",
      ],
      project: vcEstimationProjection,
    },
    plainGroup("allocation", [
      "allocationTreatment",
      "targetPoId",
      "relatesSpecifically",
      "consistentWithAllocationObjective",
      "allocationRationale",
    ]),
    { name: "usage", fields: ["meters", "usagePeriods"], project: vcUsageProjection },
  ],
  modification: [
    plainGroup("treatment", [
      "modificationDate",
      "approvedAndEnforceable",
      "approvalRationale",
      "considerationEffect",
      "considerationMagnitudeInput",
      "priceReflectsAddedGoodsSsp",
      "priceReflectsSspRationale",
      "mixedAllocationPolicy",
      "mixedAllocationPolicyRationale",
    ]),
    {
      name: "scope",
      fields: ["scopeChangeDescription", "removedPoIds", "modifiedPerformanceObligations"],
      project: modificationScopeProjection,
    },
  ],
  billing: [
    plainGroup("billing", [
      "amountInput",
      "invoiceDate",
      "unconditionalRightDate",
      "amountSource",
      "sourceComponentId",
      "sourceMonth",
      "contractGroupId",
    ]),
  ],
  cash: [
    plainGroup("collection", ["considerationEventId", "amountInput", "collectionDate", "basis"]),
  ],
};

function familyOf(draft: WorkflowDraft, canonicalId: string): ObjectFamily | null {
  for (const family of OBJECT_FAMILIES) {
    if (rowFor(draft, family, canonicalId) !== undefined) return family;
  }
  return null;
}

/**
 * A synthetic review target the merge engine raises that is NOT a stored
 * property. Each maps deliberately to a material projection: the recognition
 * conclusion, the complete modification workpaper, or the usage conclusion.
 */
function compositeTargetGroup(family: ObjectFamily, field: string): string | "object" | null {
  if (family === "po" && field === SERVICE_PERIOD_FIELD) return "recognition";
  if (family === "modification" && field === PHASE_5C_FIELD) return "object";
  if (family === "vc" && field.startsWith(`${METER_PREFIX}.`)) return "usage";
  // The variable-consideration allocation review names the whole allocation
  // judgment, not a stored property, so it rests on the allocation group.
  if (family === "vc" && field === "allocation") return "allocation";
  return null;
}

/**
 * Which promises belong to this performance obligation. Grouping is part of a
 * performance obligation's accounting structure even though it is stored on
 * the promises. Identity only — never array position.
 */
function memberPromiseIds(draft: WorkflowDraft, canonicalId: string): string[] {
  return draft.promises
    .filter((promise) => promise.performanceObligationId === canonicalId)
    .map((promise) => promise.id)
    .sort();
}

/**
 * The complete material canonical contents of an AI-created object, for one
 * question only: did the accountant materially edit it? Every user-editable
 * material field counts, not just the subset AI originally supplied.
 */
export function canonicalObjectEditFingerprint(
  draft: WorkflowDraft,
  canonicalId: string,
): string | null {
  const family = familyOf(draft, canonicalId);
  if (family === null) return null;
  const row = rowFor(draft, family, canonicalId) as Row;
  const projection: Row = { family };
  for (const group of MATERIAL_GROUPS[family]) projection[group.name] = group.project(row);
  // Grouping belongs to the whole performance obligation, never to its
  // standalone-selling-price or recognition conclusion.
  if (family === "po") projection["membership"] = memberPromiseIds(draft, canonicalId);
  return valueFingerprint(projection);
}

/**
 * The material conclusion ONE review target rests on, or null when the target
 * has no canonical representation at all.
 *
 * An object-scoped target with a field resolves to the single material group
 * that field belongs to, so a review of recognition cannot be reopened by an
 * edit to standalone selling price. A target naming a whole object uses the
 * complete object projection.
 */
export function canonicalReviewTargetFingerprint(
  draft: WorkflowDraft,
  targetKey: string,
): string | null {
  // Task R2. The consolidated provisional-SSP review rests on the whole Step 4
  // standalone-selling-price workpaper: every PO's amount and basis, by
  // identity and sorted, and nothing else. A recognition rationale edit must
  // never reopen it, and an SSP amount or basis edit always must.
  if (targetKey === PROVISIONAL_SSP_TARGET_KEY) {
    return valueFingerprint({
      provisionalSsp: draft.performanceObligations
        .map((po) => ({ id: po.id, sspInput: po.sspInput, sspBasis: po.sspBasis }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    });
  }

  const parsed = parseCanonicalKey(targetKey);
  if (parsed.family === null) return null;

  // `object:<id>` names the whole canonical object ARC retained.
  if (parsed.family === "object") {
    return canonicalObjectEditFingerprint(draft, parsed.canonicalId!);
  }

  if (OBJECT_FAMILIES.includes(parsed.family as ObjectFamily)) {
    const family = parsed.family as ObjectFamily;
    const row = rowFor(draft, family, parsed.canonicalId!) as Row | undefined;
    if (row === undefined) return absentMarker(targetKey);
    if (parsed.field === null) {
      return canonicalObjectEditFingerprint(draft, parsed.canonicalId!) ?? absentMarker(targetKey);
    }
    const composite = compositeTargetGroup(family, parsed.field);
    if (composite === "object") {
      return canonicalObjectEditFingerprint(draft, parsed.canonicalId!) ?? absentMarker(targetKey);
    }
    const groupName = composite ?? parsed.field;
    const group = MATERIAL_GROUPS[family].find((candidate) =>
      composite === null ? candidate.fields.includes(groupName) : candidate.name === groupName,
    );
    if (group !== undefined) {
      return valueFingerprint({ family, group: group.name, material: group.project(row) });
    }
    // An unrecognised field is fingerprinted narrowly against itself rather
    // than against the whole object, so it can never reopen a neighbour.
    return valueFingerprint({ targetKey, value: row[parsed.field] ?? null });
  }

  if (parsed.family === "transactionPrice") {
    // The transaction-price family is NOT homogeneous. `input` is the composite
    // fixed-plus-variable conclusion; `notes` is an ordinary canonical field;
    // the advisory topics (financing, noncash, consideration payable to the
    // customer) have no canonical field at all, so ARC has nothing to compare
    // and must never treat an unrelated accounting edit as a review of them.
    // Anything else is unknown and fails closed for the same reason.
    if (parsed.field === "input") {
      return valueFingerprint({
        transactionPriceInput: draft.transactionPriceInput,
        hasVariableConsideration: draft.hasVariableConsideration,
        variableConsideration: draft.variableConsiderationComponents
          .map((row) => canonicalObjectEditFingerprint(draft, row.id) ?? row.id)
          .sort(),
      });
    }
    if (parsed.field !== "notes") return null;
  }

  const { representable, value } = canonicalFieldValue(draft, targetKey);
  if (!representable) return null;
  return valueFingerprint({ targetKey, value });
}

/**
 * How Task 4 deliberately classifies a target key. Exported so a regression
 * can prove no merge-emitted key silently falls through to an undefined
 * property read.
 */
export type TargetClassification =
  "exact_scalar" | "material_group" | "composite" | "unrepresentable";

export function classifyReviewTarget(
  draft: WorkflowDraft,
  targetKey: string,
): TargetClassification {
  if (targetKey === PROVISIONAL_SSP_TARGET_KEY) return "composite";
  const parsed = parseCanonicalKey(targetKey);
  if (parsed.family === null) return "unrepresentable";
  if (parsed.family === "object") {
    return canonicalObjectEditFingerprint(draft, parsed.canonicalId!) === null
      ? "unrepresentable"
      : "composite";
  }
  if (parsed.family === "transactionPrice") {
    if (parsed.field === "input") return "composite";
    if (parsed.field === "notes") return "exact_scalar";
    return "unrepresentable";
  }
  if (OBJECT_FAMILIES.includes(parsed.family as ObjectFamily)) {
    const family = parsed.family as ObjectFamily;
    if (parsed.field === null) return "composite";
    if (compositeTargetGroup(family, parsed.field) !== null) return "composite";
    const group = MATERIAL_GROUPS[family].find((candidate) =>
      candidate.fields.includes(parsed.field!),
    );
    return group === undefined ? "exact_scalar" : "material_group";
  }
  return "exact_scalar";
}

/* -------------------------------------------------------------- interfaces */

export interface ReconcileAiEditInput {
  previousDraft: WorkflowDraft;
  nextDraft: WorkflowDraft;
  currentAiState: AiAnalysisState;
}

/**
 * An intent, never a database row. The pure layer authors no event id, no
 * timestamp and no actor identity — those are trusted persistence concerns.
 */
export interface EditReviewEventIntent {
  type: "yellow_affirmed" | "review_item_reopened";
  reviewItemId: string;
  targetKey: string;
  section: GuidanceReviewSection;
  severity: AiReviewSeverity;
  reviewFingerprint: string;
}

export interface ReconcileAiEditResult {
  aiState: AiAnalysisState;
  reviewEvents: EditReviewEventIntent[];
  /** True when anything in the sidecar actually moved. */
  changed: boolean;
}

/* ----------------------------------------------------------- red curing -- */

function isSupplied(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  return true;
}

/**
 * The only red conditions an edit may clear are ones ARC can deterministically
 * prove cured with an existing predicate. Everything else stays red: an edit is
 * never accountant judgment, and judgment stays a deliberate Task 2 action.
 */
function redConditionCured(
  item: AiReviewItem,
  nextDraft: WorkflowDraft,
  previousDraft: WorkflowDraft,
): boolean {
  if (item.reasonCode === "missing_required_input") {
    const before = canonicalFieldValue(previousDraft, item.targetKey);
    const after = canonicalFieldValue(nextDraft, item.targetKey);
    if (!after.representable) return false;
    return !isSupplied(before.value) && isSupplied(after.value);
  }
  if (item.reasonCode === "missing_ssp") {
    const after = canonicalFieldValue(nextDraft, item.targetKey);
    if (!after.representable || typeof after.value !== "string") return false;
    const parsed = parseUsdToCents(after.value);
    return parsed.ok && parsed.cents > 0;
  }
  // Post-R2 live regression patch. The red item says the proposed recognition
  // treatment is not one the deterministic engine supports. Once the exact
  // canonical obligation it points at holds a method the engine DOES support,
  // the condition is deterministically cured: the field is valid, so the
  // marker goes away on its own. No affirmation and no manual red resolution
  // are fabricated, and a blank or unsupported value never cures it.
  if (item.reasonCode === "unsupported_recognition_method") {
    const after = canonicalFieldValue(nextDraft, item.targetKey);
    if (!after.representable || typeof after.value !== "string") return false;
    return ENGINE_SUPPORTED_RECOGNITION_METHODS.includes(after.value as RecognitionMethod);
  }
  return false;
}

/** Exactly the recognition methods the deterministic engine can measure. */
const ENGINE_SUPPORTED_RECOGNITION_METHODS = [
  "over_time_ratable",
  "point_in_time",
] as const satisfies readonly RecognitionMethod[];

/* ------------------------------------------------------------ reconcile -- */

export function reconcileAiEdits(input: ReconcileAiEditInput): ReconcileAiEditResult {
  const previous = input.previousDraft;
  const next = input.nextDraft;
  const state = structuredClone(input.currentAiState);
  const events: EditReviewEventIntent[] = [];
  let changed = false;

  /* ----------------------------------------------------- field provenance */

  for (const [key, provenance] of Object.entries(state.fieldProvenance)) {
    if (provenance.state !== "ai_generated_untouched") continue;
    const before = canonicalFieldValue(previous, key);
    const after = canonicalFieldValue(next, key);
    if (!before.representable || !after.representable) continue;
    if (valueFingerprint(before.value) === valueFingerprint(after.value)) continue;
    // The AI baseline fingerprint is deliberately NOT replaced: it is how a
    // later re-analysis knows the accountant changed this field.
    state.fieldProvenance[key] = { ...provenance, state: "ai_generated_user_edited" };
    changed = true;
  }

  /* ---------------------------------------------------- object provenance */

  const tombstones = new Set(state.tombstones);
  for (const [semanticKey, provenance] of Object.entries(state.objectProvenance)) {
    const before = canonicalObjectEditFingerprint(previous, provenance.canonicalId);
    const after = canonicalObjectEditFingerprint(next, provenance.canonicalId);
    if (before !== null && after === null) {
      tombstones.add(semanticKey);
      delete state.objectProvenance[semanticKey];
      changed = true;
      continue;
    }
    if (before === null || after === null || before === after) continue;
    if (provenance.userModified && provenance.state === "ai_generated_user_edited") continue;
    state.objectProvenance[semanticKey] = {
      ...provenance,
      state:
        provenance.state === "ai_generated_untouched"
          ? "ai_generated_user_edited"
          : provenance.state,
      userModified: true,
    };
    changed = true;
  }
  const sortedTombstones = [...tombstones].sort();
  if (sortedTombstones.join("\u0000") !== state.tombstones.join("\u0000")) {
    state.tombstones = sortedTombstones;
  }

  /* -------------------------------------------------------- review items */

  const reviewItems: AiReviewItem[] = [];
  for (const item of state.reviewItems) {
    const before = canonicalReviewTargetFingerprint(previous, item.targetKey);
    const after = canonicalReviewTargetFingerprint(next, item.targetKey);
    const materialChanged = before !== null && after !== null && before !== after;

    // Task R2. An assumption describes ARC's own draft. Once the accountant
    // edits the underlying accounting, the assumption is simply no longer
    // true, so it is dropped: no audit event, no manufactured affirmation and
    // never a block on the edit.
    if (item.state === "assumed") {
      if (materialChanged) {
        changed = true;
        continue;
      }
      reviewItems.push(item);
      continue;
    }

    if (item.state === "resolved") {
      if (!materialChanged) {
        reviewItems.push(item);
        continue;
      }
      // The prior resolution stays in immutable event history; the current
      // item returns to the severity it was raised at.
      reviewItems.push({
        ...item,
        state: item.severity,
        resolution: null,
        affirmedAt: null,
        affirmedMethod: null,
      });
      events.push({
        type: "review_item_reopened",
        reviewItemId: item.id,
        targetKey: item.targetKey,
        section: item.section,
        severity: item.severity,
        reviewFingerprint: item.reviewFingerprint,
      });
      changed = true;
      continue;
    }

    if (item.severity === "red") {
      if (redConditionCured(item, next, previous)) {
        changed = true;
        continue; // deterministically cured: the issue no longer exists
      }
      reviewItems.push(item);
      continue;
    }

    if (!materialChanged) {
      reviewItems.push(item);
      continue;
    }

    // A direct edit of the exact reviewed conclusion IS the accountant's
    // review of it. The method is server-derived; the browser cannot ask for it.
    reviewItems.push(item);
    events.push({
      type: "yellow_affirmed",
      reviewItemId: item.id,
      targetKey: item.targetKey,
      section: item.section,
      severity: "yellow",
      reviewFingerprint: item.reviewFingerprint,
    });
    changed = true;
  }
  state.reviewItems = reviewItems;

  return { aiState: state, reviewEvents: events, changed };
}

/**
 * Stamps the edit-driven yellow resolutions the pure pass identified. The
 * caller supplies the authoritative server timestamp; nothing here reads a
 * clock of its own.
 */
export function applyEditReviewIntents(
  aiState: AiAnalysisState,
  intents: readonly EditReviewEventIntent[],
  nowIso: string,
): AiAnalysisState {
  const affirmed = new Map(
    intents
      .filter((intent) => intent.type === "yellow_affirmed")
      .map((intent) => [intent.reviewItemId, intent] as const),
  );
  if (affirmed.size === 0) return aiState;

  return {
    ...aiState,
    reviewItems: aiState.reviewItems.map((item) => {
      const intent = affirmed.get(item.id);
      if (intent === undefined) return item;
      return {
        ...item,
        state: "resolved",
        resolution: {
          kind: "affirmed",
          at: nowIso,
          method: "edited",
          reviewFingerprint: intent.reviewFingerprint,
        },
        affirmedAt: nowIso,
        affirmedMethod: "edited",
      };
    }),
  };
}
