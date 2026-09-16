/**
 * Phase 9F — developer-only cleanup of stranded disposable fixture scopes.
 *
 * Removes the throwaway `*@arc-fixture.invalid` accounts created by
 * `scripts/phase9f-live.ts` through ARC's own trusted account-deletion path
 * (`deleteAccountHandler`), so the owned chain — customers, contracts,
 * revisions, documents, AI runs — cascades exactly as it does for a real
 * person deleting their account.
 *
 * It never rewrites a run's outcome and never refunds a consumed allowance.
 * It prints no draft values, document text or credentials.
 */

import {
  DELETE_CONFIRMATION,
  deleteAccountHandler,
  requireExactCount,
} from "@/lib/auth/account.handlers";

const UUID = /^[0-9a-f-]{36}$/i;

async function main(): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const ids = process.argv.slice(2).filter((value) => UUID.test(value));
  if (ids.length === 0) throw new Error("pass the disposable fixture user ids as arguments.");
  console.log(`fixture accounts to remove: ${ids.length}`);

  for (const user of ids.map((id) => ({ id }))) {
    const result = await deleteAccountHandler(
      {
        userId: user.id,
        guestTokenHash: null,
        purgeGuestData: async ({ userId }) => {
          const { error } = await supabaseAdmin.rpc("arc_purge_user_guest_data", {
            p_user_id: userId,
            p_guest_token_hash: "",
          } as never);
          if (error) throw new Error("guest purge failed");
        },
        deleteAuthUser: async (userId) => {
          const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
          if (error) throw new Error("auth deletion failed");
        },
        verifyRemoval: async ({ userId }) => ({
          customers: requireExactCount(
            await supabaseAdmin
              .from("customers")
              .select("id", { count: "exact", head: true })
              .eq("owner_user_id", userId),
            "customers",
          ),
          guestRows: requireExactCount(
            await supabaseAdmin
              .from("guest_workspaces")
              .select("id", { count: "exact", head: true })
              .eq("migrated_user_id", userId),
            "migrated guest rows",
          ),
        }),
      },
      { confirmation: DELETE_CONFIRMATION },
    );
    console.log(`${user.id}: ${result.ok ? "deleted" : `not deleted (${result.reason})`}`);
  }
}

await main();
