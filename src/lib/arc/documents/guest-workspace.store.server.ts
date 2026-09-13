/**
 * Phase 8E — server-only read model and trusted mutations for the temporary
 * (guest) Source Documents workspace.
 *
 * Authorization is the hashed HttpOnly guest credential plus the workspace's
 * own `expires_at`, revalidated on every call inside the trusted database
 * functions. Storage paths, buckets and content hashes never leave this
 * module.
 */

import type {
  GuestDocumentWorkspaceDto,
  SourceDocumentSummaryDto,
  SourceDocumentType,
} from "./types";

function fail(operation: string, error: { message?: string }): never {
  throw new Error(`The document workspace is unavailable (${operation}).`, { cause: error });
}

/** Raised when a trusted operation rejects a stale expected lock version. */
export class GuestSourceLockConflictError extends Error {
  constructor() {
    super("the temporary workspace changed since it was loaded");
    this.name = "GuestSourceLockConflictError";
  }
}

function isConflict(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "40001" || Boolean(error.message?.includes("changed since it was loaded"));
}

interface GuestDocumentRow {
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

function summarize(row: GuestDocumentRow, selected: boolean): SourceDocumentSummaryDto {
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
    // A temporary workspace has no finalized history at all.
    inFinalizedHistory: false,
    metadataLocked: false,
    canDelete: true,
  };
}

export interface GuestDocumentWorkspaceStore {
  loadWorkspace(tokenHash: string): Promise<GuestDocumentWorkspaceDto>;
  attach(args: {
    tokenHash: string;
    sourceDocumentId: string;
    expectedLockVersion: number;
  }): Promise<number>;
  remove(args: {
    tokenHash: string;
    sourceDocumentId: string;
    expectedLockVersion: number;
  }): Promise<number>;
  stageDeletion(args: {
    tokenHash: string;
    sourceDocumentId: string;
    expectedLockVersion: number | null;
  }): Promise<number | null>;
}

export async function guestDocumentWorkspaceStore(): Promise<GuestDocumentWorkspaceStore> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  return {
    loadWorkspace: async (tokenHash) => {
      const { data: workspace, error } = await supabaseAdmin
        .from("guest_workspaces")
        .select("id, lock_version, expires_at, status")
        .eq("token_hash", tokenHash)
        .maybeSingle();
      if (error) fail("workspace", error);
      if (!workspace || workspace.status !== "active" || workspace.expires_at <= new Date().toISOString()) {
        throw new Error("That temporary workspace is no longer available.");
      }

      const { data: documents, error: documentsError } = await supabaseAdmin
        .from("source_documents")
        .select(
          "id, display_name, original_filename, document_type, effective_date, byte_size, page_count, created_at, archived_at",
        )
        .eq("guest_workspace_id", workspace.id)
        .order("created_at", { ascending: true });
      if (documentsError) fail("documents", documentsError);

      const { data: selections, error: selectionError } = await supabaseAdmin
        .from("guest_source_document_selections")
        .select("source_document_id")
        .eq("guest_workspace_id", workspace.id);
      if (selectionError) fail("selection", selectionError);

      const selectedIds = new Set(
        (selections ?? []).map((entry) => entry.source_document_id as string),
      );
      const library = ((documents ?? []) as unknown as GuestDocumentRow[]).map((row) =>
        summarize(row, selectedIds.has(row.id)),
      );

      return {
        lockVersion: workspace.lock_version,
        expiresAt: workspace.expires_at,
        selected: library.filter((document) => document.selected),
        library,
      };
    },

    attach: async ({ tokenHash, sourceDocumentId, expectedLockVersion }) => {
      const { data, error } = await supabaseAdmin.rpc("arc_attach_guest_source_document", {
        p_guest_token_hash: tokenHash,
        p_source_document_id: sourceDocumentId,
        p_expected_lock_version: expectedLockVersion,
      });
      if (isConflict(error)) throw new GuestSourceLockConflictError();
      if (error) fail("add", error);
      return data as unknown as number;
    },

    remove: async ({ tokenHash, sourceDocumentId, expectedLockVersion }) => {
      const { data, error } = await supabaseAdmin.rpc("arc_remove_guest_source_document", {
        p_guest_token_hash: tokenHash,
        p_source_document_id: sourceDocumentId,
        p_expected_lock_version: expectedLockVersion,
      });
      if (isConflict(error)) throw new GuestSourceLockConflictError();
      if (error) fail("remove", error);
      return data as unknown as number;
    },

    stageDeletion: async ({ tokenHash, sourceDocumentId, expectedLockVersion }) => {
      const { data, error } = await supabaseAdmin.rpc("arc_stage_source_document_deletion", {
        p_owner_user_id: null as never,
        p_guest_token_hash: tokenHash,
        p_source_document_id: sourceDocumentId,
        p_expected_lock_version: expectedLockVersion as never,
      });
      if (isConflict(error)) throw new GuestSourceLockConflictError();
      if (error) fail("deletion", error);
      const row = (data ?? [])[0];
      return row ? ((row.lock_version as number | null) ?? null) : null;
    },
  };
}
