import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

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
import { startNewRevision } from "@/lib/arc/persistence/revisions.functions";

/**
 * The single, reusable "Create new revision" affordance.
 *
 * It owns no revision logic: the existing `startNewRevision` server function
 * and its trusted database transaction remain authoritative for ownership,
 * concurrency, source-revision validity and the one-active-draft rule. This
 * component only confirms intent and opens whatever revision the server
 * returns — a newly created draft, or the draft that already existed.
 */
export function CreateRevisionAction({
  contractId,
  sourceRevisionId,
  sourceRevisionNumber,
  nextRevisionNumber,
  className,
  onOutcome,
}: {
  contractId: string;
  /** Must be the analysis's current finalized revision. */
  sourceRevisionId: string;
  sourceRevisionNumber: number;
  nextRevisionNumber: number;
  className?: string;
  onOutcome?: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const createRevision = useServerFn(startNewRevision);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      createRevision({ data: { contractId, sourceRevisionId } }),
    onSuccess: async (outcome) => {
      setOpen(false);
      setError(null);
      onOutcome?.(
        outcome.created
          ? "A new draft revision was created from the finalized snapshot."
          : "An editable draft revision already existed, so it was opened.",
      );
      await queryClient.invalidateQueries({ queryKey: ["arc-workspace"] });
      await queryClient.invalidateQueries({ queryKey: ["arc-revision-history", contractId] });
      // The point of this action is to begin editing the new revision, so the
      // editable ASC 606 analysis opens — not Review & Finalize.
      await navigate({ to: "/analysis", search: { contract: contractId, revision: outcome.revisionId } });
    },
    onError: (cause: unknown) => {
      const message =
        cause instanceof Error && cause.message
          ? cause.message
          : "A new revision could not be created.";
      setError(message);
      onOutcome?.(message);
    },
  });

  return (
    <>
      <button
        type="button"
        className={
          className ??
          "inline-flex min-h-10 items-center rounded-md border border-border px-4 text-sm font-medium text-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        }
        disabled={mutation.isPending}
        onClick={() => setOpen(true)}
      >
        {mutation.isPending ? "Creating…" : "Create new revision"}
      </button>
      <AlertDialog open={open} onOpenChange={(next) => (mutation.isPending ? null : setOpen(next))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Create Revision {nextRevisionNumber}?</AlertDialogTitle>
            <AlertDialogDescription>
              Revision {sourceRevisionNumber} will remain finalized and read-only. ARC will copy its
              analysis inputs into a new editable draft.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                mutation.mutate();
              }}
              disabled={mutation.isPending}
            >
              {mutation.isPending ? "Creating…" : "Create revision"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
