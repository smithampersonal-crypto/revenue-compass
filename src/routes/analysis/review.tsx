import { createFileRoute } from "@tanstack/react-router";

import { useAnalysis } from "@/components/arc/analysis-context";
import { ReviewFinalizeView } from "@/components/arc/ReviewFinalizeView";

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
  const { draft, result } = useAnalysis();
  return <ReviewFinalizeView draft={draft} result={result} />;
}
