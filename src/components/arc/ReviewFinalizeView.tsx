import { formatCents } from "@/lib/asc606";
import type {
  ContractBalanceWorkflowResult,
  WorkflowAnalysisResult,
} from "@/lib/asc606-workflow";
import type { ArcJournalSnapshot } from "@/lib/arc/persistence/snapshot";

import { CoreReconciliation } from "@/components/asc606-workflow/CoreReconciliation";
import { MaterialRightReconciliation } from "@/components/asc606-workflow/MaterialRightLifecycleOutputs";
import { GroupedJournalReconciliation } from "@/components/asc606-workflow/GroupedJournalReconciliation";
import { IssueList, Notice, Section, td } from "@/components/asc606-workflow/fields";
import { VariableConsiderationReconciliation } from "@/components/asc606-workflow/VariableConsiderationOutputs";

import { analysisStatus } from "./analysis-status";

/**
 * Review & Finalize aggregates status, validation and reconciliation from
 * every engine so an accountant can see in one place whether the analysis and
 * its outputs reconcile. Detailed schedules stay in their own parent areas.
 *
 * All engine output is supplied by AnalysisProvider: the live engine run for
 * an editable analysis, the recorded snapshot for a finalized or superseded
 * revision. Nothing here is recalculated.
 */
export function ReviewFinalizeView({
  result,
  balances,
  journals,
}: {
  result: WorkflowAnalysisResult;
  balances: ContractBalanceWorkflowResult;
  journals: ArcJournalSnapshot | null;
}) {
  const status = analysisStatus(result);
  const grouped = journals?.kind === "grouped" ? journals.analysis : null;
  const ordinaryJournals = journals?.kind === "ordinary" ? journals.analysis : null;
  const modification = result.modification;

  return (
    <div className="space-y-6">
      <Section
        title="Review"
        description="Status, outstanding items and reconciliation from the deterministic engines."
      >
        <Notice
          tone={status.tone === "ok" ? "muted" : status.tone === "blocked" ? "danger" : "warning"}
        >
          <p className="font-semibold">{status.headline}</p>
          <p className="mt-1">{status.detail}</p>
        </Notice>
      </Section>

      <IssueList
        title="Workflow items requiring attention"
        issues={result.workflowValidation.blocking}
      />
      <IssueList
        title="Workflow warnings"
        tone="warning"
        issues={result.workflowValidation.warnings}
      />
      <IssueList
        title="Engine input could not be assembled"
        issues={result.adapterErrors.map((message, index) => ({ id: String(index), message }))}
      />

      {result.engineValidation ? (
        <Section title="Engine validation">
          <p className="text-sm font-semibold">
            {result.engineValidation.status === "passed"
              ? "Engine Validation Passed"
              : "Engine Validation Requires Attention"}
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {result.engineValidation.results.map((check) => (
              <li key={check.id}>
                {check.passed ? "PASS" : check.severity === "blocking" ? "BLOCKING" : "WARNING"} —{" "}
                {check.id}: {check.message}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {result.variableConsideration ? (
        <VariableConsiderationReconciliation vc={result.variableConsideration} />
      ) : result.lifecycle ? (
        <MaterialRightReconciliation lifecycle={result.lifecycle} />
      ) : (
        <CoreReconciliation analysis={result.analysis} />
      )}

      {modification ? (
        <Section
          title="Contract modification status"
          description="Summary only. The full modification workpaper is presented under Additional Topics Applied → Contract Modifications."
        >
          <table className="w-full border-collapse text-sm">
            <tbody>
              <tr>
                <td className={td}>Classification</td>
                <td className={td}>{modification.classification?.label ?? "Not available"}</td>
              </tr>
              <tr>
                <td className={td}>Historical cutoff date</td>
                <td className={td}>{modification.historicalCutoffDate ?? "Not available"}</td>
              </tr>
              <tr>
                <td className={td}>Historical revenue</td>
                <td className={td}>{formatCents(modification.totals.historicalRevenueCents)}</td>
              </tr>
              <tr>
                <td className={td}>Cumulative catch-up</td>
                <td className={td}>{formatCents(modification.totals.catchUpCents)}</td>
              </tr>
              <tr>
                <td className={td}>Future revenue</td>
                <td className={td}>{formatCents(modification.totals.futureRevenueCents)}</td>
              </tr>
              <tr>
                <td className={td}>Total lifecycle consideration</td>
                <td className={td}>
                  {formatCents(modification.totals.lifecycleConsiderationCents)}
                </td>
              </tr>
              <tr>
                <td className={td}>Difference</td>
                <td className={td}>
                  {modification.reconciliation.differenceCents === null
                    ? "Not available"
                    : formatCents(modification.reconciliation.differenceCents)}
                </td>
              </tr>
              <tr className="font-semibold">
                <td className={td}>Status</td>
                <td className={td}>
                  {modification.reconciliation.reconciled === null
                    ? "Not available"
                    : modification.reconciliation.reconciled
                      ? "Reconciled"
                      : "Not reconciled"}
                </td>
              </tr>
            </tbody>
          </table>
        </Section>
      ) : null}

      <Section
        title="Billing and contract-balance workpaper"
        description="Detailed schedules remain in the Contract Balances area."
      >
        {balances.finalized ? (
          balances.grouped ? (
            <table className="w-full border-collapse text-sm">
              <tbody>
                {balances.grouped.groups.map((group) => (
                  <tr key={group.groupId}>
                    <td className={td}>{group.label}</td>
                    <td className={td}>
                      {group.analysis.reconciliation.reconciled === true
                        ? "Reconciled"
                        : "Not reconciled"}
                    </td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className={td}>Combined gross balances</td>
                  <td className={td}>
                    {balances.grouped.reconciled === true ? "Reconciled" : "Not reconciled"}
                  </td>
                </tr>
              </tbody>
            </table>
          ) : (
            <table className="w-full border-collapse text-sm">
              <tbody>
                <tr>
                  <td className={td}>Transaction price</td>
                  <td className={td}>
                    {formatCents(balances.analysis!.reconciliation.transactionPriceCents)}
                  </td>
                </tr>
                <tr>
                  <td className={td}>Total revenue recognized</td>
                  <td className={td}>
                    {balances.analysis!.reconciliation.totalRevenueCents === null
                      ? "Not available"
                      : formatCents(balances.analysis!.reconciliation.totalRevenueCents)}
                  </td>
                </tr>
                <tr className="font-semibold">
                  <td className={td}>Status</td>
                  <td className={td}>
                    {balances.analysis!.reconciliation.reconciled === true
                      ? "Reconciled"
                      : "Not reconciled"}
                  </td>
                </tr>
              </tbody>
            </table>
          )
        ) : (
          <>
            <Notice tone="warning">
              The Billing &amp; Contract Balances workpaper is incomplete.
            </Notice>
            <IssueList
              title="Outstanding billing and contract-balance items"
              tone="warning"
              issues={balances.validation.blocking}
            />
          </>
        )}
      </Section>

      {grouped ? (
        <GroupedJournalReconciliation grouped={grouped} />
      ) : (
        <Section
          title="Journal reconciliation"
          description="Detailed entries remain in the Journal Entries area."
        >
          {ordinaryJournals ? (
            <p className="text-sm font-semibold">
              {ordinaryJournals.reconciliation.reconciled === true
                ? "Journal entries reconciled"
                : "Journal entries not reconciled"}
            </p>
          ) : (
            <Notice tone="warning">
              Journal entries are not available until the Billing &amp; Contract Balances workpaper
              is complete.
            </Notice>
          )}
        </Section>
      )}
    </div>
  );
}
