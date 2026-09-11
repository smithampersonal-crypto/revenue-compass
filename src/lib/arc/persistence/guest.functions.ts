/**
 * Phase 7E — guest workspace server functions.
 *
 * Guest CRUD is server-only: `guest_workspaces` grants no direct anon or
 * authenticated access, so every read and write here runs through the
 * service-role client, loaded inside the handler. Authorization is the
 * HttpOnly cookie credential and the row's `expires_at`, checked on every
 * call.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { WorkflowDraft } from "@/lib/asc606-workflow";

import { buildGuestCookie, clearGuestCookie, readGuestCookie } from "./guest";
import {
  migrateGuestWorkspaceHandler,
  resumeOrCreateGuestHandler,
  saveGuestDraftHandler,
  type GuestMigrationResult,
  type GuestSaveResult,
  type GuestStore,
} from "./guest.handlers";

export interface GuestWorkspaceDto {
  kind: "guest";
  draft: WorkflowDraft;
  lockVersion: number;
  /** When this temporary workspace and its credential stop working. */
  expiresAt: string;
  schemaVersion: string;
  resumed: boolean;
}

/** True on https; local http development falls back to a non-`__Host-` name. */
function isSecureRequest(url: string, forwardedProto: string | null): boolean {
  if (forwardedProto) return forwardedProto.split(",")[0]!.trim() === "https";
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

async function requestCookieContext() {
  const { getRequest } = await import("@tanstack/react-start/server");
  const request = getRequest();
  const secure = isSecureRequest(request.url, request.headers.get("x-forwarded-proto"));
  return {
    secure,
    token: readGuestCookie(request.headers.get("cookie"), secure),
  };
}

async function setCookieHeader(value: string) {
  const { setResponseHeader } = await import("@tanstack/react-start/server");
  setResponseHeader("Set-Cookie", value);
}

/** Service-role store. Never reachable from the browser. */
async function guestStore(): Promise<GuestStore> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const columns = "id, draft_json, schema_version, lock_version, status, expires_at";
  return {
    findByHash: async (tokenHash) => {
      const { data } = await supabaseAdmin
        .from("guest_workspaces")
        .select(columns)
        .eq("token_hash", tokenHash)
        .eq("status", "active")
        .maybeSingle();
      return (data as never) ?? null;
    },
    insert: async (row) => {
      const { data } = await supabaseAdmin
        .from("guest_workspaces")
        .insert(row as never)
        .select(columns)
        .maybeSingle();
      return (data as never) ?? null;
    },
    updateDraft: async ({ tokenHash, expectedLockVersion, canonical }) => {
      const { data } = await supabaseAdmin
        .from("guest_workspaces")
        .update({
          draft_json: canonical as never,
          lock_version: expectedLockVersion + 1,
        })
        .eq("token_hash", tokenHash)
        .eq("lock_version", expectedLockVersion)
        .eq("status", "active")
        .gt("expires_at", new Date().toISOString())
        .select("lock_version, updated_at")
        .maybeSingle();
      return (data as never) ?? null;
    },
  };
}

/**
 * Opens the visitor's temporary workspace: resumes the one their credential
 * names when it is still valid, otherwise starts a fresh 9-hour workspace and
 * issues a new HttpOnly credential. The raw credential is never returned to
 * the browser as data.
 */
export const resumeGuestWorkspace = createServerFn({ method: "POST" }).handler(
  async (): Promise<GuestWorkspaceDto> => {
    const { secure, token } = await requestCookieContext();
    const result = await resumeOrCreateGuestHandler(
      { store: await guestStore(), now: () => new Date() },
      { token },
    );
    if (result.issuedToken) await setCookieHeader(buildGuestCookie(result.issuedToken, secure));
    return {
      kind: "guest",
      draft: result.workspace.draft,
      lockVersion: result.workspace.lockVersion,
      expiresAt: result.workspace.expiresAt,
      schemaVersion: result.workspace.schemaVersion,
      resumed: result.resumed,
    };
  },
);

/** Optimistically locked autosave for the credential's temporary workspace. */
export const saveGuestDraft = createServerFn({ method: "POST" })
  .inputValidator((input: { expectedLockVersion: number; draft: WorkflowDraft }) => ({
    expectedLockVersion: z.number().int().min(1).parse(input?.expectedLockVersion),
    draft: input.draft,
  }))
  .handler(async ({ data }): Promise<GuestSaveResult> => {
    const { token } = await requestCookieContext();
    return saveGuestDraftHandler(
      { store: await guestStore(), now: () => new Date() },
      { token, expectedLockVersion: data.expectedLockVersion, draft: data.draft },
    );
  });

/**
 * Explicit "Save this analysis": the signed-in caller turns their temporary
 * workspace into a saved customer, contract, analysis and revision 1 in one
 * trusted transaction. Signing in alone never triggers this.
 *
 * The credential is retired only after the transaction succeeds.
 */
export const migrateGuestWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { contractTitle: string }) => ({
    contractTitle: z
      .string()
      .max(300)
      .parse(input?.contractTitle ?? ""),
  }))
  .handler(async ({ data, context }): Promise<GuestMigrationResult> => {
    const { secure, token } = await requestCookieContext();
    const result = await migrateGuestWorkspaceHandler(
      {
        store: await guestStore(),
        now: () => new Date(),
        userId: context.userId,
        migrateTransaction: async (args) => {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          return supabaseAdmin.rpc("arc_migrate_guest_workspace_by_token", args as never);
        },
      },
      { token, contractTitle: data.contractTitle },
    );

    if (result.ok) await setCookieHeader(clearGuestCookie(secure));
    return result;
  });
