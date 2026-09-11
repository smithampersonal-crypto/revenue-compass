/**
 * Phase 7F — account deletion server function.
 *
 * Signed-in callers only. The user id comes from `requireSupabaseAuth` plus a
 * server-side `auth.getUser()` re-verification; the browser only supplies the
 * typed confirmation word.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { clearGuestCookie, hashGuestToken, readGuestCookie } from "@/lib/arc/persistence/guest";

import {
  deleteAccountHandler,
  DELETE_CONFIRMATION,
  requireExactCount,
  type AccountDeletionResult,
} from "./account.handlers";

function isSecureRequest(url: string, forwardedProto: string | null): boolean {
  if (forwardedProto) return forwardedProto.split(",")[0]!.trim() === "https";
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

export const deleteAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { confirmation: string }) => ({
    confirmation: z
      .string()
      .max(50)
      .parse(input?.confirmation ?? ""),
  }))
  .handler(async ({ data, context }): Promise<AccountDeletionResult> => {
    const { data: verified, error } = await context.supabase.auth.getUser();
    if (error || !verified.user || verified.user.id !== context.userId) {
      throw new Error("Unauthorized: identity could not be verified");
    }

    const { getRequest, setResponseHeader } = await import("@tanstack/react-start/server");
    const request = getRequest();
    const secure = isSecureRequest(request.url, request.headers.get("x-forwarded-proto"));
    const rawGuestToken = readGuestCookie(request.headers.get("cookie"), secure);
    const guestTokenHash = rawGuestToken ? await hashGuestToken(rawGuestToken) : null;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const result = await deleteAccountHandler(
      {
        userId: verified.user.id,
        guestTokenHash,
        purgeGuestData: async ({ userId, guestTokenHash: hash }) => {
          const { error: purgeError } = await supabaseAdmin.rpc("arc_purge_user_guest_data", {
            p_user_id: userId,
            p_guest_token_hash: hash ?? "",
          } as never);
          if (purgeError) throw new Error("guest purge failed", { cause: purgeError });
        },
        deleteAuthUser: async (userId) => {
          const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
          if (deleteError) throw new Error("auth deletion failed", { cause: deleteError });
        },
        // A failed or unavailable verification query must never read as
        // "count = 0, verified": only an explicit numeric zero proves absence.
        verifyRemoval: async ({ userId, guestTokenHash: hash }) => {
          const customers = requireExactCount(
            await supabaseAdmin
              .from("customers")
              .select("id", { count: "exact", head: true })
              .eq("owner_user_id", userId),
            "customers",
          );

          const migratedGuests = requireExactCount(
            await supabaseAdmin
              .from("guest_workspaces")
              .select("id", { count: "exact", head: true })
              .eq("migrated_user_id", userId),
            "migrated guest rows",
          );

          let browserGuests = 0;
          if (hash) {
            browserGuests = requireExactCount(
              await supabaseAdmin
                .from("guest_workspaces")
                .select("id", { count: "exact", head: true })
                .eq("token_hash", hash),
              "current browser guest row",
            );
          }

          return { customers, guestRows: migratedGuests + browserGuests };
        },
      },
      { confirmation: data.confirmation },
    );

    // The browser's temporary-workspace credential is retired with the account.
    if (result.ok) setResponseHeader("Set-Cookie", clearGuestCookie(secure));
    return result;
  });

export { DELETE_CONFIRMATION };
