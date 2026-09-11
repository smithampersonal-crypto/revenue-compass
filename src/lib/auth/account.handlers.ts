/**
 * Phase 7F — account deletion, expressed as a dependency-injected handler.
 *
 * The server function in `account.functions.ts` calls this exact function, so
 * nothing is duplicated for tests. The identity being deleted always comes
 * from the verified Supabase session, never from browser input.
 */

export const DELETE_CONFIRMATION = "DELETE";

export interface AccountDeletionDeps {
  /** Verified identity from `requireSupabaseAuth` + `auth.getUser()`. */
  userId: string;
  /** SHA-256 of the current browser's guest credential, when one exists. */
  guestTokenHash: string | null;
  /** Service-role purge of guest rows holding this user's personal data. */
  purgeGuestData(args: { userId: string; guestTokenHash: string | null }): Promise<void>;
  /** Removes the Supabase auth identity; the owned chain cascades with it. */
  deleteAuthUser(userId: string): Promise<void>;
  /** Post-condition proof: rows still owned by the deleted identity. */
  countRemaining(userId: string): Promise<{ customers: number; guestRows: number }>;
}

export type AccountDeletionResult =
  { ok: true; guestCookieCleared: true } | { ok: false; reason: string };

const CONFIRM_MESSAGE = `Type ${DELETE_CONFIRMATION} to confirm that you want to delete your account.`;
const FAILED_MESSAGE =
  "Your account could not be deleted. Nothing has been removed — please try again.";
const INCOMPLETE_MESSAGE =
  "Your account could not be fully deleted. Please try again, or contact support.";

export async function deleteAccountHandler(
  deps: AccountDeletionDeps,
  input: { confirmation: string },
): Promise<AccountDeletionResult> {
  if ((input.confirmation ?? "").trim() !== DELETE_CONFIRMATION) {
    return { ok: false, reason: CONFIRM_MESSAGE };
  }

  try {
    // Order matters: guest rows that carry a copy of this person's analysis are
    // removed while `migrated_user_id` still identifies them. Deleting the auth
    // user first would set that column to null and orphan the personal data.
    await deps.purgeGuestData({ userId: deps.userId, guestTokenHash: deps.guestTokenHash });
    await deps.deleteAuthUser(deps.userId);
  } catch {
    return { ok: false, reason: FAILED_MESSAGE };
  }

  const remaining = await deps.countRemaining(deps.userId);
  if (remaining.customers > 0 || remaining.guestRows > 0) {
    return { ok: false, reason: INCOMPLETE_MESSAGE };
  }

  return { ok: true, guestCookieCleared: true };
}
