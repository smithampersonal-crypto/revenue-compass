/**
 * Phase 9G — Task 8. The pure source-freshness presentation model.
 *
 * The server already owns the only source-freshness model there is: whether a
 * successful AI analysis exists, whether the selected source set still matches
 * the one that analysis used, and whether the accountant has acknowledged a
 * change. This module adds no second model. It is a total function of the safe
 * Task 3 DTO that decides what the accountant is told, nothing more:
 *
 *  - it never computes, compares or reveals a source-set fingerprint;
 *  - it never diffs documents;
 *  - it never acknowledges anything;
 *  - it never turns staleness into a finalization block.
 */

import type { AiWorkspaceStateDto } from "./workspace.handlers";

export type AiSourceFreshnessTone = "current" | "stale" | "acknowledged";

export interface AiSourceFreshnessPresentation {
  tone: AiSourceFreshnessTone;
  headline: string;
  /** Supporting copy, or `null` for the restrained current status. */
  body: string | null;
  /**
   * Whether the deliberate Task 2 acknowledgment is meaningful right now. It
   * requires an authoritative source-set fingerprint, because that fingerprint
   * is the server's precondition — never something the browser invents.
   */
  canAcknowledge: boolean;
}

const STALE_BODY =
  "The current AI-generated conclusions may reflect an earlier set of documents. Re-analyze the contract to update the AI analysis, or acknowledge the source change and continue with the current accounting work.";

const ACKNOWLEDGED_BODY =
  "The current AI analysis still reflects an earlier source set. Re-analyze the contract whenever you want ARC to evaluate the currently selected documents.";

export function sourceFreshnessPresentation(
  workspace: AiWorkspaceStateDto | null,
): AiSourceFreshnessPresentation | null {
  if (workspace === null) return null;
  // No tracked successful analysis: the Analyze Contract prerequisite flow
  // owns this state entirely. Nothing here is out of date.
  if (workspace.sourceState === "none" || !workspace.hasAnalysis) return null;

  if (workspace.sourceState === "current") {
    return {
      tone: "current",
      headline: "AI analysis matches the currently selected source documents.",
      body: null,
      canAcknowledge: false,
    };
  }

  // Stale. Acknowledgment never makes it current; it only records that the
  // accountant saw the change.
  if (workspace.staleSourceAcknowledged) {
    return {
      tone: "acknowledged",
      headline: "Source changes acknowledged.",
      body: ACKNOWLEDGED_BODY,
      canAcknowledge: false,
    };
  }

  return {
    tone: "stale",
    headline: "Source documents changed since the last AI analysis.",
    body: STALE_BODY,
    canAcknowledge: workspace.sourceSetFingerprint !== null,
  };
}
