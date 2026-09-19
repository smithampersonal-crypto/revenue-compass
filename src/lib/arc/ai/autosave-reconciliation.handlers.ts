/**
 * Phase 9G — Task 4. Autosave edit reconciliation, as a dependency-injected
 * handler.
 *
 * One ordinary autosave is ONE logical operation. When an analysis has an AI
 * sidecar, the canonical draft, the provenance/tombstone/review updates and
 * the audit events all commit inside a single trusted transaction that
 * advances the owner lock exactly once. If any part fails, none of it commits.
 *
 * The browser supplies only the ordinary autosave request. The authoritative
 * pre-save draft and the current sidecar are read on the server, so a stale
 * browser can neither manufacture nor suppress a provenance transition.
 */

import type { WorkflowDraft } from "@/lib/asc606-workflow";

import {
  applyEditReviewIntents,
  reconcileAiEdits,
  type EditReviewEventIntent,
} from "./edit-reconciliation";
import type { AiAnalysisState } from "./merge";

/** Exactly one of `revisionId` / `guestWorkspaceId` is ever set. */
export interface AutosaveScope {
  revisionId: string | null;
  guestWorkspaceId: string | null;
  /** Server-derived: the verified account, when there is one. */
  ownerUserId: string | null;
  /** Server-derived from the HttpOnly credential; never browser-supplied. */
  guestTokenHash: string | null;
  /** The signed-in actor, including one working inside a guest workspace. */
  actorUserId: string | null;
}

export type AutosaveOutcome =
  | { ok: true; lockVersion: number; savedAt: string; reconciled: boolean }
  | { ok: false; reason: "conflict" }
  /**
   * Post-R2 live regression patch. The trusted transaction could not take the
   * owner-row lock within its bounded wait (SQLSTATE 55P03) after ONE retry.
   * This is contention, never proof that a newer saved version exists, so it
   * must not become the permanent conflict/write-block state.
   */
  | { ok: false; reason: "contention" }
  | { ok: false; reason: "unavailable" }
  | { ok: false; reason: "expired" };

/**
 * What one attempt at the trusted transaction produced. `null` is a proven
 * stale optimistic lock (PT409); `"contention"` is a bounded lock timeout.
 */
export type ReconciledSaveAttempt = { lockVersion: number; savedAt: string } | null | "contention";

/**
 * What the store found when it looked for this analysis's AI sidecar.
 *
 * `unreadable` means a persisted review payload could not be fully
 * interpreted. That is never repaired here: silently normalizing it away would
 * destroy the very evidence finalization depends on.
 */
export type AiSidecarLoad =
  { status: "absent" } | { status: "loaded"; state: AiAnalysisState } | { status: "unreadable" };

export interface AutosaveReconciliationStore {
  /** The authoritative pre-save canonical draft, or null when unavailable. */
  loadSavedDraft(scope: AutosaveScope): Promise<WorkflowDraft | null>;
  /** The current AI sidecar, if this analysis has ever used AI. */
  loadAiState(scope: AutosaveScope): Promise<AiSidecarLoad>;
  /** The existing draft-only autosave, unchanged for manual-only analyses. */
  saveDraftOnly(args: {
    scope: AutosaveScope;
    expectedLockVersion: number;
    canonical: unknown;
    schemaVersion: string;
  }): Promise<{ lockVersion: number; savedAt: string } | null>;
  /** The trusted single transaction: draft + sidecar + audit events. */
  saveWithReconciliation(args: {
    scope: AutosaveScope;
    expectedLockVersion: number;
    canonical: unknown;
    schemaVersion: string;
    aiState: AiAnalysisState;
    reviewEvents: readonly EditReviewEventIntent[];
  }): Promise<ReconciledSaveAttempt>;
}

/** The single bounded pause before the one permitted contention retry. */
export const AUTOSAVE_CONTENTION_RETRY_DELAY_MS = 400;

export interface AutosaveReconciliationDeps {
  store: AutosaveReconciliationStore;
  now(): Date;
  /** Overridable only so tests need not wait in real time. */
  delay?(ms: number): Promise<void>;
}

export interface AutosaveInput {
  scope: AutosaveScope;
  expectedLockVersion: number;
  /** The validated canonical draft being saved. */
  nextDraft: WorkflowDraft;
  /** Its canonical envelope, exactly as the existing save paths build it. */
  canonical: unknown;
  schemaVersion: string;
}

/**
 * Reconciles AI provenance and review state against the authoritative saved
 * draft, then commits everything together.
 */
export async function autosaveWithReconciliation(
  deps: AutosaveReconciliationDeps,
  input: AutosaveInput,
): Promise<AutosaveOutcome> {
  const loaded = await deps.store.loadAiState(input.scope);

  // A persisted review payload ARC cannot fully read is never repaired by an
  // ordinary autosave: nothing is written at all.
  if (loaded.status === "unreadable") return { ok: false, reason: "unavailable" };

  // No sidecar: ordinary autosave, byte-for-byte the pre-Task-4 behaviour.
  if (loaded.status === "absent") {
    const saved = await deps.store.saveDraftOnly({
      scope: input.scope,
      expectedLockVersion: input.expectedLockVersion,
      canonical: input.canonical,
      schemaVersion: input.schemaVersion,
    });
    if (saved === null) return { ok: false, reason: "conflict" };
    return { ok: true, ...saved, reconciled: false };
  }

  const aiState = loaded.state;

  const previousDraft = await deps.store.loadSavedDraft(input.scope);
  if (previousDraft === null) {
    // Once a sidecar exists, ARC cannot know which AI conclusions an edit
    // touched without the authoritative previous draft. It fails closed rather
    // than persisting a draft whose provenance it could not reconcile.
    return { ok: false, reason: "unavailable" };
  }

  const reconciliation = reconcileAiEdits({
    previousDraft,
    nextDraft: input.nextDraft,
    currentAiState: aiState,
  });

  if (!reconciliation.changed) {
    const saved = await deps.store.saveDraftOnly({
      scope: input.scope,
      expectedLockVersion: input.expectedLockVersion,
      canonical: input.canonical,
      schemaVersion: input.schemaVersion,
    });
    if (saved === null) return { ok: false, reason: "conflict" };
    return { ok: true, ...saved, reconciled: false };
  }

  // The server authors the timestamp; the pure layer never reads a clock.
  const stamped = applyEditReviewIntents(
    reconciliation.aiState,
    reconciliation.reviewEvents,
    deps.now().toISOString(),
  );

  const attempt = () =>
    deps.store.saveWithReconciliation({
      scope: input.scope,
      expectedLockVersion: input.expectedLockVersion,
      canonical: input.canonical,
      schemaVersion: input.schemaVersion,
      aiState: stamped,
      reviewEvents: reconciliation.reviewEvents,
    });

  let saved = await attempt();

  // Bounded lock contention. The timed-out transaction wrote nothing, so the
  // expected lock version is still the right one to send. Exactly ONE retry
  // after a short pause — never a loop, and never a false "newer version".
  if (saved === "contention") {
    await (deps.delay ?? defaultDelay)(AUTOSAVE_CONTENTION_RETRY_DELAY_MS);
    saved = await attempt();
    if (saved === "contention") return { ok: false, reason: "contention" };
  }

  if (saved === null) return { ok: false, reason: "conflict" };
  return { ok: true, ...saved, reconciled: true };
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
