/**
 * Phase 9G — Task 2. Service-role store for review actions.
 *
 * Server-only: blocked from client bundles by its `.server` name. The review
 * tables grant nothing to `anon` or `authenticated`, so every mutation goes
 * through a trusted Phase 9G routine that re-proves ownership, re-derives the
 * authoritative fingerprints, authors actor identity and timestamps itself and
 * writes the audit event in the same transaction.
 *
 * This module decides nothing. It forwards the server-derived owner scope and
 * preserves the database error code so the handler can turn a concurrency
 * failure into settled plain-language copy.
 */

import { createAiRunStore } from "./runs.store.server";
import type {
  AiReviewActionResult,
  AiReviewActionStore,
  AiSourceAcknowledgementResult,
} from "./review-actions.handlers";

interface CodedError {
  code?: string;
  message?: string;
}

function fail(operation: string, error: CodedError): never {
  const thrown = new Error(`The review action store is unavailable (${operation}).`, {
    cause: error,
  }) as Error & { code?: string };
  if (error?.code) thrown.code = error.code;
  throw thrown;
}

function firstRow<T>(data: unknown): T | null {
  if (Array.isArray(data)) return (data[0] as T) ?? null;
  return (data as T) ?? null;
}

export async function createAiReviewActionStore(): Promise<AiReviewActionStore> {
  const runStore = await createAiRunStore();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // The Phase 9G routines are newer than the generated database types, so the
  // call surface is narrowed locally instead of being typed against them.
  // Keep the method bound to the client; a detached `rpc` loses `this`.
  const rpc = supabaseAdmin.rpc.bind(supabaseAdmin) as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: CodedError | null }>;

  return {
    ...runStore,

    affirmReviewItem: async (args) => {
      const { data, error } = await rpc("arc_affirm_ai_review_item", {
        p_owner_user_id: args.ownerUserId,
        p_actor_user_id: args.actorUserId,
        p_guest_token_hash: args.guestTokenHash,
        p_revision_id: args.revisionId,
        p_guest_workspace_id: args.guestWorkspaceId,
        p_expected_lock_version: args.expectedLockVersion,
        p_review_item_id: args.reviewItemId,
        p_expected_review_fingerprint: args.expectedReviewFingerprint,
        p_method: args.method,
      });
      if (error) fail("affirm review item", error);
      const row = firstRow<{
        lock_version: number;
        already_resolved: boolean;
        event_id: string | null;
      }>(data);
      if (!row) fail("affirm review item", {});
      return {
        lockVersion: row.lock_version,
        alreadyResolved: row.already_resolved,
        eventId: row.event_id ?? null,
      } satisfies AiReviewActionResult;
    },

    resolveReviewIssue: async (args) => {
      const { data, error } = await rpc("arc_resolve_ai_review_issue", {
        p_owner_user_id: args.ownerUserId,
        p_actor_user_id: args.actorUserId,
        p_guest_token_hash: args.guestTokenHash,
        p_revision_id: args.revisionId,
        p_guest_workspace_id: args.guestWorkspaceId,
        p_expected_lock_version: args.expectedLockVersion,
        p_review_item_id: args.reviewItemId,
        p_expected_review_fingerprint: args.expectedReviewFingerprint,
        p_reason: args.reason,
        p_note: args.note,
      });
      if (error) fail("resolve review issue", error);
      const row = firstRow<{
        lock_version: number;
        already_resolved: boolean;
        event_id: string | null;
      }>(data);
      if (!row) fail("resolve review issue", {});
      return {
        lockVersion: row.lock_version,
        alreadyResolved: row.already_resolved,
        eventId: row.event_id ?? null,
      } satisfies AiReviewActionResult;
    },

    acknowledgeStaleSources: async (args) => {
      const { data, error } = await rpc("arc_acknowledge_ai_stale_sources", {
        p_owner_user_id: args.ownerUserId,
        p_actor_user_id: args.actorUserId,
        p_guest_token_hash: args.guestTokenHash,
        p_revision_id: args.revisionId,
        p_guest_workspace_id: args.guestWorkspaceId,
        p_expected_lock_version: args.expectedLockVersion,
        p_expected_source_set_fingerprint: args.expectedSourceSetFingerprint,
      });
      if (error) fail("acknowledge stale sources", error);
      const row = firstRow<{
        lock_version: number;
        source_set_fingerprint: string;
        already_acknowledged: boolean;
        event_id: string | null;
      }>(data);
      if (!row) fail("acknowledge stale sources", {});
      return {
        lockVersion: row.lock_version,
        sourceSetFingerprint: row.source_set_fingerprint,
        alreadyAcknowledged: row.already_acknowledged,
        eventId: row.event_id ?? null,
      } satisfies AiSourceAcknowledgementResult;
    },
  };
}
