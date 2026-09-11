/**
 * Phase 7D — pure presentation helpers for the revision lifecycle.
 *
 * No accounting meaning and no arithmetic: this module only describes the
 * Draft / Finalized / Superseded lifecycle to the accountant and decides when
 * the Finalize action may be offered.
 */

import type { SaveStatus } from "./save-status";
import type { RevisionStatus } from "./revisions.functions";

export interface RevisionStatusDescription {
  label: string;
  detail: string;
  tone: "pending" | "ok" | "neutral";
}

export function describeRevisionStatus(status: RevisionStatus): RevisionStatusDescription {
  switch (status) {
    case "draft":
      return {
        label: "Draft",
        detail: "Editable working revision. It is autosaved and can be finalized.",
        tone: "pending",
      };
    case "finalized":
      return {
        label: "Finalized",
        detail: "Immutable snapshot recorded from the saved inputs at the time it was finalized.",
        tone: "ok",
      };
    case "superseded":
      return {
        label: "Superseded",
        detail: "A later revision was finalized. This snapshot remains viewable as recorded.",
        tone: "neutral",
      };
  }
}

export type FinalizeGate = { canFinalize: true } | { canFinalize: false; reason: string };

/**
 * Finalization is offered only for a saved draft whose current in-memory work
 * is already on the server and whose ASC 606 analysis the engine considers
 * complete. The server re-checks all of this from the persisted draft.
 */
export function finalizeGate(input: {
  persistenceEnabled: boolean;
  status: SaveStatus;
  revisionStatus: RevisionStatus | null;
  engineFinalized: boolean;
  /** The whole workpaper — balances and journals included — is complete. */
  workpaperComplete: boolean;
  lockVersion: number | null;
  /** True while a finalization request is already in flight. */
  finalizing?: boolean;
}): FinalizeGate {
  if (input.finalizing) {
    return { canFinalize: false, reason: "This revision is being finalized." };
  }
  if (!input.persistenceEnabled) {
    return {
      canFinalize: false,
      reason: "Only a saved contract analysis can be finalized. Save this analysis first.",
    };
  }
  if (input.revisionStatus !== "draft") {
    return { canFinalize: false, reason: "This revision is already finalized." };
  }
  if (input.status.kind !== "saved" || input.lockVersion === null) {
    return {
      canFinalize: false,
      reason: "Finalization waits until every edit has been saved.",
    };
  }
  if (!input.engineFinalized) {
    return {
      canFinalize: false,
      reason: "The ASC 606 analysis still has outstanding items, so it cannot be finalized yet.",
    };
  }
  if (!input.workpaperComplete) {
    return {
      canFinalize: false,
      reason:
        "The Billing & Contract Balances workpaper and its journal entries must be complete and reconciled before this revision can be finalized.",
    };
  }
  return { canFinalize: true };
}
