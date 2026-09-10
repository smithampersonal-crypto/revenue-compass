/**
 * Phase 7C — pure save-status model for the persisted workspace.
 *
 * Presentation-only: it describes what the accountant is told about the state
 * of the saved copy. It carries no accounting meaning and never affects engine
 * output.
 */

export type SaveStatus =
  | { kind: "off" }
  | { kind: "loading" }
  | { kind: "read-only" }
  | { kind: "saved"; at: string | null }
  | { kind: "unsaved" }
  | { kind: "saving" }
  | { kind: "conflict" }
  | { kind: "error"; message: string };

export type SaveStatusTone = "neutral" | "pending" | "ok" | "warning";

export interface SaveStatusDescription {
  label: string;
  detail: string;
  tone: SaveStatusTone;
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
      };
    case "loading":
      return {
        label: "Loading",
        detail: "Opening the saved analysis.",
        tone: "pending",
      };
    case "read-only":
      return {
        label: "Read-only",
        detail: "This revision is finalized, so it cannot be edited.",
        tone: "neutral",
      };
    case "saved": {
      const time = formatTime(status.at);
      return {
        label: "Saved",
        detail: time ? `All changes saved at ${time}.` : "All changes saved.",
        tone: "ok",
      };
    }
    case "unsaved":
      return {
        label: "Unsaved changes",
        detail: "Your latest edits have not been saved yet.",
        tone: "pending",
      };
    case "saving":
      return { label: "Saving…", detail: "Saving your latest edits.", tone: "pending" };
    case "conflict":
      return {
        label: "Not saved — changed elsewhere",
        detail:
          "This analysis was changed in another session. Reload it before continuing so no work is overwritten.",
        tone: "warning",
      };
    case "error":
      return { label: "Not saved", detail: status.message, tone: "warning" };
  }
}

/** True while edits exist that the server has not accepted. */
export function hasPendingWork(status: SaveStatus): boolean {
  return status.kind === "unsaved" || status.kind === "saving";
}
