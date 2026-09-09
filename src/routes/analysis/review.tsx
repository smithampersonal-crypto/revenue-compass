import { createFileRoute } from "@tanstack/react-router";

import { useAnalysis } from "@/components/arc/analysis-context";
import { ReviewFinalizeView } from "@/components/arc/ReviewFinalizeView";

export const Route = createFileRoute("/analysis/review")({
  component: ReviewFinalizeArea,
});

function ReviewFinalizeArea() {
  const { draft, result } = useAnalysis();
  return <ReviewFinalizeView draft={draft} result={result} />;
}
