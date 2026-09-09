import { createFileRoute } from "@tanstack/react-router";

import { useAnalysis } from "@/components/arc/analysis-context";
import { JournalEntryOutputs } from "@/components/asc606-workflow/JournalEntryOutputs";
import { Notice, Section } from "@/components/asc606-workflow/fields";
import { analyzeGroupedJournalEntries, analyzeJournalEntries } from "@/lib/asc606-journals";
import { analyzeContractBalanceWorkflow } from "@/lib/asc606-workflow";

export const Route = createFileRoute("/analysis/journals")({
  component: JournalEntriesArea,
});

function JournalEntriesArea() {
  const { draft, result } = useAnalysis();
  const balances = analyzeContractBalanceWorkflow(draft);

  const sourceNames = new Map<string, string>([
    ...draft.performanceObligations.map((po) => [po.id, po.name || po.id] as const),
    ...result.revenueSources.map((source) => [source.id, source.name] as const),
  ]);

  const journalAnalysis =
    balances.finalized && balances.engineInput ? analyzeJournalEntries(balances.engineInput) : null;
  const groupedJournals =
    balances.finalized && balances.grouped
      ? analyzeGroupedJournalEntries(balances.groupInputs)
      : null;

  if (groupedJournals) {
    return (
      <div className="space-y-6">
        {groupedJournals.groups.map((group) => (
          <JournalEntryOutputs
            key={group.groupId}
            analysis={group.analysis}
            poNames={sourceNames}
            title={`Journal Entries — ${group.label}`}
          />
        ))}
      </div>
    );
  }

  if (journalAnalysis) {
    return <JournalEntryOutputs analysis={journalAnalysis} poNames={sourceNames} />;
  }

  return (
    <Section title="Journal Entries">
      <Notice tone="warning">
        Journal entries are not available until the Billing &amp; Contract Balances workpaper is
        finalized.
      </Notice>
    </Section>
  );
}
