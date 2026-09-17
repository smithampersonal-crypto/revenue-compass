/**
 * Phase 9G — Task 2. Review actions as dependency-injected handlers.
 *
 * Authority rules, identical to the Phase 9C run handlers:
 *   - the caller scope is derived by the server from the verified session and
 *     the HttpOnly temporary-workspace credential; nothing about ownership,
 *     actor identity, timestamps or resolved state is read from the request;
 *   - the browser names a review item and states the fingerprint of the
 *     conclusion it displayed — a precondition only. The trusted database
 *     routine re-derives the authoritative state and fails closed when the
 *     material conclusion or the selected source set moved on;
 *   - no AI request, no allowance consumption, no accounting recalculation.
 *
 * Browser-safe: no Supabase client, no service-role code, no server-only
 * import. The store boundary is injected.
 */

import type { AiCallerScope, AiRunStore } from "./runs.handlers";
import { AI_WORKSPACE_NOT_EDITABLE } from "./runs.handlers";
import type { AffirmationMethod, ManualRedReason } from "./review-normalization";

/* ---------------------------------------------------------------- copy */

export const AI_REVIEW_ACTION_UNAVAILABLE = "That review action is not available.";
export const AI_REVIEW_ACTION_CONFLICT =
  "This conclusion changed since it was shown to you. Reload the analysis and review it again.";
export const AI_REVIEW_ACTION_FAILED = "That review action could not be completed.";
export const AI_REVIEW_NOTE_LIMIT = 2000;
export const AI_REVIEW_NOTE_TOO_LONG = `Please keep that note under ${AI_REVIEW_NOTE_LIMIT} characters.`;

const AFFIRMATION_METHODS: ReadonlySet<string> = new Set<AffirmationMethod>([
  "individual",
  "page_all",
  "global_all",
]);

const MANUAL_RED_REASONS: ReadonlySet<string> = new Set<ManualRedReason>([
  "reviewed_current_treatment",
  "outside_source_information",
  "not_applicable",
]);

/* --------------------------------------------------------- store shape */

/** Owner identity for a trusted review routine. Authored by the server only. */
export interface AiReviewOwnerScopeArgs {
  ownerUserId: string | null;
  guestTokenHash: string | null;
  revisionId: string | null;
  guestWorkspaceId: string | null;
  expectedLockVersion: number;
}

export interface AiReviewItemActionArgs extends AiReviewOwnerScopeArgs {
  reviewItemId: string;
  expectedReviewFingerprint: string;
}

export interface AiReviewActionResult {
  lockVersion: number;
  alreadyResolved: boolean;
  eventId: string | null;
}

export interface AiSourceAcknowledgementResult {
  lockVersion: number;
  sourceSetFingerprint: string;
  alreadyAcknowledged: boolean;
  eventId: string | null;
}

export interface AiReviewActionStore extends AiRunStore {
  affirmReviewItem(
    args: AiReviewItemActionArgs & { method: AffirmationMethod },
  ): Promise<AiReviewActionResult>;
  resolveReviewIssue(
    args: AiReviewItemActionArgs & { reason: ManualRedReason; note: string | null },
  ): Promise<AiReviewActionResult>;
  acknowledgeStaleSources(
    args: AiReviewOwnerScopeArgs & { expectedSourceSetFingerprint: string },
  ): Promise<AiSourceAcknowledgementResult>;
}

export interface AiReviewActionDeps {
  store: AiReviewActionStore;
}

/* ---------------------------------------------------------- validation */

function requiredText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Re-resolves ownership and reads the authoritative lock version. The browser
 * never supplies either: a stale tab is caught by the fingerprint precondition
 * and by the lock the database takes on the owner row.
 */
async function ownerScopeFor(
  store: AiReviewActionStore,
  caller: AiCallerScope,
): Promise<AiReviewOwnerScopeArgs> {
  if (caller.kind === "revision") {
    const revision = await store.findEditableRevision(caller.revisionId, caller.userId);
    if (!revision) throw new Error(AI_WORKSPACE_NOT_EDITABLE);
    return {
      ownerUserId: caller.userId,
      guestTokenHash: null,
      revisionId: revision.id,
      guestWorkspaceId: null,
      expectedLockVersion: revision.lockVersion,
    };
  }

  const workspace = await store.findActiveGuestWorkspace(caller.guestTokenHash);
  if (!workspace) throw new Error(AI_WORKSPACE_NOT_EDITABLE);
  return {
    ownerUserId: null,
    guestTokenHash: caller.guestTokenHash,
    revisionId: null,
    guestWorkspaceId: workspace.id,
    expectedLockVersion: workspace.lockVersion,
  };
}

/** Database detail never reaches the browser; only settled copy does. */
function safeStoreError(error: unknown): Error {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "40001") return new Error(AI_REVIEW_ACTION_CONFLICT);
  if (code === "42501" || code === "22023") return new Error(AI_REVIEW_ACTION_UNAVAILABLE);
  return new Error(AI_REVIEW_ACTION_FAILED);
}

/* ------------------------------------------------------ yellow affirm */

export interface AffirmReviewItemInput {
  reviewItemId: unknown;
  expectedReviewFingerprint: unknown;
  method?: unknown;
}

export async function affirmReviewItemHandler(
  deps: AiReviewActionDeps,
  caller: AiCallerScope,
  input: AffirmReviewItemInput,
): Promise<{ applied: true; alreadyResolved: boolean; lockVersion: number }> {
  const reviewItemId = requiredText(input.reviewItemId);
  const expectedReviewFingerprint = requiredText(input.expectedReviewFingerprint);
  const method = input.method === undefined ? "individual" : input.method;
  if (!reviewItemId || !expectedReviewFingerprint) {
    throw new Error(AI_REVIEW_ACTION_UNAVAILABLE);
  }
  if (typeof method !== "string" || !AFFIRMATION_METHODS.has(method)) {
    throw new Error(AI_REVIEW_ACTION_UNAVAILABLE);
  }

  const scope = await ownerScopeFor(deps.store, caller);
  try {
    const result = await deps.store.affirmReviewItem({
      ...scope,
      reviewItemId,
      expectedReviewFingerprint,
      method: method as AffirmationMethod,
    });
    return {
      applied: true,
      alreadyResolved: result.alreadyResolved,
      lockVersion: result.lockVersion,
    };
  } catch (error) {
    throw safeStoreError(error);
  }
}

/* ------------------------------------------------- manual red resolution */

export interface ResolveReviewIssueInput {
  reviewItemId: unknown;
  expectedReviewFingerprint: unknown;
  reason: unknown;
  note?: unknown;
}

export async function resolveReviewIssueHandler(
  deps: AiReviewActionDeps,
  caller: AiCallerScope,
  input: ResolveReviewIssueInput,
): Promise<{ applied: true; alreadyResolved: boolean; lockVersion: number }> {
  const reviewItemId = requiredText(input.reviewItemId);
  const expectedReviewFingerprint = requiredText(input.expectedReviewFingerprint);
  if (!reviewItemId || !expectedReviewFingerprint) {
    throw new Error(AI_REVIEW_ACTION_UNAVAILABLE);
  }
  if (typeof input.reason !== "string" || !MANUAL_RED_REASONS.has(input.reason)) {
    throw new Error(AI_REVIEW_ACTION_UNAVAILABLE);
  }
  const rawNote = input.note;
  if (rawNote !== undefined && rawNote !== null && typeof rawNote !== "string") {
    throw new Error(AI_REVIEW_ACTION_UNAVAILABLE);
  }
  const note = typeof rawNote === "string" ? (rawNote.trim() || null) : null;
  if (note && note.length > AI_REVIEW_NOTE_LIMIT) {
    throw new Error(AI_REVIEW_NOTE_TOO_LONG);
  }

  const scope = await ownerScopeFor(deps.store, caller);
  try {
    const result = await deps.store.resolveReviewIssue({
      ...scope,
      reviewItemId,
      expectedReviewFingerprint,
      reason: input.reason as ManualRedReason,
      note,
    });
    return {
      applied: true,
      alreadyResolved: result.alreadyResolved,
      lockVersion: result.lockVersion,
    };
  } catch (error) {
    throw safeStoreError(error);
  }
}

/* --------------------------------------------- stale-source acknowledgment */

export interface AcknowledgeStaleSourcesInput {
  expectedSourceSetFingerprint: unknown;
}

export async function acknowledgeStaleSourcesHandler(
  deps: AiReviewActionDeps,
  caller: AiCallerScope,
  input: AcknowledgeStaleSourcesInput,
): Promise<{
  acknowledged: true;
  alreadyAcknowledged: boolean;
  sourceSetFingerprint: string;
  lockVersion: number;
}> {
  const expectedSourceSetFingerprint = requiredText(input.expectedSourceSetFingerprint);
  if (!expectedSourceSetFingerprint) throw new Error(AI_REVIEW_ACTION_UNAVAILABLE);

  const scope = await ownerScopeFor(deps.store, caller);
  try {
    const result = await deps.store.acknowledgeStaleSources({
      ...scope,
      expectedSourceSetFingerprint,
    });
    return {
      acknowledged: true,
      alreadyAcknowledged: result.alreadyAcknowledged,
      sourceSetFingerprint: result.sourceSetFingerprint,
      lockVersion: result.lockVersion,
    };
  } catch (error) {
    throw safeStoreError(error);
  }
}
