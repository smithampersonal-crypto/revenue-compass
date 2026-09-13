/**
 * Phase 8C — server-only read model and trusted mutations for the
 * authenticated Source Documents workspace.
 *
 * Every read joins ownership explicitly, and every mutation goes through the
 * accepted Phase 8A trusted operations. Storage paths, buckets and content
 * hashes never leave this module.
 */

import type {
  DocumentWorkspaceDto,
  SourceDocumentSummaryDto,
  SourceDocumentType,
} from "./types";

function fail(operation: string, error: { message?: string }): never {
  throw new Error(`The document workspace is unavailable (${operation}).`, { cause: error });
}

/** Raised when a trusted operation rejects a stale expected lock version. */
export class SourceLockConflictError extends Error {
  constructor() {
    super("the draft changed since it was loaded");
    this.name = "SourceLockConflictError";
  }
}

function isConflict(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "40001" || Boolean(error.message?.includes("changed since it was loaded"));
}

interface DocumentRow {
  id: string;
  display_name: string;
  original_filename: string;
  document_type: string | null;
  effective_date: string | null;
  byte_size: number;
  page_count: number;
  created_at: string;
  archived_at: string | null;
}

function summarize(
  row: DocumentRow,
  selected: boolean,
  inFinalizedHistory: boolean,
): SourceDocumentSummaryDto {
  return {
    id: row.id,
    displayName: row.display_name,
    originalFilename: row.original_filename,
    documentType: (row.document_type as SourceDocumentType | null) ?? null,
    effectiveDate: row.effective_date,
    byteSize: Number(row.byte_size),
    pageCount: row.page_count,
    createdAt: row.created_at,
    archived: row.archived_at !== null,
    selected,
    inFinalizedHistory,
    metadataLocked: inFinalizedHistory,
    canDelete: !inFinalizedHistory,
  };
}

export interface DocumentWorkspaceStore {
  loadWorkspace(args: {
    userId: string;
    contractId: string;
    revisionId: string;
  }): Promise<DocumentWorkspaceDto>;
  attach(args: {
    userId: string;
    revisionId: string;
    sourceDocumentId: string;
    expectedLockVersion: number;
  }): Promise<number>;
  remove(args: {
    userId: string;
    revisionId: string;
    sourceDocumentId: string;
    expectedLockVersion: number;
  }): Promise<number>;
  updateMetadata(args: {
    userId: string;
    sourceDocumentId: string;
    displayName: string;
    documentType: string | null;
    effectiveDate: string | null;
  }): Promise<void>;
  setArchived(args: {
    userId: string;
    sourceDocumentId: string;
    archived: boolean;
  }): Promise<void>;
  stageDeletion(args: {
    userId: string;
    sourceDocumentId: string;
    expectedLockVersion: number | null;
  }): Promise<number | null>;
}

export async function documentWorkspaceStore(): Promise<DocumentWorkspaceStore> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  async function assertOwnedContract(contractId: string, userId: string): Promise<void> {
    const { data, error } = await supabaseAdmin
      .from("contracts")
      .select("id, customers!inner(owner_user_id)")
      .eq("id", contractId)
      .eq("customers.owner_user_id", userId)
      .maybeSingle();
    if (error) fail("ownership", error);
    if (!data) throw new Error("That analysis is not available.");
  }

  return {
    loadWorkspace: async ({ userId, contractId, revisionId }) => {
      await assertOwnedContract(contractId, userId);

      const { data: revision, error: revisionError } = await supabaseAdmin
        .from("analysis_revisions")
        .select("id, revision_number, status, lock_version, analyses!inner(contract_id)")
        .eq("id", revisionId)
        .maybeSingle();
      if (revisionError) fail("revision", revisionError);
      const analyses = revision?.analyses as unknown as { contract_id: string } | undefined;
      if (!revision || analyses?.contract_id !== contractId) {
        throw new Error("That analysis is not available.");
      }

      const { data: documents, error: documentsError } = await supabaseAdmin
        .from("source_documents")
        .select(
          "id, display_name, original_filename, document_type, effective_date, byte_size, page_count, created_at, archived_at",
        )
        .eq("contract_id", contractId)
        .order("created_at", { ascending: true });
      if (documentsError) fail("documents", documentsError);

      const rows = (documents ?? []) as unknown as DocumentRow[];
      const ids = rows.map((row) => row.id);

      const selectedIds = new Set<string>();
      const historyIds = new Set<string>();

      if (ids.length > 0) {
        const { data: selections, error: selectionError } = await supabaseAdmin
          .from("revision_source_documents")
          .select("source_document_id, revision_id, analysis_revisions!inner(status)")
          .in("source_document_id", ids);
        if (selectionError) fail("selection", selectionError);

        for (const entry of (selections ?? []) as unknown as {
          source_document_id: string;
          revision_id: string;
          analysis_revisions: { status: string };
        }[]) {
          if (entry.revision_id === revisionId) selectedIds.add(entry.source_document_id);
          if (entry.analysis_revisions.status !== "draft") {
            historyIds.add(entry.source_document_id);
          }
        }
      }

      const library = rows.map((row) =>
        summarize(row, selectedIds.has(row.id), historyIds.has(row.id)),
      );

      return {
        revision: {
          revisionId: revision.id,
          revisionNumber: revision.revision_number,
          status: revision.status as "draft" | "finalized" | "superseded",
          lockVersion: revision.lock_version,
          canEditSources: revision.status === "draft",
        },
        selected: library.filter((document) => document.selected),
        library,
      };
    },

    attach: async ({ userId, revisionId, sourceDocumentId, expectedLockVersion }) => {
      const { data, error } = await supabaseAdmin.rpc("arc_attach_source_document", {
        p_owner_user_id: userId,
        p_revision_id: revisionId,
        p_source_document_id: sourceDocumentId,
        p_expected_lock_version: expectedLockVersion,
      });
      if (isConflict(error)) throw new SourceLockConflictError();
      if (error) fail("add", error);
      return data as unknown as number;
    },

    remove: async ({ userId, revisionId, sourceDocumentId, expectedLockVersion }) => {
      const { data, error } = await supabaseAdmin.rpc("arc_remove_source_document", {
        p_owner_user_id: userId,
        p_revision_id: revisionId,
        p_source_document_id: sourceDocumentId,
        p_expected_lock_version: expectedLockVersion,
      });
      if (isConflict(error)) throw new SourceLockConflictError();
      if (error) fail("remove", error);
      return data as unknown as number;
    },

    updateMetadata: async ({
      userId,
      sourceDocumentId,
      displayName,
      documentType,
      effectiveDate,
    }) => {
      const { error } = await supabaseAdmin.rpc("arc_update_source_document_metadata", {
        p_owner_user_id: userId,
        p_source_document_id: sourceDocumentId,
        p_display_name: displayName,
        p_document_type: documentType as never,
        p_effective_date: effectiveDate as never,
      });
      if (error) fail("details", error);
    },

    setArchived: async ({ userId, sourceDocumentId, archived }) => {
      const { error } = await supabaseAdmin.rpc("arc_set_source_document_archived", {
        p_owner_user_id: userId,
        p_source_document_id: sourceDocumentId,
        p_archived: archived,
      });
      if (error) fail("archive", error);
    },

    stageDeletion: async ({ userId, sourceDocumentId, expectedLockVersion }) => {
      const { data, error } = await supabaseAdmin.rpc("arc_stage_source_document_deletion", {
        p_owner_user_id: userId,
        p_guest_token_hash: null as never,
        p_source_document_id: sourceDocumentId,
        p_expected_lock_version: expectedLockVersion as never,
      });
      if (isConflict(error)) throw new SourceLockConflictError();
      if (error) fail("deletion", error);
      const row = (data ?? [])[0];
      return row ? ((row.lock_version as number | null) ?? null) : null;
    },
  };
}
