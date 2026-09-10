import { describeSaveStatus } from "@/lib/arc/persistence/save-status";

import { useAnalysis } from "./analysis-context";

const TONE_CLASS = {
  neutral: "border-border bg-muted/40 text-muted-foreground",
  pending: "border-border bg-muted/40 text-foreground",
  ok: "border-border bg-muted/40 text-foreground",
  warning: "border-destructive/50 bg-destructive/10 text-foreground",
} as const;

const ACTION_CLASS =
  "min-h-8 rounded-md border border-border px-2 text-sm font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Presentation-only save indicator for a saved (owned) analysis. It reports
 * what the server has accepted; it never implies an accounting conclusion.
 *
 * An ordinary failed save offers Retry save; only an optimistic-lock conflict
 * or a failed load offers Reload saved version.
 */
export function SaveStatusIndicator() {
  const { persistence } = useAnalysis();
  if (!persistence.enabled) return null;

  const description = describeSaveStatus(persistence.status);

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-sm ${TONE_CLASS[description.tone]}`}
    >
      <span className="font-medium">{description.label}</span>
      <span className="text-muted-foreground">{description.detail}</span>
      {description.action === "retry" ? (
        <button type="button" onClick={persistence.retrySave} className={ACTION_CLASS}>
          Retry save
        </button>
      ) : null}
      {description.action === "reload" ? (
        <button type="button" onClick={persistence.reload} className={ACTION_CLASS}>
          Reload saved version
        </button>
      ) : null}
    </div>
  );
}
