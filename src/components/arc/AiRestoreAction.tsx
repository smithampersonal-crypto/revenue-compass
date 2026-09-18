/**
 * Phase 9G — Task 9C. Explicit whole-run restore.
 *
 * The offer itself is server-declared: this component never decides whether a
 * restore is possible, never lists run history and never restores anything
 * automatically. It shows exactly the one run the server says is restorable,
 * states plainly what the accountant is about to lose, and asks once.
 */

import { useState } from "react";
import { History } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { AiWorkspaceController } from "@/hooks/use-ai-workspace-controller";

function completedLabel(completedAt: string | null): string {
  if (completedAt === null) return "the last AI analysis";
  const parsed = new Date(completedAt);
  return Number.isNaN(parsed.getTime()) ? completedAt : parsed.toLocaleString();
}

export function AiRestoreAction({ ai }: { ai: AiWorkspaceController }) {
  const [open, setOpen] = useState(false);
  const restorable = ai.workspace?.restorableRun ?? null;
  // No offer means no action at all — not a disabled one. Eligibility is a
  // server conclusion, so there is nothing for the browser to explain away.
  if (!restorable) return null;

  const busy = ai.restoring || ai.active || ai.actionState !== "idle";

  return (
    <div role="region" aria-label="Undo AI analysis">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy}
        aria-busy={ai.restoring}
        onClick={() => setOpen(true)}
      >
        <History className="size-4" aria-hidden="true" />
        Undo AI analysis from {completedLabel(restorable.completedAt)}
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Undo this AI analysis?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  Your entire current analysis will be replaced by the exact version saved just
                  before this AI analysis ran. Every change you made after that run will be lost.
                </p>
                <p>
                  Your selected source documents and analysis history will not change. AI usage
                  already consumed by the analysis will not be refunded.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={ai.restoring}>Keep current version</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                void ai.restoreAnalysis({ expectedRunId: restorable.runId }).then(() => {
                  setOpen(false);
                });
              }}
            >
              Undo AI analysis
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
