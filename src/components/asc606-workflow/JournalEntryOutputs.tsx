import { formatCents } from "@/lib/asc606";
import type {
  JournalAccount,
  JournalAnalysis,
  JournalEventType,
  JournalLine,
} from "@/lib/asc606-journals";

import { summarizeJournal } from "@/lib/asc606-journals/presentation";

import { JournalSummaryBar } from "./JournalSummaryBar";
import { IssueList, Notice, Section, td, th } from "./fields";

/**
 * Read-only presentation of the approved Phase 4A journal-entry engine output.
 * This component performs no accounting: it only labels, formats and renders
 * amounts already produced by the engine, in the engine's own order.
 */

const ACCOUNT_LABELS: Record<JournalAccount, string> = {
  cash: "Cash",
  billed_ar: "Accounts Receivable — Billed",
  unbilled_ar: "Accounts Receivable — Unbilled",
  contract_asset: "Contract Asset",
  contract_liability: "Contract Liability",
  revenue: "Revenue",
};

const EVENT_LABELS: Record<JournalEventType, string> = {
  revenue_recognition: "Revenue Recognition",
  unconditional_right: "Unconditional Right",
  invoice_reclassification: "Invoice Reclassification",
  cash_collection: "Cash Collection",
};

function lineLabel(line: JournalLine, poNames: ReadonlyMap<string, string>): string {
  const base = ACCOUNT_LABELS[line.account];
  if (line.account !== "revenue" || !line.poId) return base;
  return `${base} — ${poNames.get(line.poId) ?? line.poId}`;
}

function amount(cents: number): string {
  return cents === 0 ? "—" : formatCents(cents);
}

export function JournalEntryOutputs({
  analysis,
  poNames,
  title = "Journal Entries",
  projectedCollectionIds,
}: {
  analysis: JournalAnalysis;
  poNames: ReadonlyMap<string, string>;
  /** Identifies the contract these entries belong to in a grouped analysis. */
  title?: string;
  /**
   * Cash-collection draft IDs whose recorded basis is a contract-derived
   * projection. Presentation only: the engine arithmetic is untouched.
   */
  projectedCollectionIds?: ReadonlySet<string>;
}) {
  const { entries, reconciliation, validation } = analysis;
  const finalized = entries !== null && reconciliation.reconciled === true;
  // Presentation-only control totals; authority above (`finalized`) is unchanged.
  const summary = summarizeJournal(analysis);

  return (
    <div className="space-y-6">
      <Section
        title={title}
        description="These journal entries are generated deterministically from the approved revenue and contract-balance workpapers. They are read-only and are not posted or saved."
      >
        {summary ? <JournalSummaryBar summary={summary} label={title} /> : null}
        {finalized ? (
          <div className="space-y-4">
            {entries.map((entry) => (
              <div key={entry.id} className="rounded-md border border-border p-3">
                <p className="text-sm font-semibold text-foreground">{entry.date}</p>
                <p className="text-sm font-medium text-foreground">
                  {entry.eventType === "cash_collection" &&
                  entry.sourceId !== null &&
                  projectedCollectionIds?.has(entry.sourceId)
                    ? "Projected Cash Collection — Illustrative"
                    : EVENT_LABELS[entry.eventType]}
                </p>
                <p className="text-sm text-muted-foreground">{entry.description}</p>
                <table className="mt-2 w-full table-fixed border-collapse text-sm">
                  {/* Fixed geometry: identical Account/Debit/Credit widths on
                      every journal card so money columns share vertical axes.
                      Proportional widths keep the money columns near the
                      Account column instead of pushing them to the far edge;
                      from sm up the Credit column insets its right-aligned
                      amounts so Debit and Credit read as a balanced pair. */}
                  <colgroup>
                    <col className="w-1/2" />
                    <col className="w-1/4" />
                    <col className="w-1/4" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th className={th}>Account</th>
                      <th className={`${th} text-right`}>Debit</th>
                      <th className={`${th} sm:pr-10 text-right`}>Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entry.lines.map((line, index) => (
                      <tr key={`${entry.id}-${index}`}>
                        <td className={td}>{lineLabel(line, poNames)}</td>
                        <td className={`${td} text-right`}>{amount(line.debitCents)}</td>
                        <td className={`${td} sm:pr-10 text-right`}>{amount(line.creditCents)}</td>
                      </tr>
                    ))}
                    <tr className="font-semibold">
                      <td className={td}>Total</td>
                      <td className={`${td} text-right`}>{formatCents(entry.totalDebitsCents)}</td>
                      <td className={`${td} sm:pr-10 text-right`}>
                        {formatCents(entry.totalCreditsCents)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        ) : (
          <>
            <Notice tone="danger">
              The deterministic journal-entry engine reported a blocking issue, so no authoritative
              journal entries are presented.
            </Notice>
            <IssueList
              title="Journal Validation Checks"
              issues={validation.results
                .filter((check) => !check.passed)
                .map((check) => ({ id: check.id, message: check.message }))}
            />
          </>
        )}
      </Section>

    </div>
  );
}
