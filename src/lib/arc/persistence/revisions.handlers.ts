/**
 * Phase 7D — the real finalization and amendment logic, expressed as
 * dependency-injected handlers.
 *
 * The `createServerFn` wrappers in `revisions.functions.ts` call these exact
 * functions; nothing is duplicated for tests. The handlers receive a
 * caller-scoped Supabase reader and an admin-RPC loader so the production
 * boundary (RLS reads, server-built snapshot, trusted transaction) can be
 * proven directly.
 */

import { parseCanonicalInputs } from "./schema";
import { ARC_WORKFLOW_SCHEMA_VERSION } from "./schema";
import { ARC_ENGINE_VERSION, buildFinalizationSnapshot } from "./snapshot";

/* --------------------------------------------------------------- plumbing */

export interface QueryResult<T> {
  data: T | null;
  error: { code?: string; message?: string } | null;
}

export interface RevisionRow {
  id: string;
  status: string;
  lock_version: number;
  canonical_inputs: unknown;
  schema_version: string;
}

export interface SourceRevisionRow {
  canonical_inputs: unknown;
  schema_version: string;
  status: string;
}

export interface RpcResult {
  data: unknown;
  error: { code?: string; message?: string } | null;
}

/**
 * The narrow reader surface these handlers use. The generated Supabase client
 * satisfies it structurally at the call site in `revisions.functions.ts`.
 */
export interface RevisionReader {
  readRevisionForFinalization(revisionId: string): Promise<QueryResult<RevisionRow>>;
  readSourceRevision(revisionId: string): Promise<QueryResult<SourceRevisionRow>>;
  readLifecycleRevision(revisionId: string): Promise<QueryResult<LifecycleRevisionRow>>;
}

/** The minimum a destructive lifecycle decision needs from the draft row. */
export interface LifecycleRevisionRow {
  id: string;
  status: string;
  lock_version: number;
  supersedes_revision_id: string | null;
}

export interface FinalizeDeps {
  reader: RevisionReader;
  userId: string;
  /** Trusted, service-role-only finalization transaction. */
  finalizeTransaction(args: Record<string, unknown>): Promise<RpcResult>;
}

export interface AmendmentDeps {
  reader: RevisionReader;
  userId: string;
  /** Trusted, service-role-only amendment transaction. */
  amendmentTransaction(args: Record<string, unknown>): Promise<RpcResult>;
}

/* ------------------------------------------------------------- finalize -- */

export type FinalizeRevisionResult =
  | { ok: true; revisionId: string }
  | { ok: false; reason: "conflict" }
  | { ok: false; reason: "blocked"; issues: string[] };

/** The browser may send nothing but these two values. */
export interface FinalizeInput {
  revisionId: string;
  expectedLockVersion: number;
}

export async function finalizeRevisionHandler(
  deps: FinalizeDeps,
  data: FinalizeInput,
): Promise<FinalizeRevisionResult> {
  // Caller-scoped read: RLS decides whether this revision is theirs at all.
  const { data: revision, error } = await deps.reader.readRevisionForFinalization(data.revisionId);
  if (error) throw new Error("That revision could not be finalized.");
  if (!revision) throw new Error("That revision was not found in your workspace.");
  if (revision.status !== "draft") throw new Error("That revision is already finalized.");
  if (revision.lock_version !== data.expectedLockVersion) {
    return { ok: false, reason: "conflict" };
  }

  const parsed = parseCanonicalInputs(revision.canonical_inputs, revision.schema_version);
  if (!parsed.ok) throw new Error(parsed.reason);

  // The snapshot is built here, on the server, from the saved canonical input.
  const snapshot = buildFinalizationSnapshot(parsed.draft);
  if (!snapshot.ok) return { ok: false, reason: "blocked", issues: snapshot.issues };

  const { error: rpcError } = await deps.finalizeTransaction({
    p_owner_user_id: deps.userId,
    p_revision_id: data.revisionId,
    p_expected_lock_version: data.expectedLockVersion,
    p_engine_outputs: snapshot.engineOutputs,
    p_reconciliation_snapshot: snapshot.reconciliation,
    p_schema_version: ARC_WORKFLOW_SCHEMA_VERSION,
    p_engine_version: ARC_ENGINE_VERSION,
  });

  if (rpcError) {
    // 40001 is the transaction's optimistic-lock failure.
    if (rpcError.code === "40001") return { ok: false, reason: "conflict" };
    throw new Error("That revision could not be finalized.");
  }

  return { ok: true, revisionId: data.revisionId };
}

/* ------------------------------------------------------------ amendment -- */

export interface StartRevisionResult {
  revisionId: string;
  /** False when an active draft already existed and was opened instead. */
  created: boolean;
}

export interface StartRevisionInput {
  contractId: string;
  sourceRevisionId: string;
}

export async function startNewRevisionHandler(
  deps: AmendmentDeps,
  data: StartRevisionInput,
): Promise<StartRevisionResult> {
  // Caller-scoped read: RLS decides whether this source revision is theirs,
  // and its inputs must still be readable by the current engine before they
  // are seeded into an editable draft. The authoritative provenance decision
  // happens inside the transaction below.
  const { data: source, error: sourceError } = await deps.reader.readSourceRevision(
    data.sourceRevisionId,
  );
  if (sourceError || !source) throw new Error("The finalized revision could not be read.");
  if (source.status !== "finalized") {
    throw new Error(
      "Only the current finalized revision can be continued. A superseded revision stays view-only.",
    );
  }
  const parsed = parseCanonicalInputs(source.canonical_inputs, source.schema_version);
  if (!parsed.ok) throw new Error(parsed.reason);

  const { data: rows, error } = await deps.amendmentTransaction({
    p_owner_user_id: deps.userId,
    p_contract_id: data.contractId,
    p_expected_source_revision_id: data.sourceRevisionId,
  });
  if (error?.code === "40001") {
    throw new Error(
      "This analysis changed since this page loaded, so no new revision was started. Reload and try again.",
    );
  }
  const created = Array.isArray(rows) ? rows[0] : rows;
  if (error || !created) throw new Error("A new revision could not be started.");

  return {
    revisionId: (created as { revision_id: string }).revision_id,
    created: Boolean((created as { created: boolean }).created),
  };
}

/* ------------------------------------ amendment reset / discard (7D+) --- */

export interface AmendmentLifecycleDeps {
  reader: RevisionReader;
  userId: string;
  /** Trusted, service-role-only reset transaction. */
  resetTransaction(args: Record<string, unknown>): Promise<RpcResult>;
  /** Trusted, service-role-only discard transaction. */
  discardTransaction(args: Record<string, unknown>): Promise<RpcResult>;
}

export interface AmendmentLifecycleInput {
  revisionId: string;
  expectedLockVersion: number;
}

export type ResetAmendmentDraftResult =
  | { ok: true; lockVersion: number; draft: import("@/lib/asc606-workflow").WorkflowDraft }
  | { ok: false; reason: "conflict" };

export type DiscardAmendmentDraftResult =
  | { ok: true; finalizedRevisionId: string }
  | { ok: false; reason: "conflict" };

/**
 * Shared gate for both destructive amendment operations. Only the active,
 * unfinished draft that continues a finalized revision may be touched, and
 * only at the lock version the browser actually observed.
 */
async function readAmendmentDraft(
  deps: AmendmentLifecycleDeps,
  data: AmendmentLifecycleInput,
): Promise<LifecycleRevisionRow | "conflict"> {
  const { data: revision, error } = await deps.reader.readLifecycleRevision(data.revisionId);
  if (error) throw new Error("That revision could not be read.");
  if (!revision) throw new Error("That revision was not found in your workspace.");
  if (revision.status !== "draft") {
    throw new Error("Only an unfinished draft revision can be changed this way.");
  }
  if (!revision.supersedes_revision_id) {
    throw new Error("This draft does not continue a finalized revision.");
  }
  if (revision.lock_version !== data.expectedLockVersion) return "conflict";
  return revision;
}

export async function resetAmendmentDraftHandler(
  deps: AmendmentLifecycleDeps,
  data: AmendmentLifecycleInput,
): Promise<ResetAmendmentDraftResult> {
  const revision = await readAmendmentDraft(deps, data);
  if (revision === "conflict") return { ok: false, reason: "conflict" };

  const { data: rows, error } = await deps.resetTransaction({
    p_owner_user_id: deps.userId,
    p_revision_id: data.revisionId,
    p_expected_lock_version: data.expectedLockVersion,
  });
  if (error?.code === "40001") return { ok: false, reason: "conflict" };
  const row = (Array.isArray(rows) ? rows[0] : rows) as { lock_version: number } | null;
  if (error || !row) throw new Error("This revision could not be reset.");

  // Authoritative: the restored draft is read back from the database.
  const { data: restored, error: readError } = await deps.reader.readSourceRevision(
    data.revisionId,
  );
  if (readError || !restored) throw new Error("The reset revision could not be read back.");
  const parsed = parseCanonicalInputs(restored.canonical_inputs, restored.schema_version);
  if (!parsed.ok) throw new Error(parsed.reason);

  return { ok: true, lockVersion: row.lock_version, draft: parsed.draft };
}

export async function discardAmendmentDraftHandler(
  deps: AmendmentLifecycleDeps,
  data: AmendmentLifecycleInput,
): Promise<DiscardAmendmentDraftResult> {
  const revision = await readAmendmentDraft(deps, data);
  if (revision === "conflict") return { ok: false, reason: "conflict" };

  const { data: result, error } = await deps.discardTransaction({
    p_owner_user_id: deps.userId,
    p_revision_id: data.revisionId,
    p_expected_lock_version: data.expectedLockVersion,
  });
  if (error?.code === "40001") return { ok: false, reason: "conflict" };
  const finalizedRevisionId =
    typeof result === "string" ? result : ((result as { arc_discard_amendment_draft?: string })
      ?.arc_discard_amendment_draft ?? null);
  if (error || !finalizedRevisionId) throw new Error("This draft revision could not be discarded.");

  return { ok: true, finalizedRevisionId };
}
