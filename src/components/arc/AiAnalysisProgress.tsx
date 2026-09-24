import type { AiWorkspaceProgress } from "@/lib/arc/ai/workspace-client";

const PRESENTATION_CHECKPOINTS: Record<AiWorkspaceProgress["step"], 0 | 12 | 82 | 92> = {
  1: 0,
  2: 12,
  3: 82,
  4: 92,
};

const DISPLAY_LABEL: Record<AiWorkspaceProgress["phase"], string> = {
  preparing: "Preparing Documents",
  analyzing: "Analyzing Contract",
  validating: "Validating Analysis",
  applying: "Updating Workspace",
};

export function AiAnalysisProgress({ progress }: { progress: AiWorkspaceProgress }) {
  const label = DISPLAY_LABEL[progress.phase];
  const confirmedEnd = PRESENTATION_CHECKPOINTS[progress.step];

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
        data-confirmed-end={confirmedEnd}
        aria-hidden="true"
        className="arc-ai-progress-track h-2.5 w-full overflow-hidden rounded-sm border border-border bg-muted"
      >
        <div
          data-testid="ai-progress-confirmed"
          className="arc-ai-progress-confirmed absolute inset-y-0 left-0 bg-primary"
        />
        <div
          data-testid="ai-progress-activity"
          className="arc-ai-progress-activity absolute inset-0 overflow-hidden"
        />
      </div>
    </div>
  );
}
