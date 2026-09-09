import { analyzeGroupedJournalEntries, analyzeJournalEntries } from "@/lib/asc606-journals";
import type { WorkflowAnalysisResult, WorkflowDraft } from "@/lib/asc606-workflow";
import { analyzeContractBalanceWorkflow } from "@/lib/asc606-workflow";

import { GroupedJournalReconciliation } from "@/components/asc606-workflow/GroupedJournalReconciliation";
import { JournalEntryOutputs } from "@/components/asc606-workflow/JournalEntryOutputs";
import { Notice, Section } from "@/components/asc606-workflow/fields";

/**
 * Journal Entries parent area. Ordinary contracts produce one journal set;
 * grouped Phase 5C contracts each produce their own. No combined journal is
 * created and nothing is netted across contracts.
 */
export function JournalEntriesView({
  draft,
  result,
}: {
  draft: WorkflowDraft;
  result: WorkflowAnalysisResult;
}) {
  const balances = analyzeContractBalanceWorkflow(draft);

  const sourceNames = new Map<string, string>([
    ...draft.performanceObligations.map((po) => [po.id, po.name || po.id] as const),
    ...result.revenueSources.map((source) => [source.id, source.name] as const),
  ]);

  const grouped =
    balances.finalized && balances.grouped
      ? analyzeGroupedJournalEntries(balances.groupInputs)
      : null;
  const ordinary =
    balances.finalized && !balances.grouped && balances.engineInput
      ? analyzeJournalEntries(balances.engineInput)
      : null;

  if (grouped) {
    return (
      <div className="space-y-6">
        {grouped.groups.map((group) => (
          <JournalEntryOutputs
            key={group.groupId}
            analysis={group.analysis}
            poNames={sourceNames}
            title={`Journal Entries — ${group.label}`}
          />
        ))}
        <GroupedJournalReconciliation grouped={grouped} />
      </div>
    );
  }

  if (ordinary) {
    return <JournalEntryOutputs analysis={ordinary} poNames={sourceNames} />;
  }

  return (
    <Section title="Journal Entries">
      <Notice tone="warning">
        Journal entries are not available until the Billing &amp; Contract Balances workpaper is
        complete.
      </Notice>
    </Section>
  );
}
