/**
 * Component-test setup. This file is loaded for every test file, but only does
 * work when a DOM is present, so the pure accounting suite in the node
 * environment is unaffected.
 */
if (typeof document !== "undefined") {
  await import("@testing-library/jest-dom/vitest");
  const { cleanup } = await import("@testing-library/react");
  const { afterEach, vi } = await import("vitest");
  afterEach(() => {
    cleanup();
  });

  // Bare /analysis is backed by a temporary guest workspace, which is a
  // server round trip. Component tests get a deterministic double so the
  // workspace opens as an empty editable analysis; suites that assert guest
  // behaviour replace this with their own doubles.
  vi.mock("@/lib/arc/persistence/guest.functions", async () => {
    const { createEmptyDraft } = await import("@/lib/asc606-workflow");
    return {
      resumeGuestWorkspace: async () => ({
        kind: "guest" as const,
        draft: createEmptyDraft(),
        lockVersion: 1,
        expiresAt: new Date(Date.now() + 9 * 3_600_000).toISOString(),
        schemaVersion: "arc.workflow.v1",
        resumed: false,
      }),
      saveGuestDraft: async () => ({
        ok: true as const,
        lockVersion: 2,
        savedAt: new Date().toISOString(),
      }),
      migrateGuestWorkspace: async () => ({ ok: false as const, reason: "not available in tests" }),
    };
  });
}

export {};
