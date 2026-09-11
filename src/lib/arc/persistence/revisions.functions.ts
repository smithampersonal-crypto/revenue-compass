/**
 * Phase 7C — revision load / autosave server functions.
 *
 * Caller-scoped through `requireSupabaseAuth`: RLS decides what the caller can
 * see and change. Saves are optimistic-concurrency controlled by
 * `lock_version`, so a stale browser can never silently overwrite newer work.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { WorkflowDraft } from "@/lib/asc606-workflow";

import {
  ARC_WORKFLOW_SCHEMA_VERSION,
  parseCanonicalInputs,
  toCanonicalInputs,
  validateDraftForPersistence,
} from "./schema";
import {
  ARC_ENGINE_VERSION,
  buildFinalizationSnapshot,
  readEngineOutputsSnapshot,
  readReconciliationSnapshot,
  type ArcEngineOutputsSnapshot,
  type ArcReconciliationSnapshot,
} from "./snapshot";

export type RevisionStatus = "draft" | "finalized" | "superseded";

/**
 * Phase 7D — the stored finalized snapshot, returned exactly as recorded.
 * `engineVersionMatchesCurrent` is false when the snapshot was produced by an
 * earlier engine; the snapshot is still shown as recorded and is never
 * recalculated.
 */
export interface RevisionSnapshotDto {
  engineVersion: string;
  schemaVersion: string;
  finalizedAt: string | null;
  engineVersionMatchesCurrent: boolean;
  reconciliation: ArcReconciliationSnapshot | null;
  /**
   * The recorded engine outputs, exactly as stored. Null when the recording is
   * missing or structurally unusable — the workspace then fails closed instead
   * of recalculating the inputs with the current engine.
   */
  engineOutputs: ArcEngineOutputsSnapshot | null;
}

export interface LoadedRevisionDto {
  contractId: string;
  contractTitle: string;
  contractNumber: string | null;
  customerName: string;
  analysisId: string;
  revisionId: string;
  revisionNumber: number;
  status: RevisionStatus;
  lockVersion: number;
  schemaVersion: string;
  /** Finalized and superseded revisions are opened read-only. */
  readOnly: boolean;
  draft: WorkflowDraft;
  /** Present only for finalized and superseded revisions. */
  snapshot: RevisionSnapshotDto | null;
}

const uuid = z.string().uuid();

/**
 * Opens an owned contract: the requested revision when one is named, otherwise
 * the active draft, otherwise the current finalized revision.
 */
export const loadContractAnalysis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { contractId: string; revisionId?: string }) => ({
    contractId: uuid.parse(input?.contractId),
    revisionId: input?.revisionId ? uuid.parse(input.revisionId) : undefined,
  }))
  .handler(async ({ data, context }): Promise<LoadedRevisionDto> => {
    const { data: contract, error: contractError } = await context.supabase
      .from("contracts")
      .select("id, title, contract_number, customers ( name )")
      .eq("id", data.contractId)
      .maybeSingle();
    if (contractError) throw new Error("That contract could not be opened.");
    if (!contract) throw new Error("That contract was not found in your workspace.");

    const { data: analysis, error: analysisError } = await context.supabase
      .from("analyses")
      .select("id, current_finalized_revision_id")
      .eq("contract_id", data.contractId)
      .maybeSingle();
    if (analysisError || !analysis)
      throw new Error("That contract's analysis could not be opened.");

    const revisionColumns =
      "id, revision_number, status, lock_version, canonical_inputs, schema_version, engine_version, finalized_at, reconciliation_snapshot, engine_outputs";

    let query = context.supabase
      .from("analysis_revisions")
      .select(revisionColumns)
      .eq("analysis_id", analysis.id);

    if (data.revisionId) {
      query = query.eq("id", data.revisionId);
    } else {
      query = query.eq("status", "draft");
    }

    const initial = await query
      .order("revision_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (initial.error) throw new Error("That analysis revision could not be opened.");
    let revision = initial.data;

    if (!revision && !data.revisionId && analysis.current_finalized_revision_id) {
      const fallback = await context.supabase
        .from("analysis_revisions")
        .select(revisionColumns)
        .eq("id", analysis.current_finalized_revision_id)
        .maybeSingle();
      revision = fallback.data;
    }
    if (!revision) throw new Error("That analysis revision was not found.");

    // The stored envelope version, the revision row's schema_version and the
    // engine's supported version must all agree before the draft may reach
    // analyzeWorkflow().
    const parsed = parseCanonicalInputs(revision.canonical_inputs, revision.schema_version);
    if (!parsed.ok) throw new Error(parsed.reason);

    const customer = contract.customers as unknown as { name: string } | null;

    // A finalized snapshot is returned exactly as recorded. It is never
    // recomputed here, so a later engine change cannot silently rewrite it.
    const snapshot: RevisionSnapshotDto | null =
      revision.status === "draft"
        ? null
        : {
            engineVersion: revision.engine_version ?? "",
            schemaVersion: revision.schema_version,
            finalizedAt: revision.finalized_at,
            engineVersionMatchesCurrent: revision.engine_version === ARC_ENGINE_VERSION,
            reconciliation: readReconciliationSnapshot(revision.reconciliation_snapshot),
            engineOutputs: readEngineOutputsSnapshot(revision.engine_outputs),
          };

    return {
      contractId: contract.id,
      contractTitle: contract.title,
      contractNumber: contract.contract_number,
      customerName: customer?.name ?? "",
      analysisId: analysis.id,
      revisionId: revision.id,
      revisionNumber: revision.revision_number,
      status: revision.status,
      lockVersion: revision.lock_version,
      schemaVersion: revision.schema_version,
      readOnly: revision.status !== "draft",
      draft: parsed.draft,
      snapshot,
    };
  });

export type SaveDraftResult =
  { ok: true; lockVersion: number; savedAt: string } | { ok: false; conflict: true };

/**
 * Autosave for an owned draft revision. The update is conditional on the
 * expected `lock_version` and on the revision still being a draft; if either
 * has moved on, nothing is written and the caller is told to reload.
 */
export const saveDraftRevision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { revisionId: string; expectedLockVersion: number; draft: WorkflowDraft }) => ({
      revisionId: uuid.parse(input?.revisionId),
      expectedLockVersion: z.number().int().min(1).parse(input?.expectedLockVersion),
      draft: input.draft,
    }),
  )
  .handler(async ({ data, context }): Promise<SaveDraftResult> => {
    // Runtime validation of the browser-supplied draft: TypeScript typing is
    // not validation, and a malformed nested row must never be persisted.
    const validated = validateDraftForPersistence(data.draft);
    if (!validated.ok) throw new Error(validated.reason);

    const canonical = toCanonicalInputs(validated.draft);
    if (canonical.schemaVersion !== ARC_WORKFLOW_SCHEMA_VERSION) {
      throw new Error("This analysis uses an unsupported schema version.");
    }

    const { data: updated, error } = await context.supabase
      .from("analysis_revisions")
      .update({
        canonical_inputs: canonical as unknown as never,
        lock_version: data.expectedLockVersion + 1,
      })
      .eq("id", data.revisionId)
      .eq("lock_version", data.expectedLockVersion)
      .eq("status", "draft")
      .select("lock_version, updated_at")
      .maybeSingle();

    if (error) throw new Error("Your latest edits could not be saved.");
    if (!updated) return { ok: false, conflict: true };

    return { ok: true, lockVersion: updated.lock_version, savedAt: updated.updated_at };
  });

/* -------------------------------------------------------------------------
 * Phase 7D — finalization, revision history and amendment.
 * ---------------------------------------------------------------------- */

export type FinalizeRevisionResult =
  | { ok: true; revisionId: string }
  | { ok: false; reason: "conflict" }
  | { ok: false; reason: "blocked"; issues: string[] };

/**
 * Finalizes an owned draft revision.
 *
 * The browser supplies only the revision id and the lock version it believes
 * is current. The authoritative `WorkflowDraft` is read back from the database
 * and the deterministic engines are rerun here, on the server, to build the
 * snapshot. Browser-computed engine output is never accepted.
 *
 * The write itself is the trusted `arc_finalize_revision` transaction: it
 * re-checks ownership and the lock version, flips the previous current
 * finalized revision to superseded and repoints the analysis, all atomically.
 */
export const finalizeRevision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { revisionId: string; expectedLockVersion: number }) => ({
    revisionId: uuid.parse(input?.revisionId),
    expectedLockVersion: z.number().int().min(1).parse(input?.expectedLockVersion),
  }))
  .handler(async ({ data, context }): Promise<FinalizeRevisionResult> => {
    // Caller-scoped read: RLS decides whether this revision is theirs at all.
    const { data: revision, error } = await context.supabase
      .from("analysis_revisions")
      .select("id, status, lock_version, canonical_inputs, schema_version")
      .eq("id", data.revisionId)
      .maybeSingle();
    if (error) throw new Error("That revision could not be finalized.");
    if (!revision) throw new Error("That revision was not found in your workspace.");
    if (revision.status !== "draft") {
      throw new Error("That revision is already finalized.");
    }
    if (revision.lock_version !== data.expectedLockVersion) {
      return { ok: false, reason: "conflict" };
    }

    const parsed = parseCanonicalInputs(revision.canonical_inputs, revision.schema_version);
    if (!parsed.ok) throw new Error(parsed.reason);

    const snapshot = buildFinalizationSnapshot(parsed.draft);
    if (!snapshot.ok) return { ok: false, reason: "blocked", issues: snapshot.issues };

    // The trusted transaction is service-role only; the caller was verified
    // above and their identity is passed in for the function's own ownership
    // check. Loaded inside the handler so it never enters a client bundle.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: rpcError } = await supabaseAdmin.rpc("arc_finalize_revision", {
      p_owner_user_id: context.userId,
      p_revision_id: data.revisionId,
      p_expected_lock_version: data.expectedLockVersion,
      p_engine_outputs: snapshot.engineOutputs as unknown as never,
      p_reconciliation_snapshot: snapshot.reconciliation as unknown as never,
      p_schema_version: ARC_WORKFLOW_SCHEMA_VERSION,
      p_engine_version: ARC_ENGINE_VERSION,
    });

    if (rpcError) {
      // 40001 is the function's optimistic-lock failure.
      if (rpcError.code === "40001") return { ok: false, reason: "conflict" };
      throw new Error("That revision could not be finalized.");
    }

    return { ok: true, revisionId: data.revisionId };
  });

export interface RevisionHistoryEntryDto {
  revisionId: string;
  revisionNumber: number;
  status: RevisionStatus;
  engineVersion: string | null;
  schemaVersion: string;
  finalizedAt: string | null;
  updatedAt: string;
  createdAt: string;
  supersedesRevisionId: string | null;
  /** True for the analysis's current finalized revision. */
  isCurrentFinalized: boolean;
}

/** Full Draft / Finalized / Superseded history for an owned contract. */
export const listRevisionHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { contractId: string }) => ({
    contractId: uuid.parse(input?.contractId),
  }))
  .handler(async ({ data, context }): Promise<{ revisions: RevisionHistoryEntryDto[] }> => {
    const { data: analysis, error: analysisError } = await context.supabase
      .from("analyses")
      .select("id, current_finalized_revision_id")
      .eq("contract_id", data.contractId)
      .maybeSingle();
    if (analysisError || !analysis)
      throw new Error("That contract was not found in your workspace.");

    const { data: rows, error } = await context.supabase
      .from("analysis_revisions")
      .select(
        "id, revision_number, status, engine_version, schema_version, finalized_at, updated_at, created_at, supersedes_revision_id",
      )
      .eq("analysis_id", analysis.id)
      .order("revision_number", { ascending: false });
    if (error) throw new Error("The revision history could not be loaded.");

    return {
      revisions: (rows ?? []).map((row) => ({
        revisionId: row.id,
        revisionNumber: row.revision_number,
        status: row.status,
        engineVersion: row.engine_version,
        schemaVersion: row.schema_version,
        finalizedAt: row.finalized_at,
        updatedAt: row.updated_at,
        createdAt: row.created_at,
        supersedesRevisionId: row.supersedes_revision_id,
        isCurrentFinalized: row.id === analysis.current_finalized_revision_id,
      })),
    };
  });

export type StartRevisionResult = {
  revisionId: string;
  /** False when an active draft already existed and was opened instead. */
  created: boolean;
};

/**
 * Starts (or reopens) the editable draft that continues the analysis's current
 * finalized revision, so a finalized snapshot is never reopened for editing.
 *
 * ARC v1 does not branch from a superseded revision: only the analysis's
 * current finalized revision may be continued, and the caller must name it.
 * The new draft records `supersedes_revision_id = <that finalized revision>`;
 * because browsers are not granted that column, the row is created by the
 * narrowly scoped, service-role-only `arc_start_amendment_revision`
 * transaction, which re-checks ownership itself.
 */
export const startNewRevision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { contractId: string; sourceRevisionId?: string }) => ({
    contractId: uuid.parse(input?.contractId),
    sourceRevisionId: input?.sourceRevisionId ? uuid.parse(input.sourceRevisionId) : undefined,
  }))
  .handler(async ({ data, context }): Promise<StartRevisionResult> => {
    // Caller-scoped read: RLS decides whether this contract is theirs at all.
    const { data: analysis, error: analysisError } = await context.supabase
      .from("analyses")
      .select("id, current_finalized_revision_id")
      .eq("contract_id", data.contractId)
      .maybeSingle();
    if (analysisError || !analysis)
      throw new Error("That contract was not found in your workspace.");
    if (!analysis.current_finalized_revision_id) {
      throw new Error("This analysis has no finalized revision to continue from.");
    }
    if (data.sourceRevisionId && data.sourceRevisionId !== analysis.current_finalized_revision_id) {
      throw new Error(
        "Only the current finalized revision can be continued. A superseded revision stays view-only.",
      );
    }

    // The finalized inputs must still be readable by the current engine before
    // they are seeded into an editable draft.
    const { data: source, error: sourceError } = await context.supabase
      .from("analysis_revisions")
      .select("canonical_inputs, schema_version")
      .eq("id", analysis.current_finalized_revision_id)
      .maybeSingle();
    if (sourceError || !source) throw new Error("The finalized revision could not be read.");
    const parsed = parseCanonicalInputs(source.canonical_inputs, source.schema_version);
    if (!parsed.ok) throw new Error(parsed.reason);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin.rpc("arc_start_amendment_revision", {
      p_owner_user_id: context.userId,
      p_contract_id: data.contractId,
    });
    const created = Array.isArray(rows) ? rows[0] : rows;
    if (error || !created) throw new Error("A new revision could not be started.");

    return {
      revisionId: (created as { revision_id: string }).revision_id,
      created: Boolean((created as { created: boolean }).created),
    };
  });
