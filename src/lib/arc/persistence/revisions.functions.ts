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

export type RevisionStatus = "draft" | "finalized" | "superseded";

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

    let query = context.supabase
      .from("analysis_revisions")
      .select("id, revision_number, status, lock_version, canonical_inputs, schema_version")
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
        .select("id, revision_number, status, lock_version, canonical_inputs, schema_version")
        .eq("id", analysis.current_finalized_revision_id)
        .maybeSingle();
      revision = fallback.data;
    }
    if (!revision) throw new Error("That analysis revision was not found.");

    const parsed = parseCanonicalInputs(revision.canonical_inputs);
    if (!parsed.ok) throw new Error(parsed.reason);

    const customer = contract.customers as unknown as { name: string } | null;

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
    const canonical = toCanonicalInputs(data.draft);
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
