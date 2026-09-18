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

import { normalizePersistedReviewPayload } from "./review-normalization";
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
          "last_successful_run_id, source_state, acknowledged_source_fingerprint, review_items, " +
            "field_provenance, object_provenance",
        )
        .eq(column, value)
        .maybeSingle();
      if (error) fail("AI analysis state", error);

      const raw = (data ?? null) as Record<string, unknown> | null;

      // The authoritative current selection fingerprint, derived by the same
      // trusted routine the review acknowledgment re-derives internally.
      const fingerprint = await supabaseAdmin.rpc("arc_ai_source_set_fingerprint", {
        p_revision_id: caller.kind === "revision" ? caller.revisionId : null,
        p_guest_workspace_id: caller.kind === "guest" ? caller.guestWorkspaceId : null,
      } as never);
      if (fingerprint.error) fail("source set fingerprint", fingerprint.error);

      // Authoritative source presence, read from the actual selection rows and
      // from nothing else: never from `source_state`, the fingerprint or a
      // previous run. Only the existence of a row is read — no id, no count.
      const selection =
        caller.kind === "revision"
          ? await supabaseAdmin
              .from("revision_source_documents")
              .select("source_document_id")
              .eq("revision_id", caller.revisionId)
              .limit(1)
          : await supabaseAdmin
              .from("guest_source_document_selections")
              .select("source_document_id")
              .eq("guest_workspace_id", caller.guestWorkspaceId)
              .limit(1);
      if (selection.error) fail("included source documents", selection.error);
      const hasIncludedSources = (selection.data ?? []).length > 0;

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
      // before anything is counted, exactly as the finalization gate does. The
      // payload form is used rather than the tolerant item form, so a row that
      // could not be read is reported as unavailable instead of disappearing.
      const review = raw
        ? normalizePersistedReviewPayload(raw["review_items"])
        : { items: [], malformed: false };

      return {
        lastSuccessfulRunId: (raw?.["last_successful_run_id"] as string | null) ?? null,
        currentSourceSetFingerprint: (fingerprint.data as string | null) ?? null,
        sourceState: (raw?.["source_state"] as AiWorkspaceSnapshot["sourceState"]) ?? "none",
        hasIncludedSources,
        acknowledgedSourceFingerprint:
          (raw?.["acknowledged_source_fingerprint"] as string | null) ?? null,
        outstandingReviewIssueCount: review.items.filter((item) => item.state !== "resolved")
          .length,
        reviewItems: review.items,
        reviewPayloadMalformed: review.malformed,
        // Raw persisted JSON. The handler validates it before anything is
        // presented; nothing here casts it into a typed provenance value.
        fieldProvenance: raw?.["field_provenance"] ?? null,
        objectProvenance: raw?.["object_provenance"] ?? null,
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

    /**
     * Phase 9G — Task 9C. Trusted facts about the run a restore would undo.
     * Read-only: the snapshot itself is never returned, only its shape.
     */
    loadRestoreCandidate: async (caller, runId): Promise<AiRestoreCandidate | null> => {
      const { data, error } = await supabaseAdmin
        .from("ai_runs")
        .select(
          "id, stage, completed_at, restored_at, source_set_fingerprint, pre_run_ai_state, " +
            "revision_id, guest_workspace_id, owner_user_id",
        )
        .eq("id", runId)
        .maybeSingle();
      if (error) fail("restorable run", error);
      if (!data) return null;
      const raw = data as unknown as Record<string, unknown>;

      // Scope ownership is re-proved here, not inferred from the run id.
      const belongsToScope =
        caller.kind === "revision"
          ? raw["revision_id"] === caller.revisionId && raw["owner_user_id"] === caller.userId
          : raw["guest_workspace_id"] === caller.guestWorkspaceId;

      return {
        runId: raw["id"] as string,
        stage: raw["stage"] as AiRunStage,
        completedAt: (raw["completed_at"] as string | null) ?? null,
        restoredAt: (raw["restored_at"] as string | null) ?? null,
        sourceSetFingerprint: (raw["source_set_fingerprint"] as string | null) ?? "",
        preRunSnapshot: classifyPreRunSnapshot(raw["pre_run_ai_state"] ?? null),
        belongsToScope,
      };
    },

    /** The trusted restore routine. It re-checks everything itself. */
    restorePreAiRun: async (args) => {
      const { data, error } = await supabaseAdmin.rpc("arc_restore_pre_ai_run", {
        p_run_id: args.runId,
        p_owner_user_id: args.ownerUserId,
        p_guest_token_hash: args.guestTokenHash,
        p_expected_lock_version: args.expectedLockVersion,
      } as never);
      if (error) fail("restore", error);
      const row = (Array.isArray(data) ? data[0] : data) as
        | { lock_version: number; idempotent: boolean }
        | undefined;
      return {
        lockVersion: row?.lock_version ?? args.expectedLockVersion,
        idempotent: row?.idempotent === true,
      };
    },
  };
}
