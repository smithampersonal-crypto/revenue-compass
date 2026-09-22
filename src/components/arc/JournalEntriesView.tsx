import {
  isProjectedCollection,
  performanceObligationDisplayLabel,
  type WorkflowAnalysisResult,
  type WorkflowDraft,
} from "@/lib/asc606-workflow";

import type { ArcJournalSnapshot } from "@/lib/arc/persistence/snapshot";

import { GroupedJournalReconciliation } from "@/components/asc606-workflow/GroupedJournalReconciliation";
import { JournalEntryOutputs } from "@/components/asc606-workflow/JournalEntryOutputs";
import { Notice, Section } from "@/components/asc606-workflow/fields";

/**
 * Journal Entries parent area. Ordinary contracts produce one journal set;
 * grouped Phase 5C contracts each produce their own. No combined journal is
 * created and nothing is netted across contracts.
 *
 * The journal output is supplied by AnalysisProvider: the live engine run for
 * an editable analysis, the recorded snapshot for a finalized or superseded
 * revision.
 */
export function JournalEntriesView({
  draft,
  result,
  journals,
}: {
  draft: WorkflowDraft;
  result: WorkflowAnalysisResult;
  journals: ArcJournalSnapshot | null;
}) {
  const sourceNames = new Map<string, string>([
    ...result.revenueSources.map((source) => [source.id, source.name] as const),
    ...draft.performanceObligations.map(
      (po) => [po.id, performanceObligationDisplayLabel(po)] as const,
    ),
  ]);

  // Presentation only: which cash rows the accountant's recorded canonical
  // input marks as contract-derived projections. Basis always comes from the
  // recorded input, including for finalized and superseded revisions — a date
  // in the past is never treated as evidence that cash was received.
  const projectedCollectionIds = new Set(
    draft.contractBalances.cashCollections
      .filter((collection) => isProjectedCollection(collection))
      .map((collection) => collection.id),
  );

  if (journals?.kind === "grouped") {
    const grouped = journals.analysis;
    return (
      <div className="space-y-6">
        {grouped.groups.map((group) => (
          <JournalEntryOutputs
            key={group.groupId}
            analysis={group.analysis}
            poNames={sourceNames}
            title={`Journal Entries — ${group.label}`}
            projectedCollectionIds={projectedCollectionIds}
          />
        ))}
        <GroupedJournalReconciliation grouped={grouped} />
      </div>
    );
  }

  if (journals?.kind === "ordinary") {
    return (
      <JournalEntryOutputs
        analysis={journals.analysis}
        poNames={sourceNames}
        projectedCollectionIds={projectedCollectionIds}
      />
    );
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
