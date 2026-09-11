import { describe, expect, it } from "vitest";

import {
  deleteAccountHandler,
  DELETE_CONFIRMATION,
  type AccountDeletionDeps,
} from "../account.handlers";

const USER = "00000000-0000-4000-8000-00000000f001";

function depsFor(overrides: Partial<AccountDeletionDeps> = {}) {
  const calls: string[] = [];
  const purged: Array<{ userId: string; guestTokenHash: string | null }> = [];
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
    countRemaining: async () => ({ customers: 0, guestRows: 0 }),
    ...overrides,
  };
  return { deps, calls, purged };
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
    expect(calls).toEqual(["purge", "delete-auth-user"]);
    expect(purged[0]).toEqual({ userId: USER, guestTokenHash: "hash-of-current-browser-guest" });
  });

  it("uses the verified identity, never a browser-supplied id", async () => {
    const { deps, purged } = depsFor({ userId: "verified-id" });
    await deleteAccountHandler(deps, { confirmation: DELETE_CONFIRMATION });
    expect(purged[0]?.userId).toBe("verified-id");
  });

  it("reports failure without claiming success when the auth deletion fails", async () => {
    const { deps } = depsFor({
      deleteAuthUser: async () => {
        throw new Error("boom");
      },
    });
    const result = await deleteAccountHandler(deps, { confirmation: DELETE_CONFIRMATION });
    expect(result).toEqual({
      ok: false,
      reason: "Your account could not be deleted. Nothing has been removed — please try again.",
    });
  });

  it("fails when owned rows or user guest rows survive the deletion", async () => {
    const withCustomers = depsFor({ countRemaining: async () => ({ customers: 1, guestRows: 0 }) });
    expect(
      (await deleteAccountHandler(withCustomers.deps, { confirmation: DELETE_CONFIRMATION })).ok,
    ).toBe(false);

    const withGuest = depsFor({ countRemaining: async () => ({ customers: 0, guestRows: 2 }) });
    expect(
      (await deleteAccountHandler(withGuest.deps, { confirmation: DELETE_CONFIRMATION })).ok,
    ).toBe(false);
  });

  it("still deletes cleanly when this browser has no guest workspace", async () => {
    const { deps, purged } = depsFor({ guestTokenHash: null });
    const result = await deleteAccountHandler(deps, { confirmation: DELETE_CONFIRMATION });
    expect(result.ok).toBe(true);
    expect(purged[0]?.guestTokenHash).toBeNull();
  });
});
