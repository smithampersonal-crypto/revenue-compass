import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";

import { Button } from "@/components/ui/button";
import { CreateRevisionAction } from "@/components/arc/CreateRevisionAction";
import { ResetToRevisionAction } from "@/components/arc/AmendmentDraftActions";
import { useAnalysis } from "@/components/arc/analysis-context";
import { buildAnalysisSummary } from "@/lib/arc/analysis-summary";
import { listRevisionHistory } from "@/lib/arc/persistence/revisions.functions";
import { FEATURES } from "@/lib/arc/features";

const TONE_CLASS = {
  ok: "border-primary/35 bg-primary/10 text-primary",
  attention: "border-warning/35 bg-warning/10 text-warning-foreground",
  blocked: "border-destructive/40 bg-destructive/10 text-destructive",
} as const;

/**
 * Compact orientation card shown above the parent-area navigation.
 *
 * Presentation only: it consumes the authoritative draft and analysis result
 * from the workspace context and never invokes an accounting engine.
 */
export function AnalysisSummary() {
  const { draft, result, origin, loadedSample, resetAnalysis, canEdit, persistence } =
    useAnalysis();
  const revision = persistence.revision;
  const [lifecycleMessage, setLifecycleMessage] = useState<string | null>(null);
  const summary = buildAnalysisSummary({
    draft,
    result,
    origin,
    scenario: loadedSample,
    persisted: revision
      ? { status: revision.status, revisionNumber: revision.revisionNumber }
      : null,
  });

  // Discoverability only: the revision action belongs next to the finalized
  // status, so it is not hidden inside Review & Finalize. History is read only
  // for a finalized revision, and a superseded revision never qualifies.
  const fetchHistory = useServerFn(listRevisionHistory);
  const contractId = revision?.contractId ?? null;
  const history = useQuery({
    queryKey: ["arc-revision-history", contractId],
    enabled: Boolean(contractId),
    queryFn: () => fetchHistory({ data: { contractId: contractId! } }),
  });

  // An amendment draft continues a finalized revision, so its reset restores
  // that revision's inputs rather than blanking the analysis.
  const openEntry =
    history.data?.revisions.find((entry) => entry.revisionId === revision?.revisionId) ?? null;
  const sourceRevisionId =
    revision?.supersedesRevisionId ?? openEntry?.supersedesRevisionId ?? null;
  const sourceEntry = sourceRevisionId
    ? (history.data?.revisions.find((entry) => entry.revisionId === sourceRevisionId) ?? null)
    : null;
  const amendmentDraft =
    revision?.status === "draft" && sourceEntry && persistence.lockVersion
      ? {
          revisionId: revision.revisionId,
          expectedLockVersion: persistence.lockVersion,
          draftRevisionNumber: revision.revisionNumber,
          sourceRevisionNumber: sourceEntry.revisionNumber,
        }
      : null;
  const currentFinalized =
    history.data?.revisions.find((entry) => entry.isCurrentFinalized) ?? null;
  const canCreateRevision =
    revision?.status === "finalized" && currentFinalized?.revisionId === revision.revisionId;
  const nextRevisionNumber =
    (history.data?.revisions.reduce((max, entry) => Math.max(max, entry.revisionNumber), 0) ?? 0) +
    1;

  return (
    <section
      aria-label="Analysis summary"
      className="space-y-4 rounded-lg border border-border bg-card p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-primary">
          {summary.originLabel}
        </span>
        <span
          className={`rounded-md border px-2 py-1 text-xs font-medium ${TONE_CLASS[summary.statusTone]}`}
        >
          {summary.statusLabel}
        </span>
        {summary.recognitionLabel ? (
          <span className="rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground">
            Recognition · {summary.recognitionLabel}
          </span>
        ) : null}
      </div>

      {summary.identity.length > 0 ? (
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          {summary.identity.map((item) => (
            <p key={item.label} className="text-sm text-foreground">
              <span className="text-muted-foreground">{item.label}: </span>
              <span className="font-semibold">{item.value}</span>
            </p>
          ))}
        </div>
      ) : null}

      <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
        {summary.metrics.map((metric) => (
          <div key={metric.label} className="space-y-0.5">
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              {metric.label}
            </dt>
            <dd className="text-base font-semibold tabular-nums text-foreground">{metric.value}</dd>
          </div>
        ))}
      </dl>

      {summary.originDetail ? (
        <p className="text-xs text-muted-foreground">{summary.originDetail}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {canCreateRevision && contractId && revision ? (
          <CreateRevisionAction
            contractId={contractId}
            sourceRevisionId={revision.revisionId}
            sourceRevisionNumber={revision.revisionNumber}
            nextRevisionNumber={nextRevisionNumber}
            className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          />
        ) : null}
        <Button asChild size="sm">
          <Link to="/analysis/review" search={(previous: Record<string, unknown>) => previous}>
            Review &amp; Finalize
          </Link>
        </Button>
        {FEATURES.SOURCE_DOCUMENTS ? (
          <Button asChild size="sm" variant="outline">
            <Link to="/analysis/documents" search={(previous: Record<string, unknown>) => previous}>
              Source Documents
            </Link>
          </Button>
        ) : null}
        {amendmentDraft ? (
          <ResetToRevisionAction
            {...amendmentDraft}
            className="inline-flex h-8 items-center rounded-md border border-destructive/40 px-3 text-xs font-medium text-destructive hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            onReloaded={persistence.reload}
            onOutcome={setLifecycleMessage}
          />
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!canEdit}
            className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => {
              const message = loadedSample
                ? "Reset this sample? Your edits to the sample contract will be discarded."
                : "Reset this analysis? All entered contract data will be cleared.";
              if (window.confirm(message)) resetAnalysis();
            }}
          >
            {summary.resetLabel}
          </Button>
        )}
      </div>

      {lifecycleMessage ? <p className="text-sm text-destructive">{lifecycleMessage}</p> : null}
    </section>
  );
}
