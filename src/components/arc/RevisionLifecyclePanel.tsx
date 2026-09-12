import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import {
  finalizeRevision,
  listRevisionHistory,
} from "@/lib/arc/persistence/revisions.functions";
import { describeRevisionStatus, finalizeGate } from "@/lib/arc/persistence/revision-history";
import { isWorkpaperComplete } from "@/lib/arc/persistence/snapshot";
import { Notice, Section } from "@/components/asc606-workflow/fields";

import { CreateRevisionAction } from "./CreateRevisionAction";
import { useAnalysis } from "./analysis-context";

const BUTTON_CLASS =
  "inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";
const SECONDARY_CLASS =
  "inline-flex min-h-10 items-center rounded-md border border-border px-4 text-sm font-medium text-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";

/**
 * Phase 7D — the revision lifecycle for a saved analysis: finalize the current
 * draft, continue from a finalized revision, and browse the Draft / Finalized
 * / Superseded history.
 *
 * The browser sends only the revision id and the authoritative server-accepted
 * lock version. All accounting is done by the server from the persisted draft.
 */
export function RevisionLifecyclePanel() {
  const { persistence, result, workpaper } = useAnalysis();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [blockingIssues, setBlockingIssues] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);

  const finalize = useServerFn(finalizeRevision);
  const fetchHistory = useServerFn(listRevisionHistory);

  const revision = persistence.revision;
  const contractId = revision?.contractId ?? null;

  const history = useQuery({
    queryKey: ["arc-revision-history", contractId],
    enabled: Boolean(contractId),
    queryFn: () => fetchHistory({ data: { contractId: contractId! } }),
  });

  // ARC v1 does not branch from history: only the current finalized revision
  // can be continued. A superseded revision stays view-only.
  const currentFinalizedId =
    history.data?.revisions.find((entry) => entry.isCurrentFinalized)?.revisionId ?? null;
  const canStartNewRevision =
    Boolean(revision) &&
    revision!.status === "finalized" &&
    revision!.revisionId === currentFinalizedId;

  const finalizeMutation = useMutation({
    mutationFn: () => {
      // The whole workspace is locked from here until the server answers, so
      // nothing can change the draft that is being finalized.
      persistence.setFinalizing(true);
      return finalize({
        data: {
          revisionId: revision!.revisionId,
          expectedLockVersion: persistence.lockVersion!,
        },
      });
    },
    onSuccess: async (outcome) => {
      setConfirming(false);
      if (outcome.ok) {
        setBlockingIssues([]);
        setMessage("This revision is finalized. It is now read-only.");
        await queryClient.invalidateQueries({ queryKey: ["arc-revision-history", contractId] });
        persistence.reload();
        return;
      }
      if (outcome.reason === "conflict") {
        setBlockingIssues([]);
        setMessage(
          "The saved analysis changed since this page loaded, so nothing was finalized. The authoritative saved version is being reloaded.",
        );
        // Finalization only starts from a fully saved draft, so there is no
        // local work to preserve. The stale local copy must not be handed back
        // as an editable Saved draft: reload and reopen whatever the server
        // actually holds — a fresh draft, or the immutable snapshot if it was
        // finalized elsewhere.
        await queryClient.invalidateQueries({ queryKey: ["arc-revision-history", contractId] });
        persistence.reload();
        return;
      }
      // A deterministic blocked result performed no write at all, so the same
      // saved draft stays open and editable.
      setBlockingIssues(outcome.issues);
      setMessage("The server re-ran the engines on the saved analysis and it is not complete.");
    },
    onError: async (error: unknown) => {
      setConfirming(false);
      setBlockingIssues([]);
      // The request failed in transport, so whether the database committed is
      // unknown. Treat the commit as ambiguous and re-establish authoritative
      // server state before anything can be edited again.
      setMessage(
        error instanceof Error && error.message
          ? `${error.message} The saved analysis is being reloaded to confirm its current state.`
          : "The finalization result is unknown. The saved analysis is being reloaded to confirm its current state.",
      );
      await queryClient.invalidateQueries({ queryKey: ["arc-revision-history", contractId] });
      persistence.reload();
    },
    onSettled: () => persistence.setFinalizing(false),
  });

  // The revision number a new revision would take, from authoritative history.
  const nextRevisionNumber =
    (history.data?.revisions.reduce((max, entry) => Math.max(max, entry.revisionNumber), 0) ?? 0) +
    1;

  if (!persistence.enabled) {
    return (
      <Section
        title="Finalize"
        description="Finalization records an immutable snapshot of a saved analysis."
      >
        <Notice>
          This analysis is in memory only, so it cannot be finalized. Open a saved contract from My
          Contracts to finalize a revision.
        </Notice>
      </Section>
    );
  }

  const gate = finalizeGate({
    persistenceEnabled: persistence.enabled,
    status: persistence.status,
    revisionStatus: revision?.status ?? null,
    engineFinalized: result.finalized,
    // The same complete-workpaper readiness the server enforces, so an
    // obviously incomplete billing workpaper never offers an enabled button.
    workpaperComplete: isWorkpaperComplete(workpaper),
    lockVersion: persistence.lockVersion,
    finalizing: persistence.finalizing,
  });

  const currentStatus = revision ? describeRevisionStatus(revision.status) : null;

  return (
    <Section
      title="Revision lifecycle"
      description="A draft is editable and autosaved. Finalizing records an immutable snapshot; finalizing again supersedes the previous snapshot, which stays viewable."
    >
      {currentStatus ? (
        <p className="text-sm">
          <span className="font-semibold">
            Revision {revision!.revisionNumber} — {currentStatus.label}
          </span>{" "}
          <span className="text-muted-foreground">{currentStatus.detail}</span>
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">Opening the saved analysis…</p>
      )}

      {confirming ? (
        <div className="space-y-3 rounded-md border border-border p-3">
          <p className="text-sm font-semibold text-foreground">
            Finalizing makes this revision immutable.
          </p>
          <p className="text-sm text-muted-foreground">Future changes require a new revision.</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={BUTTON_CLASS}
              disabled={!gate.canFinalize || finalizeMutation.isPending}
              onClick={() => finalizeMutation.mutate()}
            >
              {finalizeMutation.isPending ? "Finalizing…" : "Finalize analysis"}
            </button>
            <button
              type="button"
              className={SECONDARY_CLASS}
              disabled={finalizeMutation.isPending}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {revision?.status === "draft" ? (
            <button
              type="button"
              className={BUTTON_CLASS}
              disabled={!gate.canFinalize}
              onClick={() => setConfirming(true)}
            >
              Finalize analysis
            </button>
          ) : null}
          {canStartNewRevision && contractId ? (
            <CreateRevisionAction
              contractId={contractId}
              // Provenance is explicit and re-checked inside the database
              // transaction: only the current finalized revision may be
              // continued, and the server records it as the superseded source.
              sourceRevisionId={currentFinalizedId!}
              sourceRevisionNumber={revision!.revisionNumber}
              nextRevisionNumber={nextRevisionNumber}
              className={SECONDARY_CLASS}
              onOutcome={setMessage}
            />
          ) : null}
        </div>
      )}

      {revision && revision.status === "superseded" ? (
        <Notice>
          This superseded revision is view-only. Continue from the current finalized revision to
          make further changes.
        </Notice>
      ) : null}

      {!gate.canFinalize && revision?.status === "draft" ? <Notice>{gate.reason}</Notice> : null}

      {message ? <Notice>{message}</Notice> : null}

      {blockingIssues.length > 0 ? (
        <Notice tone="warning">
          <p className="font-semibold">Outstanding items reported by the engine</p>
          <ul className="mt-1 list-disc pl-5">
            {blockingIssues.map((issue, index) => (
              <li key={index}>{issue}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Revision history</h3>
        {history.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading revision history…</p>
        ) : history.isError ? (
          <Notice tone="warning">The revision history could not be loaded.</Notice>
        ) : (
          <ul className="space-y-2">
            {(history.data?.revisions ?? []).map((entry) => {
              const described = describeRevisionStatus(entry.status);
              const isOpen = entry.revisionId === revision?.revisionId;
              return (
                <li
                  key={entry.revisionId}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border px-3 py-2 text-sm"
                >
                  <span className="font-medium">Revision {entry.revisionNumber}</span>
                  <span className="rounded border border-border px-2 py-0.5 text-xs uppercase tracking-wide text-muted-foreground">
                    {described.label}
                  </span>
                  {entry.isCurrentFinalized ? (
                    <span className="text-xs text-muted-foreground">Current finalized</span>
                  ) : null}
                  {entry.finalizedAt ? (
                    <span className="text-xs text-muted-foreground">
                      Finalized {new Date(entry.finalizedAt).toLocaleString()}
                    </span>
                  ) : null}
                  {entry.engineVersion ? (
                    <span className="text-xs text-muted-foreground">
                      Engine {entry.engineVersion}
                    </span>
                  ) : null}
                  {isOpen ? (
                    <span className="text-xs font-medium">Open</span>
                  ) : (
                    <Link
                      to="/analysis/review"
                      search={{ contract: contractId!, revision: entry.revisionId }}
                      className="text-sm underline hover:no-underline focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      View
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Section>
  );
}
