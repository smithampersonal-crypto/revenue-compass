/**
 * Phase 9C — service-role store for AI runs.
 *
 * Server-only: blocked from client bundles by its `.server` name, and the AI
 * persistence tables grant nothing at all to `anon` or `authenticated`, so
 * this is the only way they can be reached.
 *
 * Every write goes through a trusted Phase 9C transaction. This module reads
 * the facts a handler needs in order to authorize a caller and never decides
 * ownership, allowance or lifecycle itself.
 */

import type { AiRunRow, AiRunStage, AiRunStore, AiQuotaScope } from "./runs.handlers";

const RUN_COLUMNS =
  "id, stage, revision_id, guest_workspace_id, owner_user_id, guest_token_hash, quota_scope, " +
  "source_count, page_count, input_tokens, review_issue_count, completed_at, safe_message";

const ACTIVE_STAGES = [
  "created",
  "extracting",
  "preflight_ready",
  "analyzing",
  "validating",
  "applying",
];

function fail(operation: string, error: { message?: string }): never {
  throw new Error(`The AI run store is unavailable (${operation}).`, { cause: error });
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
}

function toRow(raw: RawRun): AiRunRow {
  return {
    id: raw.id,
    stage: raw.stage as AiRunStage,
    revisionId: raw.revision_id,
    guestWorkspaceId: raw.guest_workspace_id,
    ownerUserId: raw.owner_user_id,
    guestTokenHash: raw.guest_token_hash,
    quotaScope: raw.quota_scope as AiQuotaScope,
    sourceCount: raw.source_count,
    pageCount: raw.page_count,
    inputTokens: raw.input_tokens,
    reviewIssueCount: raw.review_issue_count,
    completedAt: raw.completed_at,
    safeMessage: raw.safe_message,
  };
}

export async function createAiRunStore(): Promise<AiRunStore> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  return {
    findEditableRevision: async (revisionId, userId) => {
      const { data, error } = await supabaseAdmin
        .from("analysis_revisions")
        .select(
          "id, status, lock_version, analyses!analysis_revisions_analysis_id_fkey!inner(contract_id, contracts!inner(customer_id, customers!inner(owner_user_id)))",
        )
        .eq("id", revisionId)
        .eq("status", "draft")
        .eq("analyses.contracts.customers.owner_user_id", userId)
        .maybeSingle();
      if (error) fail("revision", error);
      if (!data) return null;
      const analyses = data.analyses as unknown as { contract_id: string };
      return { id: data.id, contractId: analyses.contract_id, lockVersion: data.lock_version };
    },

    findActiveGuestWorkspace: async (tokenHash) => {
      const { data, error } = await supabaseAdmin
        .from("guest_workspaces")
        .select("id, lock_version, status, expires_at")
        .eq("token_hash", tokenHash)
        .maybeSingle();
      if (error) fail("temporary workspace", error);
      if (!data) return null;
      // Authorization is the row's own lifetime, never cleanup timing.
      if (data.status !== "active" || new Date(data.expires_at).getTime() <= Date.now()) {
        return null;
      }
      return { id: data.id, lockVersion: data.lock_version };
    },

    findActiveRunForScope: async (scope) => {
      let query = supabaseAdmin.from("ai_runs").select(RUN_COLUMNS).in("stage", ACTIVE_STAGES);
      query = scope.revisionId
        ? query.eq("revision_id", scope.revisionId)
        : query.eq("guest_workspace_id", scope.guestWorkspaceId!);
      const { data, error } = await query.maybeSingle();
      if (error) fail("active run", error);
      return data ? toRow(data as unknown as RawRun) : null;
    },

    findRun: async (runId) => {
      const { data, error } = await supabaseAdmin
        .from("ai_runs")
        .select(RUN_COLUMNS)
        .eq("id", runId)
        .maybeSingle();
      if (error) fail("run", error);
      return data ? toRow(data as unknown as RawRun) : null;
    },

    createRun: async (args) => {
      const { data, error } = await supabaseAdmin.rpc("arc_create_ai_run", {
        p_run_id: args.runId,
        p_owner_user_id: args.ownerUserId,
        p_guest_token_hash: args.guestTokenHash,
        p_revision_id: args.revisionId,
        p_guest_workspace_id: args.guestWorkspaceId,
        p_expected_lock_version: args.expectedLockVersion,
        p_quota_scope: args.quotaScope,
        p_source_set_fingerprint: args.sourceSetFingerprint,
        p_pre_run_canonical_inputs: args.preRunCanonicalInputs as never,
        p_pre_run_ai_state: args.preRunAiState as never,
        p_model: args.model,
        p_reasoning_effort: args.reasoningEffort,
        p_prompt_version: args.promptVersion,
        p_output_schema_version: args.outputSchemaVersion,
        p_guidance_registry_hash: args.guidanceRegistryHash,
      } as never);
      if (error || !data) fail("create run", error ?? {});
      return data as unknown as string;
    },

    monthlyUsage: async (userId, utcMonth) => {
      const { data, error } = await supabaseAdmin
        .from("ai_monthly_usage")
        .select("runs_consumed")
        .eq("user_id", userId)
        .eq("usage_month", utcMonth)
        .maybeSingle();
      if (error) fail("monthly usage", error);
      return data?.runs_consumed ?? 0;
    },

    guestConsumed: async (guestWorkspaceId) => {
      const { count, error } = await supabaseAdmin
        .from("ai_runs")
        .select("id", { count: "exact", head: true })
        .eq("guest_workspace_id", guestWorkspaceId)
        .eq("quota_scope", "guest")
        .not("openai_started_at", "is", null);
      if (error) fail("temporary workspace usage", error);
      return count ?? 0;
    },
  };
}
