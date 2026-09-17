import { Check, Circle } from "lucide-react";

import type { AiWorkspaceProgress } from "@/lib/arc/ai/workspace-client";

const STEPS = [
  "Preparing documents",
  "Analyzing contract",
  "Validating analysis",
  "Updating workspace",
] as const;

export function AiAnalysisProgress({ progress }: { progress: AiWorkspaceProgress }) {
  return (
    <div
      role="status"
      aria-label="AI analysis progress"
      aria-live="polite"
      className="border-t border-border pt-3"
    >
      <p className="mb-3 text-sm font-medium text-foreground">
        Step {progress.step} of 4: {progress.label}
      </p>
      <ol className="grid gap-2 sm:grid-cols-4" aria-label="Analysis steps">
        {STEPS.map((label, index) => {
          const step = index + 1;
          const complete = step < progress.step;
          const current = step === progress.step;
          return (
            <li
              key={label}
              aria-current={current ? "step" : undefined}
              className={`flex min-w-0 items-start gap-2 rounded-md border px-3 py-2 text-xs ${
                current
                  ? "border-primary/50 bg-primary/10 text-foreground"
                  : complete
                    ? "border-border bg-muted/60 text-foreground"
                    : "border-border/70 text-muted-foreground"
              }`}
            >
              {complete ? (
                <Check className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" />
              ) : (
                <Circle
                  className={`mt-0.5 size-3.5 shrink-0 ${current ? "fill-primary text-primary" : ""}`}
                  aria-hidden="true"
                />
              )}
              <span className="min-w-0">
                <span className="block font-medium">{label}</span>
                <span className="mt-0.5 block text-muted-foreground">
                  {complete ? "Complete" : current ? "Current" : "Pending"}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
