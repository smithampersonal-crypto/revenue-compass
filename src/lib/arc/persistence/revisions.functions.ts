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
  readEngineOutputsSnapshot,
  readReconciliationSnapshot,
  type ArcEngineOutputsSnapshot,
  type ArcReconciliationSnapshot,
} from "./snapshot";
import {
  finalizeRevisionHandler,
  startNewRevisionHandler,
  type FinalizeRevisionResult,
  type RevisionReader,
  type StartRevisionResult,
} from "./revisions.handlers";

export type RevisionStatus = "draft" | "finalized" | "superseded";

/**
 * The caller-scoped reader the lifecycle handlers use. Every read here runs as
 * the signed-in user, so RLS decides what is visible.
 */
function revisionReader(supabase: unknown): RevisionReader {
  const client = supabase as unknown as {
    from: (table: string) => {
      select: (columns: string) => {
        eq: (
          column: string,
          value: string,
        ) => { maybeSingle: () => Promise<{ data: never; error: never }> };
      };
    };
  };
  return {
    readRevisionForFinalization: (revisionId) =>
      client
        .from("analysis_revisions")
        .select("id, status, lock_version, canonical_inputs, schema_version")
        .eq("id", revisionId)
        .maybeSingle(),
    readSourceRevision: (revisionId) =>
      client
        .from("analysis_revisions")
        .select("canonical_inputs, schema_version, status")
        .eq("id", revisionId)
        .maybeSingle(),
    readLifecycleRevision: (revisionId) =>
      client
        .from("analysis_revisions")
        .select("id, status, lock_version, supersedes_revision_id")
        .eq("id", revisionId)
        .maybeSingle(),
  };
}

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
    // The row's own engine/schema metadata must agree with the snapshot's, and
    // every nested shape the historical renderers read is validated; anything
    // else is reported as no usable recording so the workspace fails closed.
    let snapshot: RevisionSnapshotDto | null = null;
    if (revision.status !== "draft") {
      const metadata = {
        engineVersion: revision.engine_version ?? "",
        schemaVersion: revision.schema_version,
      };
      const reconciliation = readReconciliationSnapshot(revision.reconciliation_snapshot, metadata);
      const engineOutputs = readEngineOutputsSnapshot(revision.engine_outputs, metadata);
      snapshot = {
        engineVersion: metadata.engineVersion,
        schemaVersion: metadata.schemaVersion,
        finalizedAt: revision.finalized_at,
        engineVersionMatchesCurrent: revision.engine_version === ARC_ENGINE_VERSION,
        reconciliation,
        // Both recordings must be usable and consistent with the row: a
        // mismatch anywhere means the recording cannot be trusted at all.
        engineOutputs: reconciliation && engineOutputs ? engineOutputs : null,
      };
    }

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

export type { FinalizeRevisionResult } from "./revisions.handlers";

/**
 * Finalizes an owned draft revision.
 *
 * The browser supplies only the revision id and the lock version it believes
 * is current. The authoritative `WorkflowDraft` is read back from the database
 * and the deterministic engines are rerun on the server to build the snapshot;
 * browser-computed engine output is never accepted.
 *
 * The write itself is the trusted `arc_finalize_revision` transaction. The
 * whole decision lives in `finalizeRevisionHandler`, which this wrapper calls
 * with the caller-scoped reader and the service-role transaction.
 */
export const finalizeRevision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { revisionId: string; expectedLockVersion: number }) => ({
    revisionId: uuid.parse(input?.revisionId),
    expectedLockVersion: z.number().int().min(1).parse(input?.expectedLockVersion),
  }))
  .handler(async ({ data, context }): Promise<FinalizeRevisionResult> => {
    return finalizeRevisionHandler(
      {
        reader: revisionReader(context.supabase),
        userId: context.userId,
        finalizeTransaction: async (args) => {
          // The trusted transaction is service-role only; the caller was
          // verified by the middleware and their identity is passed in for the
          // function's own ownership check. Loaded inside the handler so it
          // never enters a client bundle.
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          return supabaseAdmin.rpc("arc_finalize_revision", args as never);
        },
      },
      data,
    );
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

export type { StartRevisionResult } from "./revisions.handlers";

/**
 * Starts (or reopens) the editable draft that continues the analysis's current
 * finalized revision, so a finalized snapshot is never reopened for editing.
 *
 * ARC v1 does not branch from a superseded revision: only the analysis's
 * current finalized revision may be continued, and the caller must name it.
 * The provenance decision itself is not made here — the narrowly scoped,
 * service-role-only `arc_start_amendment_revision` transaction re-checks
 * ownership, the existing-draft case and the expected source revision under a
 * single lock, and records `supersedes_revision_id = <that exact source>`.
 */
export const startNewRevision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { contractId: string; sourceRevisionId: string }) => ({
    contractId: uuid.parse(input?.contractId),
    sourceRevisionId: uuid.parse(input?.sourceRevisionId),
  }))
  .handler(async ({ data, context }): Promise<StartRevisionResult> => {
    return startNewRevisionHandler(
      {
        reader: revisionReader(context.supabase),
        userId: context.userId,
        amendmentTransaction: async (args) => {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          return supabaseAdmin.rpc("arc_start_amendment_revision", args as never);
        },
      },
      data,
    );
  });
