import { createFileRoute } from "@tanstack/react-router";

import { useAnalysis } from "@/components/arc/analysis-context";
import { FinalizedSnapshotView } from "@/components/arc/FinalizedSnapshotView";
import { ReviewFinalizeView } from "@/components/arc/ReviewFinalizeView";
import { RevisionLifecyclePanel } from "@/components/arc/RevisionLifecyclePanel";

export const Route = createFileRoute("/analysis/review")({
  head: () => ({
    meta: [
      { title: "Review ASC 606 Analysis — Ayden's Revenue Compass" },
      {
        name: "description",
        content: "Review ASC 606 judgments, issues, outputs and reconciliations together.",
      },
      { property: "og:title", content: "Review ASC 606 Analysis — Ayden's Revenue Compass" },
      {
        property: "og:description",
        content: "Review ASC 606 judgments, issues, outputs and reconciliations together.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "/analysis/review" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "/analysis/review" }],
  }),
  component: ReviewFinalizeArea,
});

function ReviewFinalizeArea() {
  const { draft, result, persistence } = useAnalysis();
  const revision = persistence.revision;

  // A finalized or superseded revision is presented from its recorded
  // snapshot, never from a fresh engine run.
  const recorded =
    revision && revision.status !== "draft" && revision.snapshot
      ? { status: revision.status, revisionNumber: revision.revisionNumber, snapshot: revision.snapshot }
      : null;

  return (
    <div className="space-y-6">
      <RevisionLifecyclePanel />
      {recorded ? (
        <FinalizedSnapshotView
          status={recorded.status}
          revisionNumber={recorded.revisionNumber}
          snapshot={recorded.snapshot}
        />
      ) : (
        <ReviewFinalizeView draft={draft} result={result} />
      )}
    </div>
  );
}
