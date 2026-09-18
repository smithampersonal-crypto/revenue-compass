/**
 * Phase 9G — Task 8. The pure source-freshness presentation model.
 *
 * Everything here is a total function of the safe Task 3 DTO. It decides only
 * what the accountant is told; it never decides freshness itself, never
 * computes or compares a fingerprint, and never acknowledges anything.
 */
import { describe, expect, it } from "vitest";

import { sourceFreshnessPresentation } from "../source-freshness";
import type { AiWorkspaceStateDto } from "../workspace.handlers";

const base: AiWorkspaceStateDto = {
  hasAnalysis: true,
  activeRun: null,
  latestRun: null,
  lastSuccessfulRunId: "run-1",
  sourceState: "current",
  hasIncludedSources: true,
  sourceSetFingerprint: "fingerprint-abc",
  reviewIssueCount: 0,
  reviewItems: [],
  reviewPayloadMalformed: false,
  fieldProvenance: {},
  objectProvenance: {},
  staleSourceAcknowledged: false,
  allowance: { scope: "authenticated", limit: 10, used: 1, remaining: 9, resetAt: null },
  failure: null,
};

describe("Phase 9G Task 8 — source freshness presentation", () => {
  it("says nothing without a workspace", () => {
    expect(sourceFreshnessPresentation(null)).toBeNull();
  });

  it("says nothing when no successful analysis is tracked", () => {
    expect(
      sourceFreshnessPresentation({ ...base, hasAnalysis: false, sourceState: "none" }),
    ).toBeNull();
  });

  it("shows a restrained current status, never a warning", () => {
    const presentation = sourceFreshnessPresentation(base);
    expect(presentation).not.toBeNull();
    expect(presentation?.tone).toBe("current");
    expect(presentation?.canAcknowledge).toBe(false);
    expect(presentation?.headline).toBe(
      "AI analysis matches the currently selected source documents.",
    );
    expect(presentation?.body).toBeNull();
  });

  it("warns and offers acknowledgment when stale and unacknowledged", () => {
    const presentation = sourceFreshnessPresentation({
      ...base,
      sourceState: "stale",
      staleSourceAcknowledged: false,
    });
    expect(presentation?.tone).toBe("stale");
    expect(presentation?.canAcknowledge).toBe(true);
    expect(presentation?.headline).toBe("Source documents changed since the last AI analysis.");
    expect(presentation?.body).toContain("may reflect an earlier set of documents");
  });

  it("stays explicitly stale after acknowledgment and offers no second acknowledgment", () => {
    const presentation = sourceFreshnessPresentation({
      ...base,
      sourceState: "stale",
      staleSourceAcknowledged: true,
    });
    expect(presentation?.tone).toBe("acknowledged");
    expect(presentation?.canAcknowledge).toBe(false);
    expect(presentation?.headline).toBe("Source changes acknowledged.");
    expect(presentation?.body).toContain("still reflects an earlier source set");
  });

  it("keeps the stale notice when every source document has been removed", () => {
    const presentation = sourceFreshnessPresentation({
      ...base,
      sourceState: "stale",
      hasIncludedSources: false,
    });
    expect(presentation?.tone).toBe("stale");
    expect(presentation?.canAcknowledge).toBe(true);
  });

  it("cannot acknowledge without an authoritative source-set fingerprint", () => {
    const presentation = sourceFreshnessPresentation({
      ...base,
      sourceState: "stale",
      sourceSetFingerprint: null,
    });
    expect(presentation?.tone).toBe("stale");
    expect(presentation?.canAcknowledge).toBe(false);
  });

  it("never carries the source-set fingerprint into presentation copy", () => {
    const presentation = sourceFreshnessPresentation({ ...base, sourceState: "stale" });
    expect(JSON.stringify(presentation)).not.toContain("fingerprint-abc");
  });
});
