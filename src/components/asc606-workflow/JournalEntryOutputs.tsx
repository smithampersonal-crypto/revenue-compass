import { formatCents } from "@/lib/asc606";
import type {
  JournalAccount,
  JournalAnalysis,
  JournalEventType,
  JournalLine,
} from "@/lib/asc606-journals";

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

function statusLabel(value: boolean | null): string {
  return value === null ? "Not available" : value ? "Reconciled" : "Not reconciled";
}

export function JournalEntryOutputs({
  analysis,
  poNames,
}: {
  analysis: JournalAnalysis;
  poNames: ReadonlyMap<string, string>;
}) {
  const { entries, reconciliation, validation } = analysis;
  const finalized = entries !== null && reconciliation.reconciled === true;

  return (
    <div className="space-y-6">
      <Section
        title="Journal Entries"
        description="These journal entries are generated deterministically from the approved revenue and contract-balance workpapers. They are read-only and are not posted or saved."
      >
        {finalized ? (
          <div className="space-y-4">
            {entries.map((entry) => (
              <div key={entry.id} className="rounded-md border border-border p-3">
                <p className="text-sm font-semibold text-foreground">{entry.date}</p>
                <p className="text-sm font-medium text-foreground">
                  {EVENT_LABELS[entry.eventType]}
                </p>
                <p className="text-sm text-muted-foreground">{entry.description}</p>
                <table className="mt-2 w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className={th}>Account</th>
                      <th className={th}>Debit</th>
                      <th className={th}>Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entry.lines.map((line, index) => (
                      <tr key={`${entry.id}-${index}`}>
                        <td className={td}>{lineLabel(line, poNames)}</td>
                        <td className={td}>{amount(line.debitCents)}</td>
                        <td className={td}>{amount(line.creditCents)}</td>
                      </tr>
                    ))}
                    <tr className="font-semibold">
                      <td className={td}>Total</td>
                      <td className={td}>{formatCents(entry.totalDebitsCents)}</td>
                      <td className={td}>{formatCents(entry.totalCreditsCents)}</td>
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
              title="Journal engine validation"
              issues={validation.results
                .filter((check) => !check.passed)
                .map((check) => ({ id: check.id, message: check.message }))}
            />
          </>
        )}
      </Section>

      <Section title="Journal Reconciliation">
        <table className="w-full border-collapse text-sm">
          <tbody>
            <tr>
              <td className={td}>All journal entries balanced</td>
              <td className={td}>{statusLabel(reconciliation.allEntriesBalanced)}</td>
            </tr>
            <tr>
              <td className={td}>Monthly journal balances tie to Billing &amp; Contract Balances</td>
              <td className={td}>{statusLabel(reconciliation.monthlyBalancesTie)}</td>
            </tr>
            <tr>
              <td className={td}>Revenue by performance obligation ties to revenue schedule</td>
              <td className={td}>{statusLabel(reconciliation.revenueByPoTies)}</td>
            </tr>
            <tr>
              <td className={td}>Source accounting events complete</td>
              <td className={td}>{statusLabel(reconciliation.sourceEventsComplete)}</td>
            </tr>
            <tr className="font-semibold">
              <td className={td}>Overall status</td>
              <td className={td}>{statusLabel(reconciliation.reconciled)}</td>
            </tr>
          </tbody>
        </table>
      </Section>
    </div>
  );
}
