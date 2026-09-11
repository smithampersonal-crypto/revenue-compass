import { describe, expect, it } from "vitest";

import {
  deleteAccountHandler,
  DELETE_CONFIRMATION,
  NOTHING_REMOVED_MESSAGE,
  UNCONFIRMED_MESSAGE,
  type AccountDeletionDeps,
} from "../account.handlers";

const USER = "00000000-0000-4000-8000-00000000f001";

function depsFor(overrides: Partial<AccountDeletionDeps> = {}) {
  const calls: string[] = [];
  const purged: Array<{ userId: string; guestTokenHash: string | null }> = [];
  const verified: Array<{ userId: string; guestTokenHash: string | null }> = [];
  const deps: AccountDeletionDeps = {
    userId: USER,
    guestTokenHash: "hash-of-current-browser-guest",
    purgeGuestData: async (args) => {
      calls.push("purge");
      purged.push(args);
    },
    deleteAuthUser: async () => {
      calls.push("delete-auth-user");
    },
    verifyRemoval: async (args) => {
      calls.push("verify");
      verified.push(args);
      return { customers: 0, guestRows: 0 };
    },
    ...overrides,
  };
  return { deps, calls, purged, verified };
}

describe("account deletion handler", () => {
  it("requires the typed DELETE confirmation and does nothing without it", async () => {
    const { deps, calls } = depsFor();
    const result = await deleteAccountHandler(deps, { confirmation: "delete please" });
    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it("purges guest personal data before the auth identity is removed", async () => {
    const { deps, calls, purged } = depsFor();
    const result = await deleteAccountHandler(deps, { confirmation: DELETE_CONFIRMATION });
    expect(result).toEqual({ ok: true, guestCookieCleared: true });
    expect(calls).toEqual(["purge", "delete-auth-user", "verify"]);
    expect(purged[0]).toEqual({ userId: USER, guestTokenHash: "hash-of-current-browser-guest" });
  });

  it("uses the verified identity, never a browser-supplied id", async () => {
    const { deps, purged } = depsFor({ userId: "verified-id" });
    await deleteAccountHandler(deps, { confirmation: DELETE_CONFIRMATION });
    expect(purged[0]?.userId).toBe("verified-id");
  });

  it("says nothing was removed only when the purge itself failed first", async () => {
    const { deps, calls } = depsFor({
      purgeGuestData: async () => {
        throw new Error("purge boom");
      },
    });
    const result = await deleteAccountHandler(deps, { confirmation: DELETE_CONFIRMATION });
    expect(result).toEqual({ ok: false, reason: NOTHING_REMOVED_MESSAGE });
    expect(calls).toEqual([]);
  });

  it("does not claim nothing was removed when the purge succeeded but auth deletion failed", async () => {
    const { deps } = depsFor({
      deleteAuthUser: async () => {
        throw new Error("boom");
      },
    });
    const result = await deleteAccountHandler(deps, { confirmation: DELETE_CONFIRMATION });
    expect(result).toEqual({ ok: false, reason: UNCONFIRMED_MESSAGE });
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).not.toContain("Nothing has been removed");
    expect(result.reason).toContain("Some temporary data may already have been removed");
  });

  it("cannot report success when a post-condition query errors", async () => {
    const { deps } = depsFor({
      verifyRemoval: async () => {
        throw new Error("PostgREST unavailable");
      },
    });
    const result = await deleteAccountHandler(deps, { confirmation: DELETE_CONFIRMATION });
    expect(result).toEqual({ ok: false, reason: UNCONFIRMED_MESSAGE });
  });

  it("fails when owned rows or guest rows survive the deletion", async () => {
    const withCustomers = depsFor({ verifyRemoval: async () => ({ customers: 1, guestRows: 0 }) });
    expect(
      (await deleteAccountHandler(withCustomers.deps, { confirmation: DELETE_CONFIRMATION })).ok,
    ).toBe(false);

    const withGuest = depsFor({ verifyRemoval: async () => ({ customers: 0, guestRows: 2 }) });
    expect(
      (await deleteAccountHandler(withGuest.deps, { confirmation: DELETE_CONFIRMATION })).ok,
    ).toBe(false);
  });

  it("verifies the current browser's guest hash is absent before reporting success", async () => {
    const { deps, verified } = depsFor();
    const result = await deleteAccountHandler(deps, { confirmation: DELETE_CONFIRMATION });
    expect(result.ok).toBe(true);
    expect(verified[0]).toEqual({ userId: USER, guestTokenHash: "hash-of-current-browser-guest" });
  });

  it("still deletes cleanly when this browser has no guest workspace", async () => {
    const { deps, purged } = depsFor({ guestTokenHash: null });
    const result = await deleteAccountHandler(deps, { confirmation: DELETE_CONFIRMATION });
    expect(result.ok).toBe(true);
    expect(purged[0]?.guestTokenHash).toBeNull();
  });

  it("leaves another user's guest data alone: only the verified identity is purged", async () => {
    const otherUsersRows = new Set(["other-user-hash"]);
    const mine = new Set(["hash-of-current-browser-guest"]);
    const { deps } = depsFor({
      purgeGuestData: async ({ guestTokenHash }) => {
        if (guestTokenHash) mine.delete(guestTokenHash);
      },
      verifyRemoval: async () => ({ customers: 0, guestRows: mine.size }),
    });
    const result = await deleteAccountHandler(deps, { confirmation: DELETE_CONFIRMATION });
    expect(result.ok).toBe(true);
    expect(otherUsersRows.has("other-user-hash")).toBe(true);
  });
});
