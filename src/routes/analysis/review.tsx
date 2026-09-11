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
  const { result, workpaper, persistence } = useAnalysis();
  const revision = persistence.revision;

  // Snapshot metadata for a finalized or superseded revision. The review
  // output itself comes from the same authoritative workpaper as every other
  // parent area: recorded for a historical revision, live for a draft.
  const recorded =
    revision && revision.status !== "draft" && revision.snapshot
      ? {
          status: revision.status,
          revisionNumber: revision.revisionNumber,
          snapshot: revision.snapshot,
        }
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
      ) : null}
      <ReviewFinalizeView
        result={result}
        balances={workpaper.balances}
        journals={workpaper.journals}
      />
    </div>
  );
}
