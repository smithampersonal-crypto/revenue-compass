import { createFileRoute } from "@tanstack/react-router";

import { useAnalysis } from "@/components/arc/analysis-context";
import { JournalEntriesView } from "@/components/arc/JournalEntriesView";

export const Route = createFileRoute("/analysis/journals")({
  component: JournalEntriesArea,
});

function JournalEntriesArea() {
  const { draft, result } = useAnalysis();
  return <JournalEntriesView draft={draft} result={result} />;
}
