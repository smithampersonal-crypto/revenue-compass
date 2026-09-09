import { createFileRoute } from "@tanstack/react-router";

import { useAnalysis } from "@/components/arc/analysis-context";
import { RevenueScheduleView } from "@/components/arc/RevenueScheduleView";

export const Route = createFileRoute("/analysis/schedule")({
  head: () => ({
    meta: [
      { title: "Revenue Schedule — Ayden's Revenue Compass" },
      { name: "description", content: "Review deterministic ASC 606 revenue schedules by month." },
      { property: "og:title", content: "Revenue Schedule — Ayden's Revenue Compass" },
      {
        property: "og:description",
        content: "Review deterministic ASC 606 revenue schedules by month.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "/analysis/schedule" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "/analysis/schedule" }],
  }),
  component: RevenueScheduleArea,
});

function RevenueScheduleArea() {
  const { draft, result } = useAnalysis();
  return <RevenueScheduleView draft={draft} result={result} />;
}
