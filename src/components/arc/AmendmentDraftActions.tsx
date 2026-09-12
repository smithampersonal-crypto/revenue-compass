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
import {
  discardAmendmentDraft,
  resetAmendmentDraft,
} from "@/lib/arc/persistence/revisions.functions";

const CONFLICT_MESSAGE =
  "This draft revision changed since this page loaded, so nothing was changed. The saved analysis is being reloaded.";

/**
 * Restores an amendment draft to the finalized revision it continues.
 *
 * No accounting logic lives here: the trusted server transaction copies the
 * source revision's canonical inputs back into the draft, and the workspace
 * then reloads the authoritative saved copy.
 */
export function ResetToRevisionAction({
  revisionId,
  expectedLockVersion,
  draftRevisionNumber,
  sourceRevisionNumber,
  className,
  onReloaded,
}: {
  revisionId: string;
  expectedLockVersion: number;
  draftRevisionNumber: number;
  sourceRevisionNumber: number;
  className?: string;
  onReloaded: () => void;
}) {
  const reset = useServerFn(resetAmendmentDraft);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => reset({ data: { revisionId, expectedLockVersion } }),
    onSuccess: (outcome) => {
      setOpen(false);
      if (!outcome.ok) {
        setMessage(CONFLICT_MESSAGE);
      } else {
        setMessage(null);
      }
      // Either way the server copy is authoritative from here.
      onReloaded();
    },
    onError: (cause: unknown) => {
      setOpen(false);
      setMessage(
        cause instanceof Error && cause.message ? cause.message : "This revision could not be reset.",
      );
      onReloaded();
    },
  });

  return (
    <>
      <button
        type="button"
        className={
          className ??
          "inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium text-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        }
        disabled={mutation.isPending}
        onClick={() => setOpen(true)}
      >
        {mutation.isPending ? "Resetting…" : `Reset to Revision ${sourceRevisionNumber}`}
      </button>
      <AlertDialog open={open} onOpenChange={(next) => (mutation.isPending ? null : setOpen(next))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Reset Revision {draftRevisionNumber} to Revision {sourceRevisionNumber}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              All changes made in this draft revision will be replaced with the inputs from
              finalized Revision {sourceRevisionNumber}. Revision {sourceRevisionNumber} will remain
              unchanged.
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
              {mutation.isPending ? "Resetting…" : "Reset revision"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {message ? <p className="text-sm text-destructive">{message}</p> : null}
    </>
  );
}

/**
 * Permanently removes an unfinished amendment draft. The finalized revision it
 * continued is untouched and becomes the current working point again; the
 * abandoned revision number is not reserved.
 */
export function DiscardDraftRevisionAction({
  contractId,
  revisionId,
  expectedLockVersion,
  draftRevisionNumber,
  sourceRevisionNumber,
  className,
}: {
  contractId: string;
  revisionId: string;
  expectedLockVersion: number;
  draftRevisionNumber: number;
  sourceRevisionNumber: number;
  className?: string;
}) {
  const discard = useServerFn(discardAmendmentDraft);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => discard({ data: { revisionId, expectedLockVersion } }),
    onSuccess: async (outcome) => {
      setOpen(false);
      if (!outcome.ok) {
        setMessage(CONFLICT_MESSAGE);
        await queryClient.invalidateQueries({ queryKey: ["arc-revision-history", contractId] });
        return;
      }
      setMessage(null);
      await queryClient.invalidateQueries({ queryKey: ["arc-workspace"] });
      await queryClient.invalidateQueries({ queryKey: ["arc-revision-history", contractId] });
      await navigate({
        to: "/analysis",
        search: { contract: contractId, revision: outcome.finalizedRevisionId },
      });
    },
    onError: (cause: unknown) => {
      setOpen(false);
      setMessage(
        cause instanceof Error && cause.message
          ? cause.message
          : "This draft revision could not be discarded.",
      );
    },
  });

  return (
    <>
      <button
        type="button"
        className={
          className ??
          "inline-flex min-h-10 items-center rounded-md border border-destructive/40 px-4 text-sm font-medium text-destructive hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        }
        disabled={mutation.isPending}
        onClick={() => setOpen(true)}
      >
        {mutation.isPending ? "Discarding…" : "Discard draft revision"}
      </button>
      <AlertDialog open={open} onOpenChange={(next) => (mutation.isPending ? null : setOpen(next))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard Revision {draftRevisionNumber}?</AlertDialogTitle>
            <AlertDialogDescription>
              This unfinished draft will be permanently removed. Finalized Revision{" "}
              {sourceRevisionNumber} will remain unchanged and become the current working point
              again.
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
              {mutation.isPending ? "Discarding…" : "Discard draft"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {message ? <p className="text-sm text-destructive">{message}</p> : null}
    </>
  );
}
