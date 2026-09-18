/**
 * Phase 9G — Task 9C. Explicit whole-run restore.
 *
 * Restore replaces the entire current draft and the entire AI sidecar with the
 * exact snapshot the server captured immediately before the restorable run. It
 * is never automatic, never partial, never retried and never a merge: the one
 * trusted routine either applies the whole snapshot or changes nothing.
 *
 * What restore deliberately does NOT touch: the selected source documents, the
 * allowance already consumed, and the immutable run history. Undoing a run's
 * conclusions is not undoing the fact that it ran.
 *
 * Browser-safe: no Supabase client. The trusted routine is injected.
 */

import { restorableRunOf, type AiRestorableRunDto, type AiRestoreCandidate } from "./restore-eligibility";
import { AI_WORKSPACE_NOT_EDITABLE, type AiCallerScope } from "./runs.handlers";
import {
  aiWorkspaceStateHandler,
  type AiWorkspaceDeps,
  type AiWorkspaceStateDto,
} from "./workspace.handlers";

/** The restore is no longer offered at all. */
export const AI_RESTORE_UNAVAILABLE =
  "That AI analysis can no longer be restored. Reload the analysis to see the current draft.";

/** Someone or something else moved the draft first. Nothing was changed. */
export const AI_RESTORE_CONFLICT =
  "The analysis changed before it could be restored. Reload the analysis and try again.";

export interface AiRestoreInput {
  /** The run the accountant confirmed against. Must still be the offered one. */
  expectedRunId: string;
}

export interface AiRestoreResultDto {
  restoredRunId: string;
  workspace: AiWorkspaceStateDto;
}

export interface AiRestoreStore {
  /** Trusted facts about the run a restore would undo. */
  loadRestoreCandidate(caller: AiCallerScope, runId: string): Promise<AiRestoreCandidate | null>;
  /**
   * The trusted `SECURITY DEFINER` routine. It re-checks ownership,
   * editability, active runs, the current run, the lock and the source set
   * itself; this handler's checks are presentation eligibility, not security.
   */
  restorePreAiRun(args: {
    runId: string;
    ownerUserId: string | null;
    guestTokenHash: string | null;
    expectedLockVersion: number;
  }): Promise<{ lockVersion: number; idempotent: boolean }>;
}

export interface AiRestoreDeps extends AiWorkspaceDeps {
  store: AiWorkspaceDeps["store"] & AiRestoreStore;
}

/** The single compatible run a restore may be offered for, or nothing. */
export async function restorableRunForCaller(
  store: AiRestoreDeps["store"],
  caller: AiCallerScope,
  snapshot: {
    lastSuccessfulRunId: string | null;
    currentSourceSetFingerprint: string | null;
    activeRun: boolean;
  },
): Promise<AiRestorableRunDto | null> {
  const candidate = snapshot.lastSuccessfulRunId
    ? await store.loadRestoreCandidate(caller, snapshot.lastSuccessfulRunId)
    : null;
  return restorableRunOf({
    editable: true,
    activeRun: snapshot.activeRun,
    lastSuccessfulRunId: snapshot.lastSuccessfulRunId,
    currentSourceSetFingerprint: snapshot.currentSourceSetFingerprint,
    candidate,
  });
}

/**
 * The deliberate restore action. One confirmation, one attempt, no retry.
 */
export async function restoreAiAnalysisHandler(
  deps: AiRestoreDeps,
  caller: AiCallerScope,
  input: AiRestoreInput,
): Promise<AiRestoreResultDto> {
  // Re-authorize, and take the lock the server itself reads.
  let expectedLockVersion: number;
  if (caller.kind === "revision") {
    const revision = await deps.store.findEditableRevision(caller.revisionId, caller.userId);
    if (!revision) throw new Error(AI_WORKSPACE_NOT_EDITABLE);
    expectedLockVersion = revision.lockVersion;
  } else {
    const workspace = await deps.store.findActiveGuestWorkspace(caller.guestTokenHash);
    if (!workspace) throw new Error(AI_WORKSPACE_NOT_EDITABLE);
    expectedLockVersion = workspace.lockVersion;
  }

  // The offer is re-derived from persistence; the confirmed run must still be
  // exactly the one being offered right now.
  const state = await aiWorkspaceStateHandler(deps, caller);
  const offered = state.restorableRun;
  if (!offered || offered.runId !== input.expectedRunId) throw new Error(AI_RESTORE_UNAVAILABLE);

  try {
    await deps.store.restorePreAiRun({
      runId: offered.runId,
      ownerUserId: caller.kind === "revision" ? caller.userId : null,
      guestTokenHash: caller.kind === "guest" ? caller.guestTokenHash : null,
      expectedLockVersion,
    });
  } catch (error) {
    // The routine's own refusals are conflicts from the accountant's point of
    // view: nothing was changed, and the current draft is still authoritative.
    throw new Error(AI_RESTORE_CONFLICT, { cause: error });
  }

  return {
    restoredRunId: offered.runId,
    workspace: await aiWorkspaceStateHandler(deps, caller),
  };
}
