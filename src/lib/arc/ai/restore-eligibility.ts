/**
 * Phase 9G — Task 9C. The pure restore-eligibility model.
 *
 * Whole-run restore replaces the editable draft and the AI sidecar with the
 * exact server snapshot captured immediately before the current restorable
 * successful AI run. Whether that is possible at all is decided here, from
 * trusted persisted facts only — never in the browser, and never from
 * anything the browser sent.
 *
 * Pure: no database, no React, no clock, no network.
 */

import type { AiRunStage } from "./runs.handlers";

/**
 * How complete the recorded pre-run AI sidecar is.
 *
 *  - `absent`   — there was no AI sidecar before the run. Restoring deletes
 *                 the current one, which is exactly the recorded prior state.
 *  - `exact`    — a snapshot that carries every field the current sidecar has,
 *                 including the three Task 2 acknowledgment keys.
 *  - `incomplete` — a legacy snapshot written before Task 9. It cannot be
 *                 restored exactly, so it is not restorable at all.
 */
export type AiPreRunSnapshotShape = "absent" | "exact" | "incomplete";

export interface AiRestoreCandidate {
  runId: string;
  stage: AiRunStage;
  completedAt: string | null;
  /** Non-null once this run has already been undone. */
  restoredAt: string | null;
  /** The immutable source identity the run was executed against. */
  sourceSetFingerprint: string;
  preRunSnapshot: AiPreRunSnapshotShape;
  /** The run row belongs to exactly this owner scope. */
  belongsToScope: boolean;
}

export interface AiRestorableRunDto {
  runId: string;
  completedAt: string | null;
}

export interface AiRestoreEligibilityInput {
  /** The caller still owns an editable workspace. */
  editable: boolean;
  /** An AI run is currently executing for this scope. */
  activeRun: boolean;
  lastSuccessfulRunId: string | null;
  /** The authoritative fingerprint of the documents selected right now. */
  currentSourceSetFingerprint: string | null;
  candidate: AiRestoreCandidate | null;
}

/**
 * The nine conditions, applied in one place. Every one of them is a statement
 * about persisted server state; none of them can be asserted by a client.
 */
export function restorableRunOf(input: AiRestoreEligibilityInput): AiRestorableRunDto | null {
  if (!input.editable) return null;
  if (input.activeRun) return null;
  if (input.lastSuccessfulRunId === null) return null;

  const candidate = input.candidate;
  if (candidate === null) return null;
  if (!candidate.belongsToScope) return null;
  if (candidate.stage !== "succeeded") return null;
  if (candidate.restoredAt !== null) return null;
  if (candidate.runId !== input.lastSuccessfulRunId) return null;

  // Restore never touches the selected source documents, so restoring the
  // prior sidecar is only exact while the current selection is still the one
  // the run analyzed.
  if (input.currentSourceSetFingerprint === null) return null;
  if (input.currentSourceSetFingerprint !== candidate.sourceSetFingerprint) return null;

  // A legacy snapshot cannot satisfy the exact-restore contract; it is never
  // presented as restorable and never partially applied.
  if (candidate.preRunSnapshot === "incomplete") return null;

  return { runId: candidate.runId, completedAt: candidate.completedAt };
}

/**
 * The three Task 2 acknowledgment keys a pre-run sidecar must carry for the
 * snapshot to be exact. The values may be null; the keys must exist.
 */
export const AI_PRE_RUN_ACKNOWLEDGMENT_KEYS = [
  "acknowledged_source_fingerprint",
  "source_acknowledged_at",
  "source_acknowledged_by",
] as const;

/** Classifies a raw persisted `pre_run_ai_state` value. Never repairs one. */
export function classifyPreRunSnapshot(raw: unknown): AiPreRunSnapshotShape {
  if (raw === null || raw === undefined) return "absent";
  if (typeof raw !== "object" || Array.isArray(raw)) return "incomplete";
  const row = raw as Record<string, unknown>;
  return AI_PRE_RUN_ACKNOWLEDGMENT_KEYS.every((key) => key in row) ? "exact" : "incomplete";
}
