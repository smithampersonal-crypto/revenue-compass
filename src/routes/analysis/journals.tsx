import { createFileRoute } from "@tanstack/react-router";

import { useAnalysis } from "@/components/arc/analysis-context";
import { JournalEntriesView } from "@/components/arc/JournalEntriesView";

export const Route = createFileRoute("/analysis/journals")({
  head: () => ({
    meta: [
      { title: "Journal Entries — Ayden's Revenue Compass" },
      {
        name: "description",
        content: "Review balanced ASC 606 journal entries and group reconciliations.",
      },
      { property: "og:title", content: "Journal Entries — Ayden's Revenue Compass" },
      {
        property: "og:description",
        content: "Review balanced ASC 606 journal entries and group reconciliations.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "/analysis/journals" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "/analysis/journals" }],
  }),
  component: JournalEntriesArea,
});

function JournalEntriesArea() {
  const { draft, result } = useAnalysis();
  return <JournalEntriesView draft={draft} result={result} />;
}
