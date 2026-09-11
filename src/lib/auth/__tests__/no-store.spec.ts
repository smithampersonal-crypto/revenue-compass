import { beforeEach, describe, expect, it, vi } from "vitest";

const setResponseHeader = vi.fn();

vi.mock("@tanstack/react-start/server", () => ({
  setResponseHeader: (name: string, value: string) => setResponseHeader(name, value),
}));

import { applyNoStore, NO_STORE_VALUE } from "../no-store";

describe("private RPC cache policy", () => {
  beforeEach(() => setResponseHeader.mockClear());

  it("marks an authenticated RPC response no-store before the handler runs", async () => {
    const order: string[] = [];
    setResponseHeader.mockImplementation(() => order.push("header"));
    const result = await applyNoStore(async () => {
      order.push("handler");
      return { customers: [] };
    });
    expect(result).toEqual({ customers: [] });
    expect(order).toEqual(["header", "handler"]);
    expect(setResponseHeader).toHaveBeenCalledWith("Cache-Control", NO_STORE_VALUE);
  });

  it("marks a guest-workspace RPC response no-store too", async () => {
    await applyNoStore(async () => ({ kind: "guest" as const }));
    expect(setResponseHeader).toHaveBeenCalledWith("Cache-Control", NO_STORE_VALUE);
    expect(NO_STORE_VALUE).toContain("no-store");
    expect(NO_STORE_VALUE).toContain("private");
  });

  it("is registered for every server function", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../../../start.ts", import.meta.url), "utf8"),
    );
    expect(source).toMatch(/functionMiddleware:\s*\[[^\]]*noStoreMiddleware/s);
  });
});
