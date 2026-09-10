import { describeSaveStatus } from "@/lib/arc/persistence/save-status";

import { useAnalysis } from "./analysis-context";

const TONE_CLASS = {
  neutral: "border-border bg-muted/40 text-muted-foreground",
  pending: "border-border bg-muted/40 text-foreground",
  ok: "border-border bg-muted/40 text-foreground",
  warning: "border-destructive/50 bg-destructive/10 text-foreground",
} as const;

/**
 * Presentation-only save indicator for a saved (owned) analysis. It reports
 * what the server has accepted; it never implies an accounting conclusion.
 */
export function SaveStatusIndicator() {
  const { persistence } = useAnalysis();
  if (!persistence.enabled) return null;

  const description = describeSaveStatus(persistence.status);
  const showReload =
    persistence.status.kind === "conflict" || persistence.status.kind === "error";

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-sm ${TONE_CLASS[description.tone]}`}
    >
      <span className="font-medium">{description.label}</span>
      <span className="text-muted-foreground">{description.detail}</span>
      {showReload ? (
        <button
          type="button"
          onClick={persistence.reload}
          className="min-h-8 rounded-md border border-border px-2 text-sm font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          Reload saved analysis
        </button>
      ) : null}
    </div>
  );
}
