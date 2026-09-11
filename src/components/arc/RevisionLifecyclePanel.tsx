import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import {
  finalizeRevision,
  listRevisionHistory,
  startNewRevision,
} from "@/lib/arc/persistence/revisions.functions";
import { describeRevisionStatus, finalizeGate } from "@/lib/arc/persistence/revision-history";
import { Notice, Section } from "@/components/asc606-workflow/fields";

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
  const { persistence, result } = useAnalysis();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [blockingIssues, setBlockingIssues] = useState<string[]>([]);

  const finalize = useServerFn(finalizeRevision);
  const fetchHistory = useServerFn(listRevisionHistory);
  const newRevision = useServerFn(startNewRevision);

  const revision = persistence.revision;
  const contractId = revision?.contractId ?? null;

  const history = useQuery({
    queryKey: ["arc-revision-history", contractId],
    enabled: Boolean(contractId),
    queryFn: () => fetchHistory({ data: { contractId: contractId! } }),
  });

  const finalizeMutation = useMutation({
    mutationFn: () =>
      finalize({
        data: {
          revisionId: revision!.revisionId,
          expectedLockVersion: persistence.lockVersion!,
        },
      }),
    onSuccess: async (outcome) => {
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
          "The saved analysis changed since this page loaded, so nothing was finalized. Reload the saved version and try again.",
        );
        return;
      }
      setBlockingIssues(outcome.issues);
      setMessage("The server re-ran the engines on the saved analysis and it is not complete.");
    },
    onError: (error: unknown) => {
      setBlockingIssues([]);
      setMessage(error instanceof Error ? error.message : "That revision could not be finalized.");
    },
  });

  const newRevisionMutation = useMutation({
    mutationFn: () => newRevision({ data: { contractId: contractId! } }),
    onSuccess: async () => {
      setMessage("A new draft revision was started from the finalized snapshot.");
      await queryClient.invalidateQueries({ queryKey: ["arc-revision-history", contractId] });
    },
    onError: (error: unknown) => {
      setMessage(error instanceof Error ? error.message : "A new revision could not be started.");
    },
  });

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
    lockVersion: persistence.lockVersion,
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

      <div className="flex flex-wrap gap-2">
        {revision?.status === "draft" ? (
          <button
            type="button"
            className={BUTTON_CLASS}
            disabled={!gate.canFinalize || finalizeMutation.isPending}
            onClick={() => finalizeMutation.mutate()}
          >
            {finalizeMutation.isPending ? "Finalizing…" : "Finalize this revision"}
          </button>
        ) : null}
        {revision && revision.status !== "draft" ? (
          <button
            type="button"
            className={SECONDARY_CLASS}
            disabled={newRevisionMutation.isPending}
            onClick={() => newRevisionMutation.mutate()}
          >
            {newRevisionMutation.isPending ? "Starting…" : "Start a new revision"}
          </button>
        ) : null}
      </div>

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
