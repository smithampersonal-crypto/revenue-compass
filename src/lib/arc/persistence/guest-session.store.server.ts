/**
 * Package 3D-T — service-role store for guest sessions. Server-only: blocked
 * from client bundles by its `.server` name. `guest_sessions` and
 * `guest_workspaces` grant nothing to browser roles.
 */

import type { GuestSessionStore } from "./guest-session.handlers";

export async function createGuestSessionStore(): Promise<GuestSessionStore> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // The generated types may lag the 3D-T columns; the shapes are checked here.
  const db = supabaseAdmin as unknown as {
    from(table: string): any;
    rpc(fn: string, args: Record<string, unknown>): any;
  };
  const fail = (operation: string, error: { message?: string }): never => {
    throw new Error(`The temporary analysis store is unavailable (${operation}).`, {
      cause: error,
    });
  };
  const columns = "id, draft_json, schema_version, lock_version, status, expires_at";

  return {
    resolveSession: async (sessionHash) => {
      const { data, error } = await db.rpc("arc_resolve_guest_session", {
        p_session_hash: sessionHash,
      });
      if (error) fail("session", error);
      const row = (Array.isArray(data) ? data[0] : data) as
        | { session_id: string; expires_at: string }
        | null
        | undefined;
      return row ? { id: row.session_id, expiresAt: row.expires_at } : null;
    },
    createSession: async (row) => {
      const { data, error } = await db
        .from("guest_sessions")
        .insert(row)
        .select("id, expires_at")
        .maybeSingle();
      if (error) fail("session create", error);
      return data ? { id: data.id as string, expiresAt: data.expires_at as string } : null;
    },
    findAnalysis: async (id) => {
      const { data, error } = await db
        .from("guest_workspaces")
        .select("id, session_id, credential_kind, token_hash, status, expires_at")
        .eq("id", id)
        .maybeSingle();
      if (error) fail("lookup", error);
      return data ?? null;
    },
    upgradeLegacy: async ({ sessionHash, workspaceId, newTokenHash }) => {
      const { data, error } = await db.rpc("arc_upgrade_legacy_guest_workspace", {
        p_session_hash: sessionHash,
        p_workspace_id: workspaceId,
        p_new_token_hash: newTokenHash,
      });
      if (error) fail("upgrade", error);
      return data === true;
    },
    insertAnalysis: async (row) => {
      const { data, error } = await db
        .from("guest_workspaces")
        .insert(row)
        .select(columns)
        .maybeSingle();
      if (error) fail("create", error);
      return data ?? null;
    },
    listSummaries: async (sessionId, now) => {
      const { data: rows, error } = await db
        .from("guest_workspaces")
        .select("id, origin, draft_json, updated_at, expires_at")
        .eq("session_id", sessionId)
        .eq("status", "active")
        .gt("expires_at", now.toISOString())
        .order("updated_at", { ascending: false });
      if (error) fail("list", error);
      const list = (rows ?? []) as Array<{
        id: string;
        origin: string;
        draft_json: unknown;
        updated_at: string;
        expires_at: string;
      }>;
      if (list.length === 0) return [];
      const ids = list.map((row) => row.id);

      const [selections, runs, states] = await Promise.all([
        db
          .from("guest_source_document_selections")
          .select("guest_workspace_id, created_at, source_documents(display_name)")
          .in("guest_workspace_id", ids)
          .order("created_at", { ascending: true }),
        db.from("ai_runs").select("guest_workspace_id, stage").in("guest_workspace_id", ids),
        db
          .from("ai_analysis_state")
          .select("guest_workspace_id, review_items")
          .in("guest_workspace_id", ids),
      ]);
      if (selections.error) fail("list sources", selections.error);
      if (runs.error) fail("list runs", runs.error);
      if (states.error) fail("list review", states.error);

      const firstSource = new Map<string, string>();
      for (const row of (selections.data ?? []) as Array<{
        guest_workspace_id: string;
        source_documents: { display_name?: string } | null;
      }>) {
        const name = row.source_documents?.display_name;
        if (name && !firstSource.has(row.guest_workspace_id)) {
          firstSource.set(row.guest_workspace_id, name);
        }
      }
      const stages = new Map<string, string[]>();
      for (const row of (runs.data ?? []) as Array<{ guest_workspace_id: string; stage: string }>) {
        stages.set(row.guest_workspace_id, [...(stages.get(row.guest_workspace_id) ?? []), row.stage]);
      }
      const review = new Map<string, unknown>();
      for (const row of (states.data ?? []) as Array<{
        guest_workspace_id: string;
        review_items: unknown;
      }>) {
        review.set(row.guest_workspace_id, row.review_items);
      }

      return list.map((row) => ({
        ...row,
        firstSourceName: firstSource.get(row.id) ?? null,
        runStages: stages.get(row.id) ?? [],
        reviewItems: review.get(row.id) ?? null,
      }));
    },
  };
}
