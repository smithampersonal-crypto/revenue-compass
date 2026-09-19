/**
 * Phase 9G — Task 4. Service-role store for autosave edit reconciliation.
 *
 * Server-only: blocked from client bundles by its `.server` name. The AI
 * sidecar and the review audit trail grant nothing to `anon` or
 * `authenticated`, so the authoritative pre-save draft, the current sidecar
 * and the single reconciling transaction are all reached through the service
 * role here.
 *
 * This module decides nothing. It forwards a server-derived scope and
 * preserves the database error code so the caller can turn an optimistic-lock
 * failure into an ordinary "reload and try again" result.
 */

import { parseCanonicalInputs } from "@/lib/arc/persistence/schema";
import type { WorkflowDraft } from "@/lib/asc606-workflow";

import type {
  AiSidecarLoad,
  AutosaveReconciliationStore,
  AutosaveScope,
} from "./autosave-reconciliation.handlers";
import { createEmptyAiAnalysisState, type AiAnalysisState } from "./merge";
import { normalizePersistedReviewPayload } from "./review-normalization";

interface CodedError {
  code?: string;
  message?: string;
}

/**
 * Structured server-side diagnostics. The real database code and message are
 * preserved here, in the server log, and NEVER handed to the browser: no
 * credentials, token hashes, canonical draft contents, review payloads or
 * source text ever appear in it.
 */
export function logAutosaveStoreFailure(
  operation: string,
  scope: Pick<AutosaveScope, "revisionId" | "guestWorkspaceId">,
  error: CodedError,
): void {
  console.error("[arc.autosave.store]", {
    operation,
    scopeKind: scope.revisionId !== null ? "revision" : "guest",
    code: error?.code ?? null,
    message: error?.message ?? null,
  });
}

function fail(operation: string, error: CodedError, scope?: AutosaveScope): never {
  if (scope) logAutosaveStoreFailure(operation, scope, error);
  const thrown = new Error(`The autosave store is unavailable (${operation}).`, {
    cause: error,
  }) as Error & { code?: string };
  if (error?.code) thrown.code = error.code;
  throw thrown;
}

/** The one conflict code the trusted transaction raises for a stale save. */
export const AUTOSAVE_CONFLICT_CODE = "40001";

/**
 * Bounded lock contention: the trusted transaction hit its transaction-local
 * `lock_timeout` waiting for the owner row. It wrote nothing, and it is NOT
 * evidence that a newer saved version exists.
 */
export const AUTOSAVE_CONTENTION_CODE = "55P03";

function firstRow<T>(data: unknown): T | null {
  if (Array.isArray(data)) return (data[0] as T) ?? null;
  return (data as T) ?? null;
}

/**
 * @param saveDraftOnly the existing, unchanged draft-only autosave for an
 * analysis that has never used AI. It stays on its original caller-scoped
 * path; nothing about a manual-only save changes in Task 4.
 */
export async function createAutosaveReconciliationStore(
  saveDraftOnly: AutosaveReconciliationStore["saveDraftOnly"],
): Promise<AutosaveReconciliationStore> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // The Phase 9G routines are newer than the generated database types, so the
  // call surface is narrowed locally instead of being typed against them.
  // The method MUST stay bound to the client: a detached `supabaseAdmin.rpc`
  // loses `this` and throws "Cannot read properties of undefined (reading
  // 'rest')" on the first call.
  const rpc = supabaseAdmin.rpc.bind(supabaseAdmin) as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: CodedError | null }>;

  return {
    saveDraftOnly,

    loadSavedDraft: async (scope: AutosaveScope): Promise<WorkflowDraft | null> => {
      if (scope.revisionId !== null) {
        const { data, error } = await supabaseAdmin
          .from("analysis_revisions")
          .select("canonical_inputs, schema_version")
          .eq("id", scope.revisionId)
          .maybeSingle();
        if (error) fail("read saved analysis", error, scope);
        if (!data) return null;
        const parsed = parseCanonicalInputs(data.canonical_inputs, data.schema_version);
        return parsed.ok ? parsed.draft : null;
      }
      const { data, error } = await supabaseAdmin
        .from("guest_workspaces")
        .select("draft_json, schema_version")
        .eq("id", scope.guestWorkspaceId!)
        .maybeSingle();
      if (error) fail("read temporary workspace", error, scope);
      if (!data) return null;
      const parsed = parseCanonicalInputs(data.draft_json, data.schema_version);
      return parsed.ok ? parsed.draft : null;
    },

    loadAiState: async (scope: AutosaveScope): Promise<AiSidecarLoad> => {
      const query = supabaseAdmin
        .from("ai_analysis_state")
        .select(
          "last_successful_run_id, source_set_fingerprint, source_state, field_provenance, " +
            "object_provenance, tombstones, review_items",
        );
      const { data, error } =
        scope.revisionId !== null
          ? await query.eq("revision_id", scope.revisionId).maybeSingle()
          : await query.eq("guest_workspace_id", scope.guestWorkspaceId!).maybeSingle();
      if (error) fail("read AI state", error, scope);
      if (!data) return { status: "absent" };

      const row = data as unknown as {
        last_successful_run_id: string | null;
        source_set_fingerprint: string | null;
        source_state: string | null;
        field_provenance: unknown;
        object_provenance: unknown;
        tombstones: unknown;
        review_items: unknown;
      };
      // Tolerant normalization is right for merge and carry-forward. At this
      // WRITE boundary it is not: an unreadable entry must stay on disk so
      // finalization can still see it.
      const payload = normalizePersistedReviewPayload(row.review_items);
      if (payload.malformed) return { status: "unreadable" };

      const empty = createEmptyAiAnalysisState();
      return {
        status: "loaded",
        state: {
          lastSuccessfulRunId: row.last_successful_run_id,
          sourceSetFingerprint: row.source_set_fingerprint,
          sourceState: (row.source_state as AiAnalysisState["sourceState"]) ?? empty.sourceState,
          fieldProvenance:
            (row.field_provenance as AiAnalysisState["fieldProvenance"]) ?? empty.fieldProvenance,
          objectProvenance:
            (row.object_provenance as AiAnalysisState["objectProvenance"]) ??
            empty.objectProvenance,
          tombstones: Array.isArray(row.tombstones) ? (row.tombstones as string[]) : [],
          reviewItems: payload.items,
        },
      };
    },

    saveWithReconciliation: async (args) => {
      const { data, error } = await rpc("arc_save_draft_with_ai_reconciliation", {
        p_owner_user_id: args.scope.ownerUserId,
        p_guest_token_hash: args.scope.guestTokenHash,
        p_revision_id: args.scope.revisionId,
        p_guest_workspace_id: args.scope.guestWorkspaceId,
        p_actor_user_id: args.scope.actorUserId,
        p_expected_lock_version: args.expectedLockVersion,
        p_canonical_inputs: args.canonical,
        p_schema_version: args.schemaVersion,
        p_ai_state: {
          sourceState: args.aiState.sourceState,
          fieldProvenance: args.aiState.fieldProvenance,
          objectProvenance: args.aiState.objectProvenance,
          tombstones: args.aiState.tombstones,
          reviewItems: args.aiState.reviewItems,
        },
        p_review_events: args.reviewEvents,
      });
      // A stale save is an ordinary result, not an error the accountant sees.
      if (error?.code === AUTOSAVE_CONFLICT_CODE) return null;
      // Bounded contention: nothing was written, and the caller may retry once
      // with the SAME expected lock version. Deliberately not a conflict.
      if (error?.code === AUTOSAVE_CONTENTION_CODE) {
        logAutosaveStoreFailure("save-contention", args.scope, error);
        return "contention";
      }
      if (error) fail("save", error, args.scope);
      const row = firstRow<{ lock_version: number; saved_at: string }>(data);
      if (row === null) return null;
      return { lockVersion: row.lock_version, savedAt: row.saved_at };
    },
  };
}
