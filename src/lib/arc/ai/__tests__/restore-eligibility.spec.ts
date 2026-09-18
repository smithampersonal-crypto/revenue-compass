/**
 * Phase 9G — Task 9C. The pure restore-eligibility model.
 *
 * Restore is only ever offered for the one current, successful, not-yet-undone
 * run of an editable scope whose source identity has not moved and whose
 * pre-run sidecar was captured exactly. Every other shape is silence.
 */

import { describe, expect, it } from "vitest";

import {
  AI_PRE_RUN_ACKNOWLEDGMENT_KEYS,
  classifyPreRunSnapshot,
  restorableRunOf,
  type AiRestoreCandidate,
  type AiRestoreEligibilityInput,
} from "../restore-eligibility";

const FINGERPRINT = "a".repeat(64);

function candidate(overrides: Partial<AiRestoreCandidate> = {}): AiRestoreCandidate {
  return {
    runId: "run-1",
    stage: "succeeded",
    completedAt: "2026-09-18T10:00:00.000Z",
    restoredAt: null,
    sourceSetFingerprint: FINGERPRINT,
    preRunSnapshot: "exact",
    belongsToScope: true,
    ...overrides,
  };
}

function input(overrides: Partial<AiRestoreEligibilityInput> = {}): AiRestoreEligibilityInput {
  return {
    editable: true,
    activeRun: false,
    lastSuccessfulRunId: "run-1",
    currentSourceSetFingerprint: FINGERPRINT,
    candidate: candidate(),
    ...overrides,
  };
}

describe("restorableRunOf", () => {
  it("offers exactly the run id and completion time, and nothing else", () => {
    expect(restorableRunOf(input())).toEqual({
      runId: "run-1",
      completedAt: "2026-09-18T10:00:00.000Z",
    });
  });

  it("offers an absent pre-run sidecar, which restores by deletion", () => {
    expect(restorableRunOf(input({ candidate: candidate({ preRunSnapshot: "absent" }) }))).not.toBeNull();
  });

  it("never offers a restore the server cannot make exact", () => {
    const refusals: Array<[string, Partial<AiRestoreEligibilityInput>]> = [
      ["a read-only or foreign scope", { editable: false }],
      ["an executing run", { activeRun: true }],
      ["no successful run at all", { lastSuccessfulRunId: null, candidate: null }],
      ["a run that cannot be loaded", { candidate: null }],
      ["a run belonging to another scope", { candidate: candidate({ belongsToScope: false }) }],
      ["a run that did not succeed", { candidate: candidate({ stage: "api_failed" }) }],
      ["a run already undone", { candidate: candidate({ restoredAt: "2026-09-18T11:00:00.000Z" }) }],
      ["an older run than the current one", { lastSuccessfulRunId: "run-2" }],
      ["an unknown current source set", { currentSourceSetFingerprint: null }],
      ["a source set that has since moved", { currentSourceSetFingerprint: "b".repeat(64) }],
      ["a legacy snapshot", { candidate: candidate({ preRunSnapshot: "incomplete" }) }],
    ];
    for (const [reason, overrides] of refusals) {
      expect(restorableRunOf(input(overrides)), reason).toBeNull();
    }
  });
});

describe("classifyPreRunSnapshot", () => {
  it("treats no recorded sidecar as an exact absence", () => {
    expect(classifyPreRunSnapshot(null)).toBe("absent");
    expect(classifyPreRunSnapshot(undefined)).toBe("absent");
  });

  it("requires all three acknowledgment keys, but accepts null values", () => {
    const exact = Object.fromEntries(AI_PRE_RUN_ACKNOWLEDGMENT_KEYS.map((key) => [key, null]));
    expect(classifyPreRunSnapshot({ ...exact, review_items: [] })).toBe("exact");
  });

  it("classifies a snapshot missing any acknowledgment key as legacy", () => {
    for (const missing of AI_PRE_RUN_ACKNOWLEDGMENT_KEYS) {
      const row = Object.fromEntries(
        AI_PRE_RUN_ACKNOWLEDGMENT_KEYS.filter((key) => key !== missing).map((key) => [key, null]),
      );
      expect(classifyPreRunSnapshot(row), missing).toBe("incomplete");
    }
  });

  it("never repairs a non-object snapshot", () => {
    expect(classifyPreRunSnapshot([])).toBe("incomplete");
    expect(classifyPreRunSnapshot("{}")).toBe("incomplete");
    expect(classifyPreRunSnapshot(7)).toBe("incomplete");
  });
});
