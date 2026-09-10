import type { QueryClient } from "@tanstack/react-query";

export type AuthCacheEvent = string;
export type AuthCacheSession = { user?: { id?: string | null } | null } | null;

type Deps = {
  queryClient: QueryClient;
  invalidateRouter: () => void;
};

/**
 * Identity boundary for cached data.
 *
 * Signing out — or any identity change, including a session expiring, a sign
 * out in another tab, or switching accounts — must destroy every cached query
 * belonging to the previous identity before anything can render for the next
 * one. The AccountMenu handler alone is not sufficient because those
 * transitions happen outside of it.
 */
export function createAuthStateHandler({ queryClient, invalidateRouter }: Deps) {
  let currentUserId: string | null = null;
  let initialised = false;

  const purge = () => {
    void queryClient.cancelQueries();
    // clear() wipes the MutationCache too; removeQueries() alone would let a
    // pending autosave/finalize mutation from User A survive into User B.
    queryClient.clear();
  };

  return (event: AuthCacheEvent, session: AuthCacheSession) => {
    const nextUserId = session?.user?.id ?? null;

    if (event === "SIGNED_OUT") {
      purge();
      currentUserId = null;
      initialised = true;
      invalidateRouter();
      return;
    }

    if (event !== "SIGNED_IN" && event !== "USER_UPDATED" && event !== "INITIAL_SESSION") {
      // TOKEN_REFRESHED and friends are not identity transitions.
      return;
    }

    const identityChanged = initialised && nextUserId !== currentUserId;
    currentUserId = nextUserId;
    initialised = true;

    if (event === "INITIAL_SESSION" && !identityChanged) return;

    if (identityChanged) purge();
    invalidateRouter();
    if (nextUserId) void queryClient.invalidateQueries();
  };
}
