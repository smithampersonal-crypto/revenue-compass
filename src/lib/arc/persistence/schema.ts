/**
 * Phase 7C — canonical persistence envelope for the ARC workflow draft.
 *
 * Pure and dependency-light: no React, no network, no Supabase. The database
 * stores exactly what this module produces, and every load is validated here
 * before it can reach the workspace. Engine output is never persisted from the
 * browser; only accountant inputs (the `WorkflowDraft`) are.
 */

import { z } from "zod";

import { createEmptyDraft, type WorkflowDraft } from "@/lib/asc606-workflow";

/**
 * Version of the persisted accountant-input shape. Bump only when the stored
 * `WorkflowDraft` shape changes in a way that needs migration.
 */
export const ARC_WORKFLOW_SCHEMA_VERSION = "arc.workflow.v1";

const row = z.object({ id: z.string(), seq: z.number() }).passthrough();

const draftSchema = z
  .object({
    contract: z
      .object({
        customerName: z.string(),
        contractNumber: z.string(),
        executionDate: z.string(),
        currency: z.literal("USD"),
        criteria: z.record(z.object({ answer: z.boolean().nullable(), rationale: z.string() })),
      })
      .passthrough(),
    promises: z.array(row),
    performanceObligations: z.array(row),
    transactionPriceInput: z.string(),
    transactionPriceNotes: z.string(),
    hasVariableConsideration: z.boolean(),
    variableConsiderationComponents: z.array(row),
    hasContractModifications: z.boolean(),
    contractModifications: z.array(row),
    contractBalances: z
      .object({
        considerationEvents: z.array(row),
        cashCollections: z.array(row),
      })
      .passthrough(),
  })
  .passthrough();

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

export type CanonicalInputsParseResult =
  { ok: true; schemaVersion: string; draft: WorkflowDraft } | { ok: false; reason: string };

/**
 * Validates a stored envelope. Unknown future keys are preserved, and missing
 * optional collections fall back to an empty draft's values, so a stored
 * analysis can never load as a partially-formed object.
 */
export function parseCanonicalInputs(value: unknown): CanonicalInputsParseResult {
  const parsed = canonicalInputsSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, reason: "The saved analysis could not be read (unexpected shape)." };
  }
  const draft = { ...createEmptyDraft(), ...(parsed.data.draft as unknown as WorkflowDraft) };
  return { ok: true, schemaVersion: parsed.data.schemaVersion, draft };
}

/** Stable comparison used to decide whether an autosave is actually needed. */
export function serializeDraft(draft: WorkflowDraft): string {
  return JSON.stringify(toCanonicalInputs(draft).draft);
}
