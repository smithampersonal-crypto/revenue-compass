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

import { parseCanonicalInputs, toCanonicalInputs } from "@/lib/arc/persistence/schema";

import { createEmptyAiAnalysisState, type AiAnalysisState } from "./merge";
import { normalizePersistedReviewItems } from "./review-normalization";
import { parseAiContractAnalysis } from "./schema";
import { decodeTombstones } from "./tombstones";
import { computeSourceSetFingerprint, type AiSourceIdentity } from "./source-fingerprint";

import { AiApplyConflictError } from "./orchestrator";
import { createPriorRevisionReader, loadPriorAccountingContext } from "./prior-context.server";
import type { AiApplyArgs, AiExecutionContext, AiRunExecutionStore } from "./orchestrator";
import { manualAccountingFacts } from "./manual-facts";
import type {
  AiCallerScope,
  AiRunCreationSnapshot,
  AiRunRow,
  AiRunStage,
  AiRunStore,
  AiQuotaScope,
} from "./runs.handlers";

// Phase 9G — Task 9C. Every column the sidecar has, so the pre-run snapshot
// captured here is exactly restorable: the three Task 2 acknowledgment fields
// are part of the AI state a restore must put back, not incidental metadata.
const AI_STATE_COLUMNS =
  "last_successful_run_id, source_set_fingerprint, source_state, field_provenance, " +
  "object_provenance, tombstones, review_items, lock_version, " +
  "acknowledged_source_fingerprint, source_acknowledged_at, source_acknowledged_by";

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

export async function createAiRunStore(): Promise<AiRunExecutionStore> {
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

    loadRunCreationSnapshot: async (caller: AiCallerScope): Promise<AiRunCreationSnapshot> => {
      // Metadata only: no PDF is downloaded, no page is parsed, no Guidance
      // retrieval or token counting happens here.
      const identities = (rows: unknown[]): AiSourceIdentity[] =>
        rows
          .map(
            (row) => (row as { source_documents: { id: string; sha256: string } }).source_documents,
          )
          .map((doc) => ({ documentId: doc.id, sha256: doc.sha256 }));

      const aiState = async (
        column: "revision_id" | "guest_workspace_id",
        value: string,
      ): Promise<unknown | null> => {
        const { data, error } = await supabaseAdmin
          .from("ai_analysis_state")
          .select(AI_STATE_COLUMNS)
          .eq(column, value)
          .maybeSingle();
        if (error) fail("AI analysis state", error);
        return data ?? null;
      };

      if (caller.kind === "revision") {
        const { data, error } = await supabaseAdmin
          .from("analysis_revisions")
          .select("canonical_inputs, lock_version")
          .eq("id", caller.revisionId)
          .maybeSingle();
        if (error) fail("revision snapshot", error);
        if (!data) throw new Error("The analysis is no longer open for editing.");
        const selected = await supabaseAdmin
          .from("revision_source_documents")
          .select("source_documents!inner(id, sha256)")
          .eq("revision_id", caller.revisionId);
        if (selected.error) fail("selected source documents", selected.error);
        return {
          expectedLockVersion: data.lock_version,
          sourceSetFingerprint: await computeSourceSetFingerprint(identities(selected.data ?? [])),
          preRunCanonicalInputs: data.canonical_inputs,
          preRunAiState: await aiState("revision_id", caller.revisionId),
        };
      }

      const { data, error } = await supabaseAdmin
        .from("guest_workspaces")
        .select("draft_json, lock_version")
        .eq("id", caller.guestWorkspaceId)
        .maybeSingle();
      if (error) fail("temporary workspace snapshot", error);
      if (!data) throw new Error("This temporary workspace is no longer available.");
      const selected = await supabaseAdmin
        .from("guest_source_document_selections")
        .select("source_documents!inner(id, sha256)")
        .eq("guest_workspace_id", caller.guestWorkspaceId);
      if (selected.error) fail("selected source documents", selected.error);
      const sources = identities(selected.data ?? []);

      return {
        expectedLockVersion: data.lock_version,
        sourceSetFingerprint: await computeSourceSetFingerprint(sources),
        preRunCanonicalInputs: data.draft_json,
        preRunAiState: await aiState("guest_workspace_id", caller.guestWorkspaceId),
      };
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

    /* ------------------------------------------------- Phase 9F execution */

    advanceStage: async (runId, from, to) => {
      const { data, error } = await supabaseAdmin.rpc("arc_advance_ai_run_stage", {
        p_run_id: runId,
        p_from: from,
        p_to: to,
      } as never);
      if (error) fail("run stage", error);
      // `false` means another caller already claimed this transition.
      return data === true;
    },

    loadExecutionContext: async (caller): Promise<AiExecutionContext> => {
      const state = async (column: "revision_id" | "guest_workspace_id", value: string) => {
        const { data, error } = await supabaseAdmin
          .from("ai_analysis_state")
          .select(AI_STATE_COLUMNS)
          .eq(column, value)
          .maybeSingle();
        if (error) fail("AI analysis state", error);
        if (!data) return createEmptyAiAnalysisState();
        const raw = data as unknown as Record<string, unknown>;
        return {
          lastSuccessfulRunId: (raw["last_successful_run_id"] as string | null) ?? null,
          sourceSetFingerprint: (raw["source_set_fingerprint"] as string | null) ?? null,
          sourceState: raw["source_state"] as AiAnalysisState["sourceState"],
          fieldProvenance: raw["field_provenance"] as AiAnalysisState["fieldProvenance"],
          objectProvenance: raw["object_provenance"] as AiAnalysisState["objectProvenance"],
          ...decodeTombstones(raw["tombstones"]),
          // Persisted review JSON is data, never a typed value: every row is
          // re-validated here before it can reach re-analysis carry-forward.
          reviewItems: normalizePersistedReviewItems(raw["review_items"]),
        };
      };

      /**
       * Phase 9G-R3. The immutable structured output of the last successful
       * run, read ONLY so the merge can backfill identity signatures a sidecar
       * written before this patch never recorded. It contributes no accounting
       * value and is absent whenever the run or its payload is unreadable.
       */
      const priorAnalysis = async (aiState: AiAnalysisState) => {
        if (aiState.lastSuccessfulRunId === null) return null;
        const needsBackfill = Object.values(aiState.objectProvenance).some(
          (provenance) => provenance.identitySignature === undefined,
        );
        if (!needsBackfill) return null;
        const { data, error } = await supabaseAdmin
          .from("ai_runs")
          .select("result_metadata")
          .eq("id", aiState.lastSuccessfulRunId)
          .maybeSingle();
        if (error || !data) return null;
        const parsed = parseAiContractAnalysis((data as { result_metadata: unknown }).result_metadata);
        return parsed.ok ? parsed.analysis : null;
      };

      if (caller.kind === "revision") {
        const { data, error } = await supabaseAdmin
          .from("analysis_revisions")
          .select("canonical_inputs, schema_version, lock_version")
          .eq("id", caller.revisionId)
          .maybeSingle();
        if (error) fail("revision", error);
        if (!data) throw new Error("This analysis is no longer open for editing.");
        // The stored value is the canonical ENVELOPE, not a bare draft. It is
        // validated here exactly as every other reader does, so the merge
        // always receives a complete, schema-checked WorkflowDraft.
        const parsed = parseCanonicalInputs(data.canonical_inputs, data.schema_version);
        if (!parsed.ok) throw new Error(parsed.reason);
        const draft = parsed.draft;
        const revisionAiState = await state("revision_id", caller.revisionId);
        return {
          draft,
          aiState: revisionAiState,
          priorAnalysis: await priorAnalysis(revisionAiState),
          // An amendment is analyzed against the exact finalized revision it
          // supersedes. That history is trusted ARC context and read-only.
          priorContext: await loadPriorAccountingContext(
            await createPriorRevisionReader(),
            caller.revisionId,
          ),
          schemaVersion: data.schema_version,
          lockVersion: data.lock_version,
          manuallyEnteredFacts: manualAccountingFacts(draft),
          arcFactSignals: [],
        };
      }

      const { data, error } = await supabaseAdmin
        .from("guest_workspaces")
        .select("draft_json, schema_version, lock_version")
        .eq("id", caller.guestWorkspaceId)
        .maybeSingle();
      if (error) fail("temporary workspace", error);
      if (!data) throw new Error("This temporary workspace is no longer available.");
      const parsedGuest = parseCanonicalInputs(data.draft_json, data.schema_version);
      if (!parsedGuest.ok) throw new Error(parsedGuest.reason);
      const draft = parsedGuest.draft;
      const guestAiState = await state("guest_workspace_id", caller.guestWorkspaceId);
      return {
        draft,
        aiState: guestAiState,
        priorAnalysis: await priorAnalysis(guestAiState),
        priorContext: null,
        schemaVersion: data.schema_version,
        lockVersion: data.lock_version,
        manuallyEnteredFacts: manualAccountingFacts(draft),
        arcFactSignals: [],
      };
    },

    recordPreflight: async (args) => {
      const { GUIDANCE_REGISTRY_HASH } = await import("@/lib/arc/guidance/registry");
      // The trusted routine reads the persisted column names, so the payload is
      // translated here once; position is the packaged evidence order.
      const { error } = await supabaseAdmin.rpc("arc_record_ai_preflight", {
        p_run_id: args.runId,
        p_source_set_fingerprint: args.sourceSetFingerprint,
        p_sources: args.sources.map((source, index) => ({
          source_document_id: source.documentId,
          position: index,
          sha256: source.sha256,
          byte_size: source.byteSize,
          page_count: source.pageCount,
        })) as never,
        p_guidance: args.guidance.map((card) => ({
          card_id: card.cardId,
          inclusion_reason: card.inclusionReason,
          matched_signals: card.matchedSignals,
          registry_hash: GUIDANCE_REGISTRY_HASH,
        })) as never,
        p_source_count: args.sourceCount,
        p_page_count: args.pageCount,
        p_input_tokens: args.inputTokens,
      } as never);
      if (error) fail("preflight", error);
    },

    reserveAllowance: async (args) => {
      const { data, error } = await supabaseAdmin.rpc("arc_reserve_ai_allowance", {
        p_run_id: args.runId,
        p_owner_user_id: args.ownerUserId,
        p_guest_token_hash: args.guestTokenHash,
        p_utc_month: args.utcMonth,
        p_user_monthly_limit: args.userMonthlyLimit,
        p_guest_limit: args.guestLimit,
      } as never);
      if (error) fail("allowance", error);
      const row = (data as unknown as Array<Record<string, unknown>>)[0] ?? {};
      return {
        reserved: Boolean(row["reserved"]),
        alreadyReserved: Boolean(row["already_reserved"]),
        remainingAllowance: Number(row["remaining_allowance"] ?? 0),
      };
    },

    applyRun: async (args: AiApplyArgs) => {
      const { error } = await supabaseAdmin.rpc("arc_apply_ai_run", {
        p_run_id: args.runId,
        p_owner_user_id: args.ownerUserId,
        p_guest_token_hash: args.guestTokenHash,
        p_expected_lock_version: args.expectedLockVersion,
        // Written back in the same canonical envelope every other writer uses.
        p_canonical_inputs: toCanonicalInputs(args.canonicalInputs) as never,
        p_schema_version: args.schemaVersion,
        p_ai_state: args.aiState as never,
        p_source_set_fingerprint: args.sourceSetFingerprint,
        p_structured_result: args.structuredResult as never,
        p_usage_metadata: args.usageMetadata as never,
        p_review_issue_count: args.reviewIssueCount,
      } as never);
      // A lost optimistic lock is a retryable local conflict, not a failure.
      if (error && (error as { code?: string }).code === "PT409") {
        throw new AiApplyConflictError();
      }
      if (error) fail("apply run", error);
    },

    restorePreRun: async (args) => {
      const { error } = await supabaseAdmin.rpc("arc_restore_pre_ai_run", {
        p_run_id: args.runId,
        p_owner_user_id: args.ownerUserId,
        p_guest_token_hash: args.guestTokenHash,
        p_expected_lock_version: args.expectedLockVersion,
      } as never);
      if (error) fail("restore", error);
    },

    markFailure: async (args) => {
      const { error } = await supabaseAdmin.rpc("arc_mark_ai_run_failure", {
        p_run_id: args.runId,
        p_failure_stage: args.failureStage,
        p_failure_category: args.category,
        p_failure_code: args.code,
        p_safe_message: args.safeMessage,
      } as never);
      if (error) fail("run failure", error);
    },
  };
}
