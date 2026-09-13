/**
 * Service-role store for temporary (guest) workspaces. Server-only: this file
 * is blocked from client bundles by its `.server` name, and `guest_workspaces`
 * grants no direct anon or authenticated access.
 *
 * Database, network and PostgREST errors are never swallowed: they throw, so
 * the workspace shows a load/save error and keeps its existing credential.
 * "No row" and "no row matched the lock" stay ordinary results.
 */

import type { GuestStore } from "./guest.handlers";

export async function createGuestStore(): Promise<GuestStore> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const columns = "id, draft_json, schema_version, lock_version, status, expires_at";
  const fail = (operation: string, error: { message?: string }): never => {
    throw new Error(`The temporary workspace store is unavailable (${operation}).`, {
      cause: error,
    });
  };
  return {
    findByHash: async (tokenHash) => {
      const { data, error } = await supabaseAdmin
        .from("guest_workspaces")
        .select(columns)
        .eq("token_hash", tokenHash)
        .maybeSingle();
      if (error) fail("lookup", error);
      return (data as never) ?? null;
    },
    insert: async (row) => {
      const { data, error } = await supabaseAdmin
        .from("guest_workspaces")
        .insert(row as never)
        .select(columns)
        .maybeSingle();
      if (error) fail("create", error);
      return (data as never) ?? null;
    },
    updateDraft: async ({ tokenHash, expectedLockVersion, canonical, schemaVersion }) => {
      const { data, error } = await supabaseAdmin
        .from("guest_workspaces")
        .update({
          draft_json: canonical as never,
          schema_version: schemaVersion,
          lock_version: expectedLockVersion + 1,
        })
        .eq("token_hash", tokenHash)
        .eq("lock_version", expectedLockVersion)
        .eq("status", "active")
        .gt("expires_at", new Date().toISOString())
        .select("lock_version, updated_at")
        .maybeSingle();
      // A database error is not a lock conflict; only a clean zero-row update is.
      if (error) fail("save", error);
      return (data as never) ?? null;
    },
  };
}
