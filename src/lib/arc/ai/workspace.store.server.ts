/**
 * Phase 9G — Task 3. Service-role reads for the safe workspace boundary.
 *
 * Server-only: blocked from client bundles by its `.server` name. The AI
 * tables grant nothing to `anon` or `authenticated`, so this is the only way
 * the workspace snapshot can be read at all.
 *
 * Read-only by construction. Nothing here creates a run, reserves allowance,
 * moves a lock, writes an audit event or contacts a provider; the mutating
 * half is inherited unchanged from the accepted Task 2 review-action store.
 * This module decides nothing — it hands trusted facts to the handler.
 */

import { normalizePersistedReviewItems } from "./review-normalization";
import { createAiReviewActionStore } from "./review-actions.store.server";
import type { AiCallerScope, AiRunStage } from "./runs.handlers";
import type {
  AiWorkspaceRunRecord,
  AiWorkspaceSnapshot,
  AiWorkspaceStore,
} from "./workspace.handlers";

const RUN_COLUMNS =
  "id, stage, revision_id, guest_workspace_id, owner_user_id, guest_token_hash, quota_scope, " +
  "source_count, page_count, input_tokens, review_issue_count, completed_at, safe_message, " +
  "failure_stage, failure_category, failure_code, openai_started_at, created_at";

function fail(operation: string, error: { message?: string }): never {
  throw new Error(`The AI workspace store is unavailable (${operation}).`, { cause: error });
}

interface RawRun {
  id: string;
  stage: string;
  revision_id: string | null;
  guest_workspace_id: string | null;
  owner_user_id: string | null;
  guest_token_hash: string | null;
  quota_scope: string;
  source_count: number;
  page_count: number;
  input_tokens: number | null;
  review_issue_count: number;
  completed_at: string | null;
  safe_message: string | null;
  failure_stage: string | null;
  failure_category: string | null;
  failure_code: string | null;
  openai_started_at: string | null;
}

function toRecord(raw: RawRun): AiWorkspaceRunRecord {
  return {
    id: raw.id,
    stage: raw.stage as AiRunStage,
    revisionId: raw.revision_id,
    guestWorkspaceId: raw.guest_workspace_id,
    ownerUserId: raw.owner_user_id,
    guestTokenHash: raw.guest_token_hash,
    quotaScope: raw.quota_scope as AiWorkspaceRunRecord["quotaScope"],
    sourceCount: raw.source_count,
    pageCount: raw.page_count,
    inputTokens: raw.input_tokens,
    reviewIssueCount: raw.review_issue_count,
    completedAt: raw.completed_at,
    safeMessage: raw.safe_message,
    failureStage: raw.failure_stage,
    failureCategory: raw.failure_category,
    failureCode: raw.failure_code,
    // The provider-start boundary: allowance and `openai_started_at` are set
    // by the same trusted reservation, so this is the authoritative fact.
    allowanceConsumed: raw.openai_started_at !== null,
  };
}

export async function createAiWorkspaceStore(): Promise<AiWorkspaceStore> {
  const reviewStore = await createAiReviewActionStore();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  return {
    ...reviewStore,

    loadWorkspaceSnapshot: async (caller: AiCallerScope): Promise<AiWorkspaceSnapshot> => {
      const column = caller.kind === "revision" ? "revision_id" : "guest_workspace_id";
      const value = caller.kind === "revision" ? caller.revisionId : caller.guestWorkspaceId;

      const { data, error } = await supabaseAdmin
        .from("ai_analysis_state")
        .select(
          "last_successful_run_id, source_state, acknowledged_source_fingerprint, review_items",
        )
        .eq(column, value)
        .maybeSingle();
      if (error) fail("AI analysis state", error);

      const raw = (data ?? null) as Record<string, unknown> | null;

      // The authoritative current selection fingerprint, derived by the same
      // trusted routine the review acknowledgment re-derives internally.
      const fingerprint = await supabaseAdmin.rpc("arc_ai_source_set_fingerprint", {
        revision_id: caller.kind === "revision" ? caller.revisionId : null,
        guest_workspace_id: caller.kind === "guest" ? caller.guestWorkspaceId : null,
      } as never);
      if (fingerprint.error) fail("source set fingerprint", fingerprint.error);

      let guestWorkspaceExpiresAt: string | null = null;
      if (caller.kind === "guest") {
        const workspace = await supabaseAdmin
          .from("guest_workspaces")
          .select("expires_at")
          .eq("id", caller.guestWorkspaceId)
          .maybeSingle();
        if (workspace.error) fail("temporary workspace", workspace.error);
        guestWorkspaceExpiresAt = workspace.data?.expires_at ?? null;
      }

      // Persisted review JSON is data, never a typed value: it is re-validated
      // before anything is counted, exactly as the finalization gate does.
      const items = raw ? normalizePersistedReviewItems(raw["review_items"]) : [];

      return {
        lastSuccessfulRunId: (raw?.["last_successful_run_id"] as string | null) ?? null,
        currentSourceSetFingerprint: (fingerprint.data as string | null) ?? null,
        sourceState: (raw?.["source_state"] as AiWorkspaceSnapshot["sourceState"]) ?? "none",
        acknowledgedSourceFingerprint:
          (raw?.["acknowledged_source_fingerprint"] as string | null) ?? null,
        outstandingReviewIssueCount: items.filter((item) => item.state !== "resolved").length,
        guestWorkspaceExpiresAt,
      };
    },

    findLatestRunForScope: async (scope) => {
      let query = supabaseAdmin.from("ai_runs").select(RUN_COLUMNS);
      query = scope.revisionId
        ? query.eq("revision_id", scope.revisionId)
        : query.eq("guest_workspace_id", scope.guestWorkspaceId ?? "");
      const { data, error } = await query
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) fail("latest run", error);
      return data ? toRecord(data as unknown as RawRun) : null;
    },
  };
}
