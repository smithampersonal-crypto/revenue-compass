/**
 * Phase 9G — Task 3 patch. The server-function boundary for the safe AI
 * workspace API.
 *
 * A TanStack server function serialises whatever it throws back across the
 * RPC boundary, so the sanitising cannot live only inside the handlers: a
 * validator exception happens before any handler runs. Everything a Task 3
 * server function can throw passes through here first.
 *
 * Two rules, both deliberately dull:
 *   - input is parsed by pure, total helpers that refuse with settled ARC copy
 *     rather than a validator's own message, issue array or type description;
 *   - an error leaving a handler must already be an approved ARC string;
 *     anything else — a Supabase message, a SQLSTATE, a provider name, a stack
 *     trace, an unknown throw — becomes one generic ARC failure message, with
 *     no interpolation and no `cause` chain attached.
 *
 * Pure and browser-safe: no persistence, no provider, no I/O.
 */

import {
  AI_REVIEW_ACTION_CONFLICT,
  AI_REVIEW_ACTION_FAILED,
  AI_REVIEW_ACTION_UNAVAILABLE,
  AI_REVIEW_NOTE_LIMIT,
  AI_REVIEW_NOTE_TOO_LONG,
} from "./review-actions.handlers";
import { MANUAL_RED_REASONS as APPROVED_RED_REASONS } from "./review-state";
import type { AiAffirmationMethod, ManualRedReason } from "./review-state";
import { AI_RUN_NOT_AVAILABLE, AI_WORKSPACE_NOT_EDITABLE } from "./runs.handlers";

/** A request the browser malformed. Never describes what was wrong with it. */
export const AI_WORKSPACE_REQUEST_INVALID =
  "That request could not be completed. Reload the analysis and try again.";

/** The single generic outcome for anything unexpected. */
export const AI_WORKSPACE_ACTION_FAILED =
  "That action could not be completed. Reload the analysis and try again.";

const MANUAL_RED_REASONS: ReadonlySet<string> = new Set<string>(APPROVED_RED_REASONS);

/** The three methods Task 2 accepts from a browser request. */
const AFFIRMATION_METHODS: ReadonlySet<string> = new Set<string>([
  "individual",
  "page_all",
  "global_all",
]);


/**
 * The allowlist of messages that may stay distinguishable. Each is ARC-owned,
 * settled copy that an accountant is meant to act on.
 */
const SAFE_MESSAGES: ReadonlySet<string> = new Set<string>([
  AI_WORKSPACE_NOT_EDITABLE,
  AI_RUN_NOT_AVAILABLE,
  AI_REVIEW_ACTION_CONFLICT,
  AI_REVIEW_ACTION_UNAVAILABLE,
  AI_REVIEW_ACTION_FAILED,
  AI_REVIEW_NOTE_TOO_LONG,
  AI_WORKSPACE_REQUEST_INVALID,
  AI_WORKSPACE_ACTION_FAILED,
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function refuse(message: string): never {
  throw new Error(message);
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) return null;
  return trimmed;
}

/* ------------------------------------------------------ input parsing */

/** The resource the browser is asking about. Never an ownership claim. */
export function parseRevisionTarget(input: { revisionId?: unknown } | undefined): string | null {
  const value = input?.revisionId;
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !UUID.test(value)) refuse(AI_WORKSPACE_REQUEST_INVALID);
  return value;
}

export function parseReviewItemTarget(input: {
  reviewItemId?: unknown;
  expectedReviewFingerprint?: unknown;
}): { reviewItemId: string; expectedReviewFingerprint: string } {
  const reviewItemId = text(input?.reviewItemId, 200);
  const expectedReviewFingerprint = text(input?.expectedReviewFingerprint, 200);
  if (!reviewItemId || !expectedReviewFingerprint) refuse(AI_REVIEW_ACTION_UNAVAILABLE);
  return { reviewItemId, expectedReviewFingerprint };
}

export function parseSourceFingerprint(input: {
  expectedSourceSetFingerprint?: unknown;
}): string {
  const fingerprint = text(input?.expectedSourceSetFingerprint, 200);
  if (!fingerprint) refuse(AI_REVIEW_ACTION_UNAVAILABLE);
  return fingerprint;
}

export function parseAffirmationMethod(input: {
  method?: unknown;
}): AiAffirmationMethod | undefined {
  const value = input?.method;
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !AFFIRMATION_METHODS.has(value)) {
    refuse(AI_REVIEW_ACTION_UNAVAILABLE);
  }
  return value as AiAffirmationMethod;
}

export function parseManualRedReason(input: { reason?: unknown }): ManualRedReason {
  const value = input?.reason;
  if (typeof value !== "string" || !MANUAL_RED_REASONS.has(value)) {
    refuse(AI_REVIEW_ACTION_UNAVAILABLE);
  }
  return value as ManualRedReason;
}

export function parseReviewNote(input: { note?: unknown }): string | null {
  const value = input?.note;
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") refuse(AI_REVIEW_ACTION_UNAVAILABLE);
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > AI_REVIEW_NOTE_LIMIT) refuse(AI_REVIEW_NOTE_TOO_LONG);
  return trimmed;
}

/* --------------------------------------------------- error sanitising */

/** Settled copy only. An unrecognised message is replaced, never rewritten. */
export function sanitizeWorkspaceError(error: unknown): Error {
  const message = error instanceof Error ? error.message : null;
  if (message !== null && SAFE_MESSAGES.has(message)) return new Error(message);
  return new Error(AI_WORKSPACE_ACTION_FAILED);
}

/**
 * The wrapper every Task 3 server function runs its work inside. Server-side
 * diagnostics stay server-side; only the settled message crosses the RPC
 * boundary.
 */
export async function safeWorkspaceCall<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw sanitizeWorkspaceError(error);
  }
}
