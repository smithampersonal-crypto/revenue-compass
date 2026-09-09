import { createFileRoute } from "@tanstack/react-router";

import { useAnalysis } from "@/components/arc/analysis-context";
import { AnalysisResults } from "@/components/asc606-workflow/AnalysisResults";

export const Route = createFileRoute("/analysis/schedule")({
  component: RevenueScheduleArea,
});

function RevenueScheduleArea() {
  const { draft, result } = useAnalysis();
  return <AnalysisResults draft={draft} result={result} />;
}
