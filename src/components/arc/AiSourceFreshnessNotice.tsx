/**
 * Phase 9G — Task 8. Workspace-level AI source-freshness presentation.
 *
 * Rendered once at the analysis workspace level, so the same authoritative
 * state is visible on every analysis area without five competing copies of the
 * logic. It consumes only the Task 5 controller: no Supabase access, no
 * fingerprint arithmetic, no source mutation, and never an automatic AI run.
 */

import { useRef, useState } from "react";
import { CheckCircle2, FileClock } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { AiWorkspaceController } from "@/hooks/use-ai-workspace-controller";
import { sourceFreshnessPresentation } from "@/lib/arc/ai/source-freshness";

const ACKNOWLEDGE_HELP =
  "Acknowledging records that you reviewed the source change. It does not update the AI analysis.";

const LOCKED_HELP = "Source acknowledgment is available after the current analysis finishes.";

export function AiSourceFreshnessNotice({ ai }: { ai: AiWorkspaceController }) {
  const presentation = sourceFreshnessPresentation(ai.workspace);
  // Presentation-only single-flight. Claimed synchronously so two rapid clicks
  // can never become two controller requests; the authoritative response — not
  // this flag — decides what the notice says.
  const pendingRef = useRef(false);
  const [acknowledging, setAcknowledging] = useState(false);

  if (presentation === null) return null;

  if (presentation.tone === "current") {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <CheckCircle2 className="size-3.5 shrink-0" aria-hidden="true" />
        {presentation.headline}
      </p>
    );
  }

  const stale = presentation.tone === "stale";
  const locked = ai.locks.reviewActions;

  const acknowledge = async () => {
    if (pendingRef.current || locked) return;
    pendingRef.current = true;
    setAcknowledging(true);
    try {
      await ai.acknowledgeStaleSources();
    } finally {
      pendingRef.current = false;
      setAcknowledging(false);
    }
  };

  return (
    <section
      aria-label="AI source freshness"
      className={
        stale
          ? "space-y-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-foreground"
          : "space-y-2 rounded-md border border-border bg-muted/40 p-3 text-sm text-foreground"
      }
    >
      <div className="flex items-start gap-3">
        <FileClock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 space-y-2">
          <p className="font-semibold">{presentation.headline}</p>
          {presentation.body ? <p className="text-muted-foreground">{presentation.body}</p> : null}
          {presentation.canAcknowledge ? (
            <>
              <p id="ai-source-acknowledge-help" className="text-xs text-muted-foreground">
                {ACKNOWLEDGE_HELP}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={locked || acknowledging}
                aria-busy={acknowledging}
                aria-describedby="ai-source-acknowledge-help"
                onClick={() => {
                  void acknowledge();
                }}
              >
                Acknowledge source changes
              </Button>
              {locked ? <p className="text-xs text-muted-foreground">{LOCKED_HELP}</p> : null}
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
