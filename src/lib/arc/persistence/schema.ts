/**
 * Phase 7C — canonical persistence envelope for the ARC workflow draft.
 *
 * Pure and dependency-light: no React, no network, no Supabase. The database
 * stores exactly what this module produces, and every load is validated here
 * before it can reach the workspace. Engine output is never persisted from the
 * browser; only accountant inputs (the `WorkflowDraft`) are.
 *
 * The structural schema below is deliberately exhaustive: TypeScript typing is
 * not validation, so a malformed nested promise / performance obligation /
 * variable-consideration / modification / billing row must be rejected here
 * rather than cast into `WorkflowDraft` and handed to the accounting engine.
 */

import { z } from "zod";

import { createEmptyDraft, type WorkflowDraft } from "@/lib/asc606-workflow";

/**
 * Version of the persisted accountant-input shape. Bump only when the stored
 * `WorkflowDraft` shape changes in a way that needs migration.
 */
export const ARC_WORKFLOW_SCHEMA_VERSION = "arc.workflow.v1";

const judgment = z.boolean().nullable();
const text = z.string();
/** Accountant date strings are "YYYY-MM-DD" or empty while unanswered. */
const dateText = z.string();
const id = z.string().min(1);
const seq = z.number().int();

const criterionAnswer = z.object({ answer: judgment, rationale: text });

const contractSchema = z.object({
  customerName: text,
  contractNumber: text,
  executionDate: dateText,
  currency: z.literal("USD"),
  criteria: z.record(z.string(), criterionAnswer),
});

const promiseSchema = z.object({
  id,
  seq,
  kind: z.enum(["good_or_service", "customer_option"]),
  description: text,
  conveysMaterialRight: judgment,
  materialRightRationale: text,
  capableOfBeingDistinct: judgment,
  distinctWithinContractContext: judgment,
  distinctRationale: text,
  performanceObligationId: z.string().nullable(),
});

const recognitionMethod = z.enum(["over_time_ratable", "point_in_time"]).nullable();

const poSchema = z.object({
  id,
  seq,
  kind: z.enum(["standard", "material_right"]),
  name: text,
  classification: z.enum(["single_distinct", "bundle_not_distinct", "series"]).nullable(),
  classificationRationale: text,
  sspInput: text,
  sspBasis: text,
  recognitionMethod,
  serviceStart: dateText,
  serviceEnd: dateText,
  recognitionDate: dateText,
  recognitionRationale: text,
  underlyingGoodOrServiceName: text,
  benefitAmountInput: text,
  exerciseProbabilityInput: text,
  materialRightStatus: z.enum(["outstanding", "exercised", "expired"]),
  exerciseDate: dateText,
  exerciseConsiderationInput: text,
  expirationDate: dateText,
});

const vcOutcomeSchema = z.object({
  id,
  seq,
  description: text,
  amountInput: text,
  probabilityInput: text,
  isMostLikely: z.boolean(),
});

const vcAssessmentSchema = z.object({
  id,
  seq,
  effectiveDate: dateText,
  outcomes: z.array(vcOutcomeSchema),
  includedInput: text,
  constraintRationale: text,
  evidence: text,
});

const vcMeterSchema = z.object({
  id,
  seq,
  name: text,
  rateAmountInput: text,
  rateQuantityInput: text,
  unit: text,
});

const vcUsagePeriodSchema = z.object({
  id,
  month: text,
  quantities: z.record(z.string(), z.string()),
});

const vcComponentSchema = z.object({
  id,
  seq,
  treatment: z.enum(["estimated", "usage_as_incurred"]),
  description: text,
  effect: z.enum(["increase", "decrease"]),
  estimationMethod: z.enum(["most_likely_amount", "expected_value"]).nullable(),
  allocationTreatment: z.enum(["general", "specific_po", "specific_series_period"]),
  targetPoId: z.string().nullable(),
  relatesSpecifically: judgment,
  consistentWithAllocationObjective: judgment,
  allocationRationale: text,
  inception: vcAssessmentSchema,
  remeasurements: z.array(vcAssessmentSchema),
  hasResolution: z.boolean(),
  resolutionDate: dateText,
  resolutionAmountInput: text,
  resolutionRationale: text,
  meters: z.array(vcMeterSchema),
  usagePeriods: z.array(vcUsagePeriodSchema),
});

const modifiedPoSchema = z.object({
  id,
  seq,
  name: text,
  status: z.enum(["continuing", "added"]),
  sourcePoId: z.string().nullable(),
  scopeEffect: z.enum(["unchanged", "increase", "decrease", "reconfigured"]).nullable(),
  addedGoodsAreDistinct: judgment,
  addedGoodsDistinctnessRationale: text,
  remainingGoodsDistinctFromTransferred: judgment,
  remainingDistinctnessRationale: text,
  remainingSspInput: text,
  remainingSspBasis: text,
  totalModifiedSspInput: text,
  totalModifiedSspBasis: text,
  recognitionMethod,
  serviceStart: dateText,
  serviceEnd: dateText,
  recognitionDate: dateText,
  recognitionRationale: text,
});

const modificationSchema = z.object({
  id,
  seq,
  modificationDate: dateText,
  approvedAndEnforceable: judgment,
  approvalRationale: text,
  scopeChangeDescription: text,
  considerationEffect: z.enum(["increase", "decrease", "none"]),
  considerationMagnitudeInput: text,
  priceReflectsAddedGoodsSsp: judgment,
  priceReflectsSspRationale: text,
  mixedAllocationPolicy: z
    .enum(["updated_total_transaction_price", "updated_remaining_transaction_price"])
    .nullable(),
  mixedAllocationPolicyRationale: text,
  removedPoIds: z.array(z.string()),
  modifiedPerformanceObligations: z.array(modifiedPoSchema),
});

const considerationEventSchema = z.object({
  id,
  seq,
  amountInput: text,
  unconditionalRightDate: dateText,
  invoiceDate: dateText,
  contractGroupId: z.string().optional(),
  amountSource: z.enum(["manual", "estimated_component", "usage_period"]).optional(),
  sourceComponentId: z.string().nullable().optional(),
  sourceMonth: z.string().optional(),
});

const cashCollectionSchema = z.object({
  id,
  seq,
  considerationEventId: z.string().nullable(),
  amountInput: text,
  collectionDate: dateText,
});

const draftSchema = z.object({
  contract: contractSchema,
  promises: z.array(promiseSchema),
  performanceObligations: z.array(poSchema),
  transactionPriceInput: text,
  transactionPriceNotes: text,
  hasVariableConsideration: z.boolean(),
  variableConsiderationComponents: z.array(vcComponentSchema),
  hasContractModifications: z.boolean(),
  contractModifications: z.array(modificationSchema),
  contractBalances: z.object({
    considerationEvents: z.array(considerationEventSchema),
    cashCollections: z.array(cashCollectionSchema),
  }),
});

export const canonicalInputsSchema = z.object({
  schemaVersion: z.string().min(1),
  draft: draftSchema,
});

export type CanonicalInputs = {
  schemaVersion: string;
  draft: WorkflowDraft;
};

/** Serializes the authoritative in-memory draft into the stored envelope. */
export function toCanonicalInputs(draft: WorkflowDraft): CanonicalInputs {
  return {
    schemaVersion: ARC_WORKFLOW_SCHEMA_VERSION,
    draft: JSON.parse(JSON.stringify(draft)) as WorkflowDraft,
  };
}

/**
 * Runtime validation of a browser-supplied draft, used before anything is
 * written to the database. Typing alone is not validation.
 */
export function validateDraftForPersistence(
  draft: unknown,
): { ok: true; draft: WorkflowDraft } | { ok: false; reason: string } {
  const parsed = draftSchema.safeParse(draft);
  if (!parsed.success) {
    return { ok: false, reason: "This analysis could not be saved (unexpected shape)." };
  }
  return { ok: true, draft: parsed.data as unknown as WorkflowDraft };
}

export type CanonicalInputsParseResult =
  | { ok: true; schemaVersion: string; draft: WorkflowDraft }
  | { ok: false; reason: string };

/**
 * Validates a stored envelope.
 *
 * The stored envelope version, the revision row's `schema_version` (when
 * supplied) and the engine's supported version must all agree. A future or
 * unknown version fails safely here, before `analyzeWorkflow()` could ever
 * interpret it with the current engine.
 */
export function parseCanonicalInputs(
  value: unknown,
  rowSchemaVersion?: string,
): CanonicalInputsParseResult {
  const parsed = canonicalInputsSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, reason: "The saved analysis could not be read (unexpected shape)." };
  }
  if (parsed.data.schemaVersion !== ARC_WORKFLOW_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: "This saved analysis uses a version of ARC that this app cannot open.",
    };
  }
  if (rowSchemaVersion !== undefined && rowSchemaVersion !== parsed.data.schemaVersion) {
    return {
      ok: false,
      reason: "This saved analysis is inconsistent and was not opened.",
    };
  }
  const draft = { ...createEmptyDraft(), ...(parsed.data.draft as unknown as WorkflowDraft) };
  return { ok: true, schemaVersion: parsed.data.schemaVersion, draft };
}

/** Stable comparison used to decide whether an autosave is actually needed. */
export function serializeDraft(draft: WorkflowDraft): string {
  return JSON.stringify(toCanonicalInputs(draft).draft);
}
