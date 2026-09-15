/**
 * Phase 9B — the authorization boundary for an AI run's source set.
 *
 * Server-only. The browser never supplies an owner id, a workspace id or a
 * storage path: identity comes from the authenticated context or the hashed
 * HttpOnly guest credential, exactly as Phase 8 requires. Only documents that
 * are (a) owned/accessible by the caller, (b) inside the current editable ARC
 * scope, and (c) selected for the run are returned.
 */

import type { AiRunScope, AuthorizedSource } from "./request-package.server";

interface SourceRow {
  id: string;
  display_name: string;
  original_filename: string;
  sha256: string;
  byte_size: number;
  storage_object_path: string;
}

function fail(operation: string, error: { message?: string } | null): never {
  throw new Error(`The selected documents are unavailable (${operation}).`, { cause: error });
}

const COLUMNS = "id, display_name, original_filename, sha256, byte_size, storage_object_path";

function toAuthorized(rows: SourceRow[]): AuthorizedSource[] {
  return rows.map((row) => ({
    documentId: row.id,
    displayName: row.display_name,
    originalFilename: row.original_filename,
    sha256: row.sha256,
    byteSize: row.byte_size,
    storageObjectPath: row.storage_object_path,
  }));
}

export async function loadAuthorizedSelectedSources(
  scope: AiRunScope,
): Promise<AuthorizedSource[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  if (scope.kind === "authenticated") {
    // Ownership first, then scope: the revision must belong to that contract.
    const { data: contract, error: contractError } = await supabaseAdmin
      .from("contracts")
      .select("id, customers!inner(owner_user_id)")
      .eq("id", scope.contractId)
      .eq("customers.owner_user_id", scope.userId)
      .maybeSingle();
    if (contractError) fail("ownership", contractError);
    if (!contract) return [];

    const { data: revision, error: revisionError } = await supabaseAdmin
      .from("analysis_revisions")
      .select("id, status, analyses!analysis_revisions_analysis_id_fkey!inner(contract_id)")
      .eq("id", scope.revisionId)
      .maybeSingle();
    if (revisionError) fail("revision", revisionError);
    const analyses = revision?.analyses as unknown as { contract_id: string } | undefined;
    if (!revision || analyses?.contract_id !== scope.contractId) return [];
    // Only an editable draft may run an analysis; finalized history is immutable.
    if (revision.status !== "draft") return [];

    const { data, error } = await supabaseAdmin
      .from("revision_source_documents")
      .select(`source_document_id, source_documents!inner(${COLUMNS}, contract_id)`)
      .eq("revision_id", scope.revisionId);
    if (error) fail("selection", error);

    const rows = (
      (data ?? []) as unknown as { source_documents: SourceRow & { contract_id: string } }[]
    )
      .map((entry) => entry.source_documents)
      .filter((row) => row.contract_id === scope.contractId)
      .sort((a, b) => a.id.localeCompare(b.id));
    return toAuthorized(rows);
  }

  const { data: workspace, error: workspaceError } = await supabaseAdmin
    .from("guest_workspaces")
    .select("id, status, expires_at")
    .eq("token_hash", scope.guestTokenHash)
    .maybeSingle();
  if (workspaceError) fail("temporary workspace", workspaceError);
  if (
    !workspace ||
    workspace.status !== "active" ||
    new Date(workspace.expires_at).getTime() <= Date.now()
  ) {
    return [];
  }

  const { data, error } = await supabaseAdmin
    .from("guest_source_document_selections")
    .select(`source_document_id, source_documents!inner(${COLUMNS}, guest_workspace_id)`)
    .eq("guest_workspace_id", workspace.id);
  if (error) fail("selection", error);

  const rows = (
    (data ?? []) as unknown as { source_documents: SourceRow & { guest_workspace_id: string } }[]
  )
    .map((entry) => entry.source_documents)
    .filter((row) => row.guest_workspace_id === workspace.id)
    .sort((a, b) => a.id.localeCompare(b.id));
  return toAuthorized(rows);
}
