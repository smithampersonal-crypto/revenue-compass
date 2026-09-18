import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";

import { useAnalysis } from "@/components/arc/analysis-context";
import { AiReviewPanel } from "@/components/arc/AiReviewPanel";
import { AiRestoreAction } from "@/components/arc/AiRestoreAction";
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
  const { result, workpaper, persistence, ai } = useAnalysis();
  const navigate = useNavigate();
  // Every identity and continuity hint in the current URL is preserved; only
  // the one-shot review intent is added.
  const search = useSearch({ from: "/analysis" });
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
      {/* AI review comes before the deterministic workflow review, and stays
          visibly distinct from it: these are AI-raised items, not engine issues. */}
      <AiReviewPanel
        ai={ai}
        onOpenTarget={(reviewItemId) => {
          void navigate({ to: "/analysis", search: { ...search, review: reviewItemId } });
        }}
      />
      {/* Task 9C. Whole-draft restore belongs beside review and finalization only. */}
      <AiRestoreAction ai={ai} />
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
