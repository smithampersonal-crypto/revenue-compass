/**
 * Phase 8G — a browser payload can never supply or overwrite caller identity.
 */

import { describe, expect, it } from "vitest";

import { scopedToCaller } from "../caller-scope";

describe("caller identity scoping", () => {
  it("applies the server-derived owner even when the payload claims another one", () => {
    const scoped = scopedToCaller({ userId: "server-owner" }, {
      userId: "attacker-owner",
      sourceDocumentId: "doc-1",
    } as Record<string, unknown>);

    expect(scoped.userId).toBe("server-owner");
    expect(scoped).toEqual({ userId: "server-owner", sourceDocumentId: "doc-1" });
  });

  it("applies the server-derived guest credential hash over a supplied one", () => {
    const scoped = scopedToCaller({ tokenHash: "server-hash" }, {
      tokenHash: "other-workspace-hash",
      expectedLockVersion: 3,
    } as Record<string, unknown>);

    expect(scoped.tokenHash).toBe("server-hash");
    expect(scoped["expectedLockVersion"]).toBe(3);
  });

  it("leaves an ordinary payload untouched and does not mutate the input", () => {
    const data = { sourceDocumentId: "doc-1", archived: true };
    const scoped = scopedToCaller({ userId: "owner" }, data);

    expect(scoped).toEqual({ sourceDocumentId: "doc-1", archived: true, userId: "owner" });
    expect(data).toEqual({ sourceDocumentId: "doc-1", archived: true });
  });
});
