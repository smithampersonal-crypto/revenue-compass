import { createFileRoute } from "@tanstack/react-router";

import { useAnalysis } from "@/components/arc/analysis-context";
import { RevenueScheduleView } from "@/components/arc/RevenueScheduleView";

export const Route = createFileRoute("/analysis/schedule")({
  component: RevenueScheduleArea,
});

function RevenueScheduleArea() {
  const { draft, result } = useAnalysis();
  return <RevenueScheduleView draft={draft} result={result} />;
}
