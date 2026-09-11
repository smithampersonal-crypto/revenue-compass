import { formatCents } from "@/lib/asc606";
import type { ArcReconciliationSnapshot } from "@/lib/arc/persistence/snapshot";
import type { RevisionSnapshotDto } from "@/lib/arc/persistence/revisions.functions";

import { Notice, Section, td } from "@/components/asc606-workflow/fields";

/**
 * Phase 7D — a finalized (or superseded) revision, presented exactly as it was
 * recorded. Every value here is read from the stored reconciliation snapshot;
 * nothing is recalculated, so a later engine change can never silently restate
 * a finalized analysis.
 */
export function FinalizedSnapshotView({
  status,
  revisionNumber,
  snapshot,
}: {
  status: "finalized" | "superseded";
  revisionNumber: number;
  snapshot: RevisionSnapshotDto;
}) {
  const reconciliation = snapshot.reconciliation;

  return (
    <div className="space-y-6">
      <Section
        title={`Finalized snapshot — revision ${revisionNumber}`}
        description="Recorded from the saved inputs at the moment this revision was finalized. It is shown exactly as recorded and is never recalculated."
      >
        <table className="w-full border-collapse text-sm">
          <tbody>
            <tr>
              <td className={td}>Revision status</td>
              <td className={td}>{status === "finalized" ? "Finalized" : "Superseded"}</td>
            </tr>
            <tr>
              <td className={td}>Finalized at</td>
              <td className={td}>
                {snapshot.finalizedAt ? new Date(snapshot.finalizedAt).toLocaleString() : "Not recorded"}
              </td>
            </tr>
            <tr>
              <td className={td}>Engine version</td>
              <td className={td}>{snapshot.engineVersion || "Not recorded"}</td>
            </tr>
            <tr>
              <td className={td}>Input schema version</td>
              <td className={td}>{snapshot.schemaVersion}</td>
            </tr>
          </tbody>
        </table>

        {!snapshot.engineVersionMatchesCurrent ? (
          <Notice tone="warning">
            This snapshot was produced by an earlier version of the deterministic engine. It is
            preserved exactly as finalized. To see the current engine&apos;s conclusions, start a new
            revision.
          </Notice>
        ) : null}
      </Section>

      {reconciliation ? (
        <RecordedReconciliation reconciliation={reconciliation} />
      ) : (
        <Notice tone="warning">
          No reconciliation snapshot was recorded with this revision.
        </Notice>
      )}
    </div>
  );
}

function yesNo(value: boolean | null | undefined): string {
  if (value === true) return "Reconciled";
  if (value === false) return "Not reconciled";
  return "Not applicable";
}

function money(value: number | null | undefined): string {
  return value === null || value === undefined ? "Not recorded" : formatCents(value);
}

function RecordedReconciliation({
  reconciliation,
}: {
  reconciliation: ArcReconciliationSnapshot;
}) {
  const core = reconciliation.core as { reconciled?: boolean | null } | null;
  const lifecycle = reconciliation.lifecycle as { reconciled?: boolean | null } | null;
  const vc = reconciliation.variableConsideration as { reconciled?: boolean | null } | null;
  const modification = reconciliation.modification as { reconciled?: boolean | null } | null;
  const balances = reconciliation.balances as { reconciled?: boolean | null } | null;

  return (
    <Section
      title="Recorded reconciliation"
      description="Engine-reported reconciliation as stored with this finalized revision."
    >
      <table className="w-full border-collapse text-sm">
        <tbody>
          <tr>
            <td className={td}>Transaction price</td>
            <td className={td}>{money(reconciliation.totals.transactionPriceCents)}</td>
          </tr>
          <tr>
            <td className={td}>Allocated consideration</td>
            <td className={td}>{money(reconciliation.totals.allocatedCents)}</td>
          </tr>
          <tr>
            <td className={td}>Revenue recognized in the schedule</td>
            <td className={td}>{money(reconciliation.totals.revenueCents)}</td>
          </tr>
          <tr>
            <td className={td}>Allocated consideration not yet scheduled</td>
            <td className={td}>{money(reconciliation.totals.unscheduledRevenueCents)}</td>
          </tr>
          <tr>
            <td className={td}>Total lifecycle consideration</td>
            <td className={td}>{money(reconciliation.totals.lifecycleConsiderationCents)}</td>
          </tr>
          {core ? (
            <tr>
              <td className={td}>Core ASC 606 analysis</td>
              <td className={td}>{yesNo(core.reconciled)}</td>
            </tr>
          ) : null}
          {lifecycle ? (
            <tr>
              <td className={td}>Material-right lifecycle</td>
              <td className={td}>{yesNo(lifecycle.reconciled)}</td>
            </tr>
          ) : null}
          {vc ? (
            <tr>
              <td className={td}>Variable consideration</td>
              <td className={td}>{yesNo(vc.reconciled)}</td>
            </tr>
          ) : null}
          {modification ? (
            <tr>
              <td className={td}>Contract modification</td>
              <td className={td}>{yesNo(modification.reconciled)}</td>
            </tr>
          ) : null}
          {balances ? (
            <tr>
              <td className={td}>Billing and contract balances</td>
              <td className={td}>{yesNo(balances.reconciled)}</td>
            </tr>
          ) : null}
          {reconciliation.groupedBalancesReconciled !== null ? (
            <tr>
              <td className={td}>Combined gross balances</td>
              <td className={td}>{yesNo(reconciliation.groupedBalancesReconciled)}</td>
            </tr>
          ) : null}
          {reconciliation.journalsReconciled !== null ? (
            <tr>
              <td className={td}>Journal entries</td>
              <td className={td}>{yesNo(reconciliation.journalsReconciled)}</td>
            </tr>
          ) : null}
          {reconciliation.groupedJournalsReconciled !== null ? (
            <tr>
              <td className={td}>Grouped journal entries</td>
              <td className={td}>{yesNo(reconciliation.groupedJournalsReconciled)}</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </Section>
  );
}
