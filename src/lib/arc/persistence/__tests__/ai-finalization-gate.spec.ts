/**
 * Phase 9F Task 13 — the AI finalization gate.
 *
 * Only two things block finalization: a run that can still apply a result, and
 * review items the accountant has not resolved. Staleness is a recommendation,
 * never a block, and a manual-only analysis behaves exactly as it did before.
 */
import { describe, expect, it, vi } from "vitest";

import { createDemoDraftIfKnown } from "@/lib/demo-scenarios";

import {
  aiFinalizationIssues,
  finalizeRevisionHandler,
  type AiFinalizationState,
  type RevisionReader,
} from "../revisions.handlers";
import { toCanonicalInputs, ARC_WORKFLOW_SCHEMA_VERSION } from "../schema";

const REVISION_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "55555555-5555-4555-8555-555555555555";
const CANONICAL = toCanonicalInputs(createDemoDraftIfKnown("horizon")!);

function reader(): RevisionReader {
  return {
    readLifecycleRevision: async () => ({
      data: { id: REVISION_ID, status: "draft", lock_version: 3, supersedes_revision_id: null },
      error: null,
    }),
    readRevisionForFinalization: async () => ({
      data: {
        id: REVISION_ID,
        status: "draft",
        lock_version: 3,
        canonical_inputs: CANONICAL,
        schema_version: ARC_WORKFLOW_SCHEMA_VERSION,
      },
      error: null,
    }),
    readSourceRevision: async () => ({
      data: {
        canonical_inputs: CANONICAL,
        schema_version: ARC_WORKFLOW_SCHEMA_VERSION,
        status: "finalized",
      },
      error: null,
    }),
  };
}

function item(state: string, extra: Record<string, unknown> = {}) {
  return {
    state,
    targetKey: "po:po-1:sspInput",
    ...extra,
  } as AiFinalizationState["reviewItems"][0];
}

async function finalize(
  state: AiFinalizationState | null,
  rpc = vi.fn(async () => ({ data: null, error: null })),
) {
  const outcome = await finalizeRevisionHandler(
    {
      reader: reader(),
      userId: USER_ID,
      finalizeTransaction: rpc,
      readAiFinalizationState: async () => state,
    },
    { revisionId: REVISION_ID, expectedLockVersion: 3 },
  );
  return { outcome, rpc };
}

describe("AI finalization gate", () => {
  it("leaves manual-only finalization unchanged when there is no AI sidecar", async () => {
    const { outcome, rpc } = await finalize(null);
    expect(outcome).toEqual({ ok: true, revisionId: REVISION_ID });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("leaves finalization unchanged when the gate is not wired at all", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const outcome = await finalizeRevisionHandler(
      { reader: reader(), userId: USER_ID, finalizeTransaction: rpc },
      { revisionId: REVISION_ID, expectedLockVersion: 3 },
    );
    expect(outcome).toEqual({ ok: true, revisionId: REVISION_ID });
  });

  it("allows finalization when every AI review item is resolved", async () => {
    const { outcome } = await finalize({
      reviewItems: [item("resolved"), item("resolved")],
      hasActiveRun: false,
    });
    expect(outcome).toEqual({ ok: true, revisionId: REVISION_ID });
  });

  it("blocks finalization on an unresolved yellow item", async () => {
    const { outcome, rpc } = await finalize({
      reviewItems: [item("resolved"), item("yellow", { reason: "Confirm the SSP basis." })],
      hasActiveRun: false,
    });
    expect(outcome).toEqual({
      ok: false,
      reason: "blocked",
      issues: ["Confirm the SSP basis."],
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("blocks finalization on an unresolved red item", async () => {
    const { outcome, rpc } = await finalize({
      reviewItems: [item("red", { reason: "The recognition method is not supported." })],
      hasActiveRun: false,
    });
    expect(outcome).toMatchObject({ ok: false, reason: "blocked" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("blocks finalization while a run can still apply a result", async () => {
    const { outcome, rpc } = await finalize({ reviewItems: [], hasActiveRun: true });
    expect(outcome).toMatchObject({ ok: false, reason: "blocked" });
    expect((outcome as { issues: string[] }).issues[0]).toMatch(/still running/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does not block solely because the source set is stale", async () => {
    // Staleness is not part of the gate's inputs at all: resolved review items
    // and no active run finalize normally.
    const { outcome } = await finalize({ reviewItems: [item("resolved")], hasActiveRun: false });
    expect(outcome).toEqual({ ok: true, revisionId: REVISION_ID });
  });

  it("derives issues purely from review state and active runs", () => {
    expect(aiFinalizationIssues(null)).toEqual([]);
    expect(aiFinalizationIssues({ reviewItems: [item("resolved")], hasActiveRun: false })).toEqual(
      [],
    );
    expect(
      aiFinalizationIssues({ reviewItems: [item("yellow")], hasActiveRun: false }),
    ).toHaveLength(1);
    // An active run outranks everything else and reports one clear reason.
    expect(aiFinalizationIssues({ reviewItems: [item("red")], hasActiveRun: true })).toHaveLength(
      1,
    );
  });
});
