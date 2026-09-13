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
  onOutcome,
}: {
  revisionId: string;
  expectedLockVersion: number;
  draftRevisionNumber: number;
  sourceRevisionNumber: number;
  className?: string;
  onReloaded: () => void;
  /** Reported to the parent so it survives the workspace reload; null clears a stale message after success. */
  onOutcome?: (message: string | null) => void;
}) {
  const reset = useServerFn(resetAmendmentDraft);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => reset({ data: { revisionId, expectedLockVersion } }),
    onSuccess: async (outcome) => {
      setOpen(false);
      if (!outcome.ok) {
        setMessage(CONFLICT_MESSAGE);
        onOutcome?.(CONFLICT_MESSAGE);
      } else {
        setMessage(null);
        // A successful reset supersedes any earlier conflict shown by the parent.
        onOutcome?.(null);
      }
      // Safety ordering: the workspace enters its authoritative reload boundary
      // first, so the old revision lock stops being usable by autosave before
      // anything else is awaited. Only then are the source documents refetched.
      onReloaded();
      // The reset restored the source revision's document selection in the same
      // trusted transaction, so the workspace re-reads it from the server.
      await queryClient.invalidateQueries({ queryKey: ["arc-source-documents"] });
    },

    onError: (cause: unknown) => {
      setOpen(false);
      const text =
        cause instanceof Error && cause.message
          ? cause.message
          : "This revision could not be reset.";
      setMessage(text);
      onOutcome?.(text);
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
  onReloaded,
}: {
  contractId: string;
  revisionId: string;
  expectedLockVersion: number;
  draftRevisionNumber: number;
  sourceRevisionNumber: number;
  className?: string;
  /** Reloads the authoritative workspace (revision + lock version) from the server. */
  onReloaded?: () => void;
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
        await queryClient.invalidateQueries({ queryKey: ["arc-workspace"] });
        await queryClient.invalidateQueries({ queryKey: ["arc-source-documents"] });
        // The loaded revision and its lock version are stale; re-establish the
        // authoritative server copy before anything else can be saved.
        onReloaded?.();
        return;
      }
      setMessage(null);
      await queryClient.invalidateQueries({ queryKey: ["arc-workspace"] });
      await queryClient.invalidateQueries({ queryKey: ["arc-revision-history", contractId] });
      // The draft's associations are gone with it; the current finalized
      // revision's own source set is re-read from the server. No contract
      // document is removed by a discard.
      await queryClient.invalidateQueries({ queryKey: ["arc-source-documents"] });
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
      // Transport failure leaves the outcome ambiguous; reload the server copy.
      onReloaded?.();
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
