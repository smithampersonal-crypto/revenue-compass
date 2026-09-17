import { AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { AiWorkspaceController } from "@/hooks/use-ai-workspace-controller";
import type { AiFailurePresentation } from "@/lib/arc/ai/failure-presentation";

export function AiAnalysisNotice({
  failure,
  message,
  retry,
}: {
  failure: AiFailurePresentation | null;
  message: string | null;
  retry: (() => Promise<void>) | null;
}) {
  if (!failure && !message) return null;

  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning-foreground"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 space-y-2">
        {failure ? (
          <>
            <p className="font-semibold text-foreground">{failure.headline}</p>
            <p>{failure.whatHappened}</p>
            <p>{failure.impact}</p>
            <p>{failure.whatYouCanDo}</p>
            <p className="text-xs">{failure.allowance}</p>
          </>
        ) : (
          <p>{message}</p>
        )}
        {retry ? (
          <Button type="button" size="sm" variant="outline" onClick={() => void retry()}>
            Retry AI status
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function workspaceFailureOf(ai: AiWorkspaceController): AiFailurePresentation | null {
  return ai.workspace?.failure ?? null;
}
