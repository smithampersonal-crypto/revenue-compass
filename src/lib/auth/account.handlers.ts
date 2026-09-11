/**
 * Phase 7F — account deletion, expressed as a dependency-injected handler.
 *
 * The server function in `account.functions.ts` calls this exact function, so
 * nothing is duplicated for tests. The identity being deleted always comes
 * from the verified Supabase session, never from browser input.
 *
 * Outcome language is precise: "nothing has been removed" is only ever used
 * before any destructive step has run. Once guest rows may already be gone,
 * a failure reports an unconfirmed deletion instead.
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
  /**
   * Post-condition proof. MUST throw when the database cannot answer: an
   * unreadable count is never the same as a count of zero.
   */
  verifyRemoval(args: {
    userId: string;
    guestTokenHash: string | null;
  }): Promise<{ customers: number; guestRows: number }>;
}

export type AccountDeletionResult =
  { ok: true; guestCookieCleared: true } | { ok: false; reason: string };

const CONFIRM_MESSAGE = `Type ${DELETE_CONFIRMATION} to confirm that you want to delete your account.`;
/**
 * Only ever valid for a state provably BEFORE any destructive operation has
 * been initiated. Once a purge or deletion request has left, an error is an
 * unknown outcome, not proof that nothing happened.
 */
export const NOTHING_REMOVED_MESSAGE =
  "Your account could not be deleted. Nothing has been removed — please try again.";
/** Used once a destructive step may already have taken effect. */
export const UNCONFIRMED_MESSAGE =
  "Account deletion could not be fully confirmed. Some temporary data may already have been removed. Please try again, or contact support.";

/**
 * Any failure after the delete request has been sent — including transport and
 * serialization errors — is an unknown outcome.
 */
export function messageForRequestFailure(): string {
  return UNCONFIRMED_MESSAGE;
}

/**
 * Proof-of-absence helper for post-condition queries. A missing or non-numeric
 * count is never evidence of zero rows.
 */
export function requireExactCount(
  result: { error?: unknown; count?: number | null },
  label: string,
): number {
  if (result.error) {
    throw new Error(`post-condition query failed (${label})`, { cause: result.error });
  }
  const count = result.count;
  if (typeof count !== "number" || !Number.isFinite(count) || count < 0) {
    throw new Error(`post-condition count unavailable (${label})`);
  }
  return count;
}

export async function deleteAccountHandler(
  deps: AccountDeletionDeps,
  input: { confirmation: string },
): Promise<AccountDeletionResult> {
  if ((input.confirmation ?? "").trim() !== DELETE_CONFIRMATION) {
    return { ok: false, reason: CONFIRM_MESSAGE };
  }

  // Order matters: guest rows that carry a copy of this person's analysis are
  // removed while `migrated_user_id` still identifies them. A guest workspace
  // migrated after this purge still disappears, because that column now
  // cascades on auth deletion.
  try {
    await deps.purgeGuestData({ userId: deps.userId, guestTokenHash: deps.guestTokenHash });
  } catch {
    // The purge is itself destructive: a failed or lost response is an unknown
    // outcome, never proof that no row was removed.
    return { ok: false, reason: UNCONFIRMED_MESSAGE };
  }

  try {
    await deps.deleteAuthUser(deps.userId);
  } catch {
    return { ok: false, reason: UNCONFIRMED_MESSAGE };
  }

  let remaining: { customers: number; guestRows: number };
  try {
    remaining = await deps.verifyRemoval({
      userId: deps.userId,
      guestTokenHash: deps.guestTokenHash,
    });
  } catch {
    // A failed verification query is not evidence of a clean deletion.
    return { ok: false, reason: UNCONFIRMED_MESSAGE };
  }

  if (remaining.customers > 0 || remaining.guestRows > 0) {
    return { ok: false, reason: UNCONFIRMED_MESSAGE };
  }

  return { ok: true, guestCookieCleared: true };
}
