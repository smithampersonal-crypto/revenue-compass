import { describe, expect, it } from "vitest";

import { applyNoStore, isPrivateRpcRequest, NO_STORE_VALUE } from "../no-store";

describe("private RPC cache policy", () => {
  it("marks an authenticated RPC response no-store", () => {
    const response = applyNoStore(new Response(JSON.stringify({ customers: [] })));
    expect(response.headers.get("Cache-Control")).toBe(NO_STORE_VALUE);
    expect(NO_STORE_VALUE).toContain("no-store");
    expect(NO_STORE_VALUE).toContain("private");
  });

  it("recognises authenticated and guest server-function requests", () => {
    expect(isPrivateRpcRequest("http://localhost:8080/_serverFn/listCustomers")).toBe(true);
    expect(isPrivateRpcRequest("http://localhost:8080/_serverFn/guestLoad")).toBe(true);
    expect(isPrivateRpcRequest("http://localhost:8080/analysis")).toBe(false);
  });

  it("is registered for every server-function request", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../../../start.ts", import.meta.url), "utf8"),
    );
    expect(source).toMatch(/requestMiddleware:\s*\[[^\]]*noStoreMiddleware/s);
  });
});
