import type { AiWorkspaceProgress } from "@/lib/arc/ai/workspace-client";

const FILL_WIDTH: Record<AiWorkspaceProgress["step"], string> = {
  1: "w-1/4",
  2: "w-1/2",
  3: "w-3/4",
  4: "w-full",
};

const DISPLAY_LABEL: Record<AiWorkspaceProgress["phase"], string> = {
  preparing: "Preparing Documents",
  analyzing: "Analyzing Contract",
  validating: "Validating Analysis",
  applying: "Updating Workspace",
};

export function AiAnalysisProgress({ progress }: { progress: AiWorkspaceProgress }) {
  const label = DISPLAY_LABEL[progress.phase];

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
        aria-hidden="true"
        className="h-2.5 w-full overflow-hidden rounded-sm border border-border bg-muted"
      >
        <div
          data-testid="ai-progress-fill"
          data-step={progress.step}
          className={`arc-ai-progress-fill h-full bg-primary ${FILL_WIDTH[progress.step]}`}
        />
      </div>
    </div>
  );
}
