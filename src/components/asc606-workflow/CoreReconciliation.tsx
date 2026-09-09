import { formatCents } from "@/lib/asc606";
import type { WorkflowAnalysisResult } from "@/lib/asc606-workflow";

import { Notice, Section, td } from "./fields";

/**
 * Core ASC 606 reconciliation for a contract without variable consideration
 * or material rights. Every value is engine output.
 */
export function CoreReconciliation({ analysis }: { analysis: WorkflowAnalysisResult["analysis"] }) {
  if (!analysis) {
    return (
      <Section title="ASC 606 reconciliation">
        <Notice tone="warning">
          No reconciliation is available until the outstanding analysis items are resolved.
        </Notice>
      </Section>
    );
  }
  const { totals, reconciliation } = analysis;
  return (
    <Section title="ASC 606 reconciliation (engine output)">
      <table className="w-full border-collapse text-sm">
        <tbody>
          <tr>
            <td className={td}>Transaction price</td>
            <td className={td}>{formatCents(totals.transactionPriceCents)}</td>
          </tr>
          <tr>
            <td className={td}>Allocated consideration</td>
            <td className={td}>
              {totals.allocatedCents === null
                ? "Not available"
                : formatCents(totals.allocatedCents)}
            </td>
          </tr>
          <tr>
            <td className={td}>Scheduled revenue</td>
            <td className={td}>
              {totals.revenueCents === null ? "Not available" : formatCents(totals.revenueCents)}
            </td>
          </tr>
          <tr>
            <td className={td}>Allocation difference</td>
            <td className={td}>
              {reconciliation.allocationDifferenceCents === null
                ? "Not available"
                : formatCents(reconciliation.allocationDifferenceCents)}
            </td>
          </tr>
          <tr>
            <td className={td}>Revenue difference</td>
            <td className={td}>
              {reconciliation.revenueDifferenceCents === null
                ? "Not available"
                : formatCents(reconciliation.revenueDifferenceCents)}
            </td>
          </tr>
          <tr className="font-semibold">
            <td className={td}>Status</td>
            <td className={td}>
              {reconciliation.reconciled === null
                ? "Not available"
                : reconciliation.reconciled
                  ? "Reconciled"
                  : "Not reconciled"}
            </td>
          </tr>
        </tbody>
      </table>
    </Section>
  );
}
