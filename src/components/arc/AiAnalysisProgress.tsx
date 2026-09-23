import type { AiWorkspaceProgress } from "@/lib/arc/ai/workspace-client";

const PRESENTATION_CHECKPOINTS: Record<
  AiWorkspaceProgress["step"],
  { confirmedEnd: 0 | 12 | 82 | 92; activityStart: 0 | 12 | 82 | 92; activityEnd: 12 | 82 | 92 | 100 }
> = {
  1: { confirmedEnd: 0, activityStart: 0, activityEnd: 12 },
  2: { confirmedEnd: 12, activityStart: 12, activityEnd: 82 },
  3: { confirmedEnd: 82, activityStart: 82, activityEnd: 92 },
  4: { confirmedEnd: 92, activityStart: 92, activityEnd: 100 },
};

const DISPLAY_LABEL: Record<AiWorkspaceProgress["phase"], string> = {
  preparing: "Preparing Documents",
  analyzing: "Analyzing Contract",
  validating: "Validating Analysis",
  applying: "Updating Workspace",
};

export function AiAnalysisProgress({ progress }: { progress: AiWorkspaceProgress }) {
  const label = DISPLAY_LABEL[progress.phase];
  const checkpoint = PRESENTATION_CHECKPOINTS[progress.step];

  return (
    <div
      role="status"
      aria-label="AI analysis progress"
      aria-live="polite"
      data-phase={progress.phase}
      data-step={progress.step}
      className="space-y-2 border-t border-border pt-3"
    >
      <p className="text-sm font-medium text-foreground">
        {label} · Step {progress.step} of 4
      </p>
      <div
        data-testid="ai-progress-track"
        data-step={progress.step}
        data-confirmed-end={checkpoint.confirmedEnd}
        data-activity-start={checkpoint.activityStart}
        data-activity-end={checkpoint.activityEnd}
        aria-hidden="true"
        className="arc-ai-progress-track h-2.5 w-full overflow-hidden rounded-sm border border-border bg-muted"
      >
        <div
          data-testid="ai-progress-confirmed"
          className="arc-ai-progress-confirmed absolute inset-y-0 left-0 bg-primary"
        />
        <div
          data-testid="ai-progress-activity"
          className="arc-ai-progress-activity absolute inset-y-0 overflow-hidden"
        />
      </div>
    </div>
  );
}
