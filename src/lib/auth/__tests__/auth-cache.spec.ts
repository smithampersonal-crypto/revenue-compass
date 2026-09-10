import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { createAuthStateHandler } from "../auth-cache";

const userA = { user: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } };
const userB = { user: { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" } };

function setup() {
  const queryClient = new QueryClient();
  let invalidations = 0;
  const handle = createAuthStateHandler({
    queryClient,
    invalidateRouter: () => {
      invalidations += 1;
    },
  });
  return { queryClient, handle, invalidations: () => invalidations };
}

describe("auth state cache isolation", () => {
  it("removes private cached data on SIGNED_OUT", () => {
    const { queryClient, handle, invalidations } = setup();
    handle("SIGNED_IN", userA);
    queryClient.setQueryData(["verified-identity"], { userId: userA.user.id });

    handle("SIGNED_OUT", null);

    expect(queryClient.getQueryData(["verified-identity"])).toBeUndefined();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(invalidations()).toBeGreaterThan(0);
  });

  it("clears User A cached data before User B's session can render", () => {
    const { queryClient, handle } = setup();
    handle("SIGNED_IN", userA);
    queryClient.setQueryData(["verified-identity"], { userId: userA.user.id });
    queryClient.setQueryData(["contracts"], [{ id: "contract-a" }]);

    // Account switch without an intervening SIGNED_OUT (other tab, expiry).
    handle("SIGNED_IN", userB);

    expect(queryClient.getQueryData(["verified-identity"])).toBeUndefined();
    expect(queryClient.getQueryData(["contracts"])).toBeUndefined();
  });

  it("keeps cached data across a token refresh for the same identity", () => {
    const { queryClient, handle } = setup();
    handle("SIGNED_IN", userA);
    queryClient.setQueryData(["contracts"], [{ id: "contract-a" }]);

    handle("TOKEN_REFRESHED", userA);

    expect(queryClient.getQueryData(["contracts"])).toEqual([{ id: "contract-a" }]);
  });
});
