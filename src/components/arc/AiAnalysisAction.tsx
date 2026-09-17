import { FileSearch } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { AiWorkspaceController } from "@/hooks/use-ai-workspace-controller";

import { AiAnalysisNotice, workspaceFailureOf } from "./AiAnalysisNotice";
import { AiAnalysisProgress } from "./AiAnalysisProgress";

function actionLabel(ai: AiWorkspaceController): string {
  if (ai.loadState === "loading") return "Loading AI analysis…";
  if (ai.actionState === "requesting") return "Preparing analysis…";
  if (ai.active && ai.progress) return `${ai.progress.label}…`;
  return ai.analyzeMode === "reanalyze" ? "Re-analyze Contract" : "Analyze Contract";
}

export function AiAnalysisAction({
  ai,
  onAddSources,
}: {
  ai: AiWorkspaceController;
  /** Opens the existing Source Documents upload experience for this analysis. */
  onAddSources?: (() => void) | undefined;
}) {
  if (ai.loadState === "idle") return null;

  const workspace = ai.workspace;
  const loading = ai.loadState === "loading";
  const loadError = ai.loadState === "error";
  const noAllowance = workspace !== null && workspace.allowance.remaining <= 0;
  // Source presence is the authoritative server fact, never `sourceState`,
  // which describes AI/source freshness only.
  const needsSource = workspace !== null && !workspace.hasIncludedSources;
  const disabled = loading || loadError || ai.locks.analyze || noAllowance;
  const failure = workspaceFailureOf(ai);
  const controllerMessage = failure ? null : ai.message;

  return (
    <section
      aria-label="AI contract analysis"
      className="space-y-3 rounded-lg border border-border bg-card p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <FileSearch className="size-4 text-primary" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-foreground">Contract analysis</h2>
          </div>
          {workspace ? (
            <p className="text-xs text-muted-foreground">
              {workspace.allowance.remaining} of {workspace.allowance.limit} analyses remaining
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">Loading current AI analysis status…</p>
          )}
        </div>
        <Button
          type="button"
          className="min-h-11"
          disabled={disabled}
          onClick={() => {
            // With no contract included, this deliberate click opens the
            // existing upload experience: no run is requested, no allowance is
            // used, and nothing about the analysis changes.
            if (needsSource) {
              onAddSources?.();
              return;
            }
            void ai.analyze();
          }}
        >
          {actionLabel(ai)}
        </Button>
      </div>

      {noAllowance ? (
        <p className="text-sm text-muted-foreground">AI analysis limit reached.</p>
      ) : null}
      {needsSource && !noAllowance ? (
        <p className="text-sm text-muted-foreground">
          No contract PDF is included yet. Analyze Contract will take you to the upload step first.
        </p>
      ) : null}
      {ai.active && ai.progress ? <AiAnalysisProgress progress={ai.progress} /> : null}
      <AiAnalysisNotice
        failure={failure}
        message={controllerMessage}
        retry={loadError ? ai.refresh : null}
      />
    </section>
  );
}
