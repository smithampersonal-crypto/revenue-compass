// @vitest-environment jsdom
/**
 * Phase 9G — Task 9. Controller sequencing for evidence, guidance and restore.
 *
 * Evidence and guidance are ephemeral reads: per-target single flight, nothing
 * adopted into workspace state, nothing persisted. Restore is deliberate: the
 * accepted autosave is flushed first, the canonical draft is re-read from the
 * server, and the AI workspace is adopted from the authoritative result.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AiWorkspaceStateDto } from "@/lib/arc/ai/workspace.handlers";
import { AI_ANALYSIS_NOT_STARTED_UNSAVED } from "@/lib/arc/ai/workspace-client";
import { AI_RESTORE_CONFLICT } from "@/lib/arc/ai/restore.handlers";
import { AI_EVIDENCE_UNAVAILABLE } from "@/lib/arc/ai/review-evidence.handlers";

import { useAiWorkspaceController, type AiWorkspacePorts } from "./use-ai-workspace-controller";

const RUN = "11111111-1111-4111-8111-111111111111";

function state(overrides: Partial<AiWorkspaceStateDto> = {}): AiWorkspaceStateDto {
  return {
    hasAnalysis: true,
    activeRun: null,
    latestRun: null,
    lastSuccessfulRunId: RUN,
    sourceState: "current",
    hasIncludedSources: true,
    sourceSetFingerprint: "fp-current",
    reviewIssueCount: 0,
    reviewItems: [],
    assumptionItems: [],
    assumptionCount: 0,
    reviewPayloadMalformed: false,
    fieldProvenance: {},
    objectProvenance: {},
    staleSourceAcknowledged: false,
    allowance: { scope: "authenticated", limit: 10, used: 1, remaining: 9, resetAt: null },
    failure: null,
    restorableRun: { runId: RUN, completedAt: "2026-09-18T10:00:00.000Z" },
    ...overrides,
  };
}

const LINK = { url: "https://signed.example/doc", expiresInSeconds: 900, pageStart: 4, pageEnd: 5 };

function harness(overrides: Partial<Record<keyof AiWorkspacePorts, unknown>> = {}) {
  const calls: string[] = [];
  const box: { current: AiWorkspaceStateDto } = { current: state() };
  const spies = {
    getWorkspaceState: vi.fn(async () => {
      calls.push("read");
      return box.current;
    }),
    requestAnalysis: vi.fn(),
    executeAnalysis: vi.fn(),
    affirmReviewItem: vi.fn(),
    resolveReviewIssue: vi.fn(),
    acknowledgeStaleSources: vi.fn(),
    openReviewEvidence: vi.fn(async () => {
      calls.push("evidence");
      return LINK;
    }),
    getReviewGuidance: vi.fn(async () => {
      calls.push("guidance");
      return { cards: [] };
    }),
    restoreAnalysis: vi.fn(async () => {
      calls.push("restore");
      return {
        restoredRunId: RUN,
        workspace: state({ restorableRun: null, reviewIssueCount: 0, hasAnalysis: false }),
      };
    }),
    flushAutosave: vi.fn(async () => {
      calls.push("flush");
      return { ok: true };
    }),
    reloadCanonicalAnalysis: vi.fn(() => {
      calls.push("reload");
    }),
  };
  Object.assign(spies, overrides);
  return { ports: spies as unknown as AiWorkspacePorts, spies, calls, box };
}

function mount(h: ReturnType<typeof harness>) {
  return renderHook(() =>
    useAiWorkspaceController({
      scopeKey: "contract:rev-1",
      revisionId: "rev-1",
      ports: h.ports,
      pollIntervalMs: 2_000,
    }),
  );
}

async function ready(h: ReturnType<typeof harness>) {
  const hook = mount(h);
  await waitFor(() => expect(hook.result.current.loadState).toBe("ready"));
  return hook;
}

const EVIDENCE = {
  reviewItemId: "item-1",
  expectedReviewFingerprint: "fp-yellow",
  citationIndex: 1,
};

describe("Task 9A/9B ephemeral reads", () => {
  it("passes the scope revision and returns the link without touching workspace state", async () => {
    const h = harness();
    const { result } = await ready(h);
    const before = result.current.workspace;

    let link: unknown;
    await act(async () => {
      link = await result.current.openReviewEvidence(EVIDENCE);
    });

    expect(link).toEqual(LINK);
    expect(h.spies.openReviewEvidence).toHaveBeenCalledWith({ ...EVIDENCE, revisionId: "rev-1" });
    expect(result.current.workspace).toBe(before);
    expect(result.current.pendingEvidence.size).toBe(0);
  });

  it("allows only one request per citation, but not per item", async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const openReviewEvidence = vi.fn(async () => {
      await gate;
      return LINK;
    });
    const h = harness({ openReviewEvidence });
    const { result } = await ready(h);

    let first: Promise<unknown> | null = null;
    let duplicate: unknown;
    let sibling: Promise<unknown> | null = null;
    await act(async () => {
      first = result.current.openReviewEvidence(EVIDENCE);
      duplicate = await result.current.openReviewEvidence(EVIDENCE);
      sibling = result.current.openReviewEvidence({ ...EVIDENCE, citationIndex: 0 });
    });

    // The duplicate is refused outright; a different citation is not.
    expect(duplicate).toBeNull();
    expect(openReviewEvidence).toHaveBeenCalledTimes(2);
    expect(result.current.pendingEvidence.has("evidence:item-1:1")).toBe(true);

    await act(async () => {
      release?.();
      await first;
      await sibling;
    });
    expect(result.current.pendingEvidence.size).toBe(0);
  });

  it("reports a settled message and resolves null when the server refuses", async () => {
    const h = harness({
      openReviewEvidence: vi.fn(async () => {
        throw new Error(AI_EVIDENCE_UNAVAILABLE);
      }),
    });
    const { result } = await ready(h);

    let link: unknown = LINK;
    await act(async () => {
      link = await result.current.openReviewEvidence(EVIDENCE);
    });
    expect(link).toBeNull();
    expect(result.current.message).toBe(AI_EVIDENCE_UNAVAILABLE);
    expect(result.current.pendingEvidence.size).toBe(0);
  });

  it("keeps guidance single-flight per item", async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const getReviewGuidance = vi.fn(async () => {
      await gate;
      return { cards: [] };
    });
    const h = harness({ getReviewGuidance });
    const { result } = await ready(h);

    let first: Promise<unknown> | null = null;
    let duplicate: unknown;
    await act(async () => {
      first = result.current.getReviewGuidance({
        reviewItemId: "item-1",
        expectedReviewFingerprint: "fp-yellow",
      });
      duplicate = await result.current.getReviewGuidance({
        reviewItemId: "item-1",
        expectedReviewFingerprint: "fp-yellow",
      });
    });
    expect(duplicate).toBeNull();
    expect(getReviewGuidance).toHaveBeenCalledTimes(1);

    await act(async () => {
      release?.();
      await first;
    });
  });
});

describe("Task 9C restore sequencing", () => {
  it("flushes the accepted autosave, restores, then reloads the canonical draft", async () => {
    const h = harness();
    const { result } = await ready(h);

    await act(async () => {
      await result.current.restoreAnalysis({ expectedRunId: RUN });
    });

    expect(h.calls).toEqual(["read", "flush", "restore", "reload"]);
    expect(h.spies.restoreAnalysis).toHaveBeenCalledWith({
      revisionId: "rev-1",
      expectedRunId: RUN,
    });
    // The authoritative post-restore workspace is adopted from the result.
    expect(result.current.workspace?.restorableRun).toBeNull();
    expect(result.current.restoring).toBe(false);
  });

  it("never restores against an unsaved draft", async () => {
    const h = harness({ flushAutosave: vi.fn(async () => ({ ok: false })) });
    const { result } = await ready(h);

    await act(async () => {
      await result.current.restoreAnalysis({ expectedRunId: RUN });
    });

    expect(h.spies.restoreAnalysis).not.toHaveBeenCalled();
    expect(h.spies.reloadCanonicalAnalysis).not.toHaveBeenCalled();
    expect(result.current.message).toBe(AI_ANALYSIS_NOT_STARTED_UNSAVED);
  });

  it("confirms only once: a second call while restoring is refused", async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const restoreAnalysis = vi.fn(async () => {
      await gate;
      return { restoredRunId: RUN, workspace: state({ restorableRun: null }) };
    });
    const h = harness({ restoreAnalysis });
    const { result } = await ready(h);

    let first: Promise<void> | null = null;
    await act(async () => {
      first = result.current.restoreAnalysis({ expectedRunId: RUN });
      await Promise.resolve();
      await result.current.restoreAnalysis({ expectedRunId: RUN });
    });
    expect(restoreAnalysis).toHaveBeenCalledTimes(1);

    await act(async () => {
      release?.();
      await first;
    });
  });

  it("refuses to restore while an AI run is executing", async () => {
    const activeRun = {
      runId: RUN,
      phase: "analyzing" as const,
      active: true,
      sourceCount: 1,
      pageCount: 4,
      reviewIssueCount: 0,
      completedAt: null,
    };
    const h = harness();
    h.box.current = state({ activeRun, latestRun: activeRun, restorableRun: null });
    const { result } = await ready(h);

    await act(async () => {
      await result.current.restoreAnalysis({ expectedRunId: RUN });
    });
    expect(h.spies.flushAutosave).not.toHaveBeenCalled();
    expect(h.spies.restoreAnalysis).not.toHaveBeenCalled();
  });

  it("surfaces a settled message and re-reads when the server refuses the restore", async () => {
    const h = harness({
      restoreAnalysis: vi.fn(async () => {
        throw new Error(AI_RESTORE_CONFLICT);
      }),
    });
    const { result } = await ready(h);

    await act(async () => {
      await result.current.restoreAnalysis({ expectedRunId: RUN });
    });

    expect(h.spies.reloadCanonicalAnalysis).not.toHaveBeenCalled();
    expect(result.current.message).toBe(AI_RESTORE_CONFLICT);
    expect(h.spies.getWorkspaceState.mock.calls.length).toBeGreaterThan(1);
    expect(result.current.restoring).toBe(false);
  });
});
