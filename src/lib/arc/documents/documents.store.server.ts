/**
 * Phase 8B — service-role store and Storage boundary for source documents.
 *
 * Server-only. Every write goes through the accepted Phase 8A trusted
 * transactions; this module only reads the facts the handlers need in order to
 * authorize a caller, and never decides recording or association itself.
 */

import {
  createDocumentReadUrl,
  createPendingUploadTarget,
  downloadPrivateObject,
  ensureObjectPromoted,
  privateObjectExists,
  removePrivateObjects,
} from "./storage.server";
import type { DocumentStorage, DocumentStore } from "./documents.handlers";
import { SOURCE_DOCUMENT_BUCKET } from "./types";

function fail(operation: string, error: { message?: string }): never {
  throw new Error(`The document store is unavailable (${operation}).`, { cause: error });
}

export async function documentStore(): Promise<DocumentStore> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  return {
    contractIsOwnedBy: async (contractId, userId) => {
      const { data, error } = await supabaseAdmin
        .from("contracts")
        .select("id, customers!inner(owner_user_id)")
        .eq("id", contractId)
        .eq("customers.owner_user_id", userId)
        .maybeSingle();
      if (error) fail("ownership", error);
      return Boolean(data);
    },

    findDraftRevision: async (revisionId) => {
      const { data, error } = await supabaseAdmin
        .from("analysis_revisions")
        .select("id, status, lock_version, analyses!inner(contract_id)")
        .eq("id", revisionId)
        .maybeSingle();
      if (error) fail("revision", error);
      if (!data) return null;
      const analyses = data.analyses as unknown as { contract_id: string };
      return {
        id: data.id,
        contractId: analyses.contract_id,
        status: data.status,
        lockVersion: data.lock_version,
      };
    },

    findActiveGuest: async (tokenHash) => {
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

    createIntent: async (row) => {
      const { data, error } = await supabaseAdmin
        .from("document_upload_intents")
        .insert(row as never)
        .select("id, expires_at")
        .maybeSingle();
      if (error || !data) fail("upload intent", error ?? {});
      return { id: data.id, expiresAt: data.expires_at };
    },

    loadIntent: async (intentId) => {
      const { data, error } = await supabaseAdmin
        .from("document_upload_intents")
        .select(
          "id, contract_id, guest_workspace_id, target_revision_id, pending_object_path, permanent_object_path, resolved_source_document_id, is_duplicate, state, expires_at, original_filename, display_name",
        )
        .eq("id", intentId)
        .maybeSingle();
      if (error) fail("upload intent", error);
      return (data as never) ?? null;
    },

    markIntentFailed: async (intentId) => {
      const { error } = await supabaseAdmin
        .from("document_upload_intents")
        .update({ state: "failed" })
        .eq("id", intentId)
        .eq("state", "pending");
      if (error) fail("upload intent", error);
    },

    queueDeletion: async (objectPath, reason) => {
      // Idempotent by (bucket, path): a retried cleanup joins the existing
      // job instead of creating a duplicate or failing the caller.
      const { error } = await supabaseAdmin.from("storage_deletion_queue").upsert(
        {
          storage_bucket: SOURCE_DOCUMENT_BUCKET,
          storage_object_path: objectPath,
          reason,
        },
        { onConflict: "storage_bucket,storage_object_path", ignoreDuplicates: true },
      );
      if (error) fail("cleanup queue", error);
    },

    prepare: async (args) => {
      const { data, error } = await supabaseAdmin.rpc("arc_prepare_source_document_upload", {
        p_intent_id: args.intentId,
        p_owner_user_id: args.ownerUserId as never,
        p_guest_token_hash: args.guestTokenHash as never,
        p_sha256: args.sha256,
        p_byte_size: args.byteSize,
        p_page_count: args.pageCount,
      });
      if (error) fail("recording", error);
      const row = (data ?? [])[0];
      if (!row) fail("recording", { message: "no result" });
      return {
        sourceDocumentId: row.source_document_id,
        permanentObjectPath: row.permanent_object_path,
        duplicate: row.duplicate,
        requiresPromotion: row.requires_promotion,
      };
    },

    commit: async (args) => {
      const { data, error } = await supabaseAdmin.rpc("arc_commit_source_document_upload", {
        p_intent_id: args.intentId,
        p_owner_user_id: args.ownerUserId as never,
        p_guest_token_hash: args.guestTokenHash as never,
        p_expected_lock_version: args.expectedLockVersion as never,
      });
      if (error) fail("recording", error);
      const row = (data ?? [])[0];
      if (!row) fail("recording", { message: "no result" });
      return {
        sourceDocumentId: row.source_document_id,
        duplicate: row.duplicate,
        associated: row.associated,
        associationConflict: row.association_conflict,
        lockVersion: row.lock_version,
      };
    },

    findOwnedDocument: async (documentId, userId) => {
      const { data, error } = await supabaseAdmin
        .from("source_documents")
        .select(
          "id, storage_object_path, original_filename, contracts!inner(customers!inner(owner_user_id))",
        )
        .eq("id", documentId)
        .eq("contracts.customers.owner_user_id", userId)
        .maybeSingle();
      if (error) fail("document", error);
      if (!data) return null;
      return {
        id: data.id,
        storageObjectPath: data.storage_object_path,
        originalFilename: data.original_filename,
      };
    },

    findGuestDocument: async (documentId, workspaceId) => {
      const { data, error } = await supabaseAdmin
        .from("source_documents")
        .select("id, storage_object_path, original_filename")
        .eq("id", documentId)
        .eq("guest_workspace_id", workspaceId)
        .maybeSingle();
      if (error) fail("document", error);
      if (!data) return null;
      return {
        id: data.id,
        storageObjectPath: data.storage_object_path,
        originalFilename: data.original_filename,
      };
    },
  };
}

export const documentStorage: DocumentStorage = {
  createPendingUploadTarget,
  download: downloadPrivateObject,
  promote: ensureObjectPromoted,
  exists: privateObjectExists,
  remove: removePrivateObjects,
  createReadUrl: createDocumentReadUrl,
};
