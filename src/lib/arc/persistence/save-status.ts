/**
 * Phase 7C — pure save-status model for the persisted workspace.
 *
 * Presentation-only: it describes what the accountant is told about the state
 * of the saved copy. It carries no accounting meaning and never affects engine
 * output.
 *
 * An ordinary save failure and an optimistic-lock conflict are deliberately
 * distinct states with distinct recovery actions: a failed save is retried, a
 * conflict must be reloaded.
 */

export type SaveStatus =
  | { kind: "off" }
  | { kind: "loading" }
  | { kind: "load-error"; message: string }
  | { kind: "read-only" }
  | { kind: "saved"; at: string | null }
  | { kind: "unsaved" }
  | { kind: "saving" }
  | { kind: "conflict" }
  /** Phase 7E: the 9-hour temporary guest workspace is no longer authorized. */
  | { kind: "guest-expired" }
  | { kind: "error"; message: string };

export type SaveStatusTone = "neutral" | "pending" | "ok" | "warning";

/** The single recovery action offered for the current status, if any. */
export type SaveStatusAction = "none" | "retry" | "reload";

export interface SaveStatusDescription {
  label: string;
  detail: string;
  tone: SaveStatusTone;
  action: SaveStatusAction;
}

function formatTime(at: string | null): string {
  if (!at) return "";
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Maps a save status onto accountant-facing wording. */
export function describeSaveStatus(status: SaveStatus): SaveStatusDescription {
  switch (status.kind) {
    case "off":
      return {
        label: "Not saved",
        detail: "This analysis is in memory only. Refreshing the page clears it.",
        tone: "neutral",
        action: "none",
      };
    case "loading":
      return {
        label: "Loading",
        detail: "Opening the saved analysis.",
        tone: "pending",
        action: "none",
      };
    case "load-error":
      return {
        label: "Could not open",
        detail: status.message,
        tone: "warning",
        action: "reload",
      };
    case "read-only":
      return {
        label: "Read-only",
        detail: "This revision is finalized, so it cannot be edited.",
        tone: "neutral",
        action: "none",
      };
    case "saved": {
      const time = formatTime(status.at);
      return {
        label: "Saved",
        detail: time ? `All changes saved at ${time}.` : "All changes saved.",
        tone: "ok",
        action: "none",
      };
    }
    case "unsaved":
      return {
        label: "Unsaved changes",
        detail: "Your latest edits have not been saved yet.",
        tone: "pending",
        action: "none",
      };
    case "saving":
      return {
        label: "Saving…",
        detail: "Saving your latest edits.",
        tone: "pending",
        action: "none",
      };
    case "conflict":
      return {
        label: "A newer saved version exists",
        detail:
          "This analysis was changed in another session, so saving has stopped. Your edits here are kept in the browser. Reload the saved version before continuing so no work is overwritten.",
        tone: "warning",
        action: "reload",
      };
    case "error":
      return {
        label: "Save failed",
        detail: `${status.message} Your edits are still here — you can try saving again.`,
        tone: "warning",
        action: "retry",
      };
  }
}

/**
 * True while edits exist that the server has not accepted, including failed
 * and conflicted saves. Only `saved` and the non-persisted states are safe.
 */
export function hasPendingWork(status: SaveStatus): boolean {
  return (
    status.kind === "unsaved" ||
    status.kind === "saving" ||
    status.kind === "error" ||
    status.kind === "conflict"
  );
}

/** True only when the server holds exactly what the browser is showing. */
export function isSafelyPersisted(status: SaveStatus): boolean {
  return status.kind === "saved" || status.kind === "read-only";
}
