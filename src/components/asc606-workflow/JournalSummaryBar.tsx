import { formatCents } from "@/lib/asc606";
import type { JournalSummary } from "@/lib/asc606-journals/presentation";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 px-4 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 whitespace-nowrap text-sm font-semibold tabular-nums text-foreground">
        {children}
      </dd>
    </div>
  );
}

export function JournalSummaryBar({ summary, label }: { summary: JournalSummary; label: string }) {
  const { status } = summary;
  const statusText =
    status.kind === "reconciled"
      ? "✓ Reconciled"
      : status.kind === "out_of_balance"
        ? `⚠ Out of balance · ${formatCents(status.differenceCents)} difference`
        : "⚠ Not reconciled";

  return (
    <section aria-label={`${label} summary`} className="rounded-md border border-border bg-card">
      <dl className="grid grid-cols-2 divide-border sm:grid-cols-3 lg:grid-cols-5 lg:divide-x">
        <Field label="Journal Entries">{summary.entryCount}</Field>
        <Field label="Periods">{summary.periodCount}</Field>
        <Field label="Total Debits">{formatCents(summary.totalDebitsCents)}</Field>
        <Field label="Total Credits">{formatCents(summary.totalCreditsCents)}</Field>
        <Field label="Reconciliation">
          <span className={status.kind === "reconciled" ? "text-foreground" : "text-destructive"}>
            {statusText}
          </span>
        </Field>
      </dl>
      {summary.issues.length > 0 ? (
        <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
          Checks not passed:{" "}
          {summary.issues
            .map((issue) =>
              issue.state === "failed" ? `${issue.label} — failed` : `${issue.label} — not evaluated`,
            )
            .join("; ")}
        </p>
      ) : null}
    </section>
  );
}
