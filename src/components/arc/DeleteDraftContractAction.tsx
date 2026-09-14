import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { deleteInitialDraftContract } from "@/lib/arc/persistence/workspace.functions";

/**
 * Phase 8E — deletes a saved analysis that has never been finalized.
 *
 * The label is never the authority: the trusted transaction re-checks under
 * row locks that no revision has ever been finalized before removing the
 * contract, its draft and its uploaded PDFs. The customer stays.
 */
export function DeleteDraftContractAction({
  contractId,
  contractTitle,
  className,
}: {
  contractId: string;
  contractTitle: string;
  className?: string;
}) {
  const remove = useServerFn(deleteInitialDraftContract);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => remove({ data: { contractId } }),
    onSuccess: async () => {
      setOpen(false);
      setMessage(null);
      await queryClient.invalidateQueries({ queryKey: ["arc-workspace"] });
    },
    onError: (cause: unknown) => {
      setOpen(false);
      setMessage(
        cause instanceof Error && cause.message
          ? cause.message
          : "That draft analysis could not be deleted.",
      );
      // The list may already have changed underneath this page.
      void queryClient.invalidateQueries({ queryKey: ["arc-workspace"] });
    },
  });

  return (
    <>
      <button
        type="button"
        className={
          className ??
          "inline-flex min-h-10 items-center rounded-md border border-destructive/40 px-3 text-sm font-medium text-destructive hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        }
        disabled={mutation.isPending}
        onClick={() => setOpen(true)}
      >
        {mutation.isPending ? "Deleting…" : "Delete draft"}
      </button>
      <AlertDialog open={open} onOpenChange={(next) => (mutation.isPending ? null : setOpen(next))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this draft analysis?</AlertDialogTitle>
            <AlertDialogDescription>
              This draft has never been finalized. Deleting it will remove the saved contract
              analysis and its uploaded source documents. The customer will remain. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                mutation.mutate();
              }}
              disabled={mutation.isPending}
            >
              {mutation.isPending ? "Deleting…" : `Delete ${contractTitle}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {message ? <p className="w-full text-sm text-destructive">{message}</p> : null}
    </>
  );
}
