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
  // Phase 9G — Task 5. The analysis workspace reads the safe AI workspace
  // state once it has an editable server-backed analysis. Component tests get
  // an inert double: no analysis, no active run, nothing to poll. Suites that
  // assert AI behaviour replace it with their own doubles.
  vi.mock("@/lib/arc/ai/workspace.functions", () => {
    const idle = async () => ({
      hasAnalysis: false,
      activeRun: null,
      latestRun: null,
      lastSuccessfulRunId: null,
      sourceState: "none" as const,
      hasIncludedSources: true,
      sourceSetFingerprint: null,
      reviewIssueCount: 0,
      staleSourceAcknowledged: false,
      allowance: {
        scope: "authenticated" as const,
        limit: 10,
        used: 0,
        remaining: 10,
        resetAt: null,
      },
      failure: null,
    });
    return {
      getAiWorkspaceState: idle,
      requestAiAnalysis: async () => ({
        ...(await idle()),
        executionDisposition: "start_execution" as const,
      }),
      affirmAiReviewItem: idle,
      resolveAiReviewIssue: idle,
      acknowledgeAiStaleSources: idle,
    };
  });

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
      migrateGuestWorkspace: async () => ({
        ok: false as const,
        code: "failed" as const,
        reason: "not available in tests",
      }),
    };
  });
}

export {};
