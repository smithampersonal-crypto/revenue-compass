import { formatCents } from "@/lib/asc606";
import { formatBasisPoints } from "@/lib/asc606-material-rights";
import type { MaterialRightLifecycleAnalysis } from "@/lib/asc606-material-rights";
import { MATERIAL_RIGHT_STATUS_LABELS } from "@/lib/asc606-workflow";

import { Section, td, th } from "./fields";

/**
 * Read-only Phase 5A lifecycle presentation. Every amount is engine output;
 * this component performs no accounting arithmetic.
 */
export function MaterialRightLifecycleOutputs({
  lifecycle,
}: {
  lifecycle: MaterialRightLifecycleAnalysis;
}) {
  return (
    <Section
      title="Material rights (engine output)"
      description="Customer options that convey a material right, their inception measurement and their lifecycle outcome."
    >
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className={th}>Material right</th>
              <th className={th}>Underlying good or service</th>
              <th className={th}>Economic benefit</th>
              <th className={th}>Exercise probability</th>
              <th className={th}>Estimated SSP</th>
              <th className={th}>Allocated</th>
              <th className={th}>Outcome</th>
              <th className={th}>Unscheduled consideration</th>
              <th className={th}>Exercise date</th>
              <th className={th}>New exercise consideration</th>
              <th className={th}>Carried allocation</th>
              <th className={th}>Recognition basis</th>
              <th className={th}>Expiration date</th>
              <th className={th}>Expiration revenue</th>
            </tr>
          </thead>
          <tbody>
            {lifecycle.materialRights.map((right) => (
              <tr key={right.poId}>
                <td className={td}>{right.name}</td>
                <td className={td}>{right.underlyingGoodOrServiceName}</td>
                <td className={td}>{formatCents(right.benefitAmountCents)}</td>
                <td className={td}>{formatBasisPoints(right.exerciseProbabilityBps)}</td>
                <td className={td}>{formatCents(right.estimatedSspCents)}</td>
                <td className={td}>{formatCents(right.allocatedCents)}</td>
                <td className={td}>
                  {MATERIAL_RIGHT_STATUS_LABELS[right.status]}
                  {right.exerciseDate ? ` on ${right.exerciseDate}` : ""}
                  {right.expirationDate ? ` on ${right.expirationDate}` : ""}
                </td>
                <td className={td}>{formatCents(right.unscheduledCents)}</td>
                <td className={td}>{right.exerciseDate ?? "—"}</td>
                <td className={td}>
                  {right.exerciseConsiderationCents === null
                    ? "—"
                    : formatCents(right.exerciseConsiderationCents)}
                </td>
                <td className={td}>
                  {right.status === "exercised" ? formatCents(right.allocatedCents) : "—"}
                </td>
                <td className={td}>
                  {right.exerciseRecognitionBasisCents === null
                    ? "—"
                    : formatCents(right.exerciseRecognitionBasisCents)}
                </td>
                <td className={td}>{right.expirationDate ?? "—"}</td>
                <td className={td}>
                  {right.expirationRevenueCents === null
                    ? "—"
                    : formatCents(right.expirationRevenueCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

/** Lifecycle reconciliation only; used by Review & Finalize. */
export function MaterialRightReconciliation({
  lifecycle,
}: {
  lifecycle: MaterialRightLifecycleAnalysis;
}) {
  const { totals, reconciliation } = lifecycle;
  return (
    <Section title="Material-right reconciliation (engine output)">
      <table className="w-full border-collapse text-sm">
        <tbody>
          <tr>
            <td className={td}>Original transaction price</td>
            <td className={td}>{formatCents(totals.originalTransactionPriceCents)}</td>
          </tr>
          <tr>
            <td className={td}>Consideration on exercised options</td>
            <td className={td}>{formatCents(totals.exerciseConsiderationCents)}</td>
          </tr>
          <tr>
            <td className={td}>Total lifecycle consideration</td>
            <td className={td}>{formatCents(totals.lifecycleConsiderationCents)}</td>
          </tr>
          <tr>
            <td className={td}>Scheduled revenue</td>
            <td className={td}>
              {totals.scheduledRevenueCents === null
                ? "Not available"
                : formatCents(totals.scheduledRevenueCents)}
            </td>
          </tr>
          <tr>
            <td className={td}>Unscheduled material-right consideration</td>
            <td className={td}>
              {totals.unscheduledMaterialRightCents === null
                ? "Not available"
                : formatCents(totals.unscheduledMaterialRightCents)}
            </td>
          </tr>
          <tr>
            <td className={td}>Scheduled plus unscheduled</td>
            <td className={td}>
              {reconciliation.scheduledPlusUnscheduledCents === null
                ? "Not available"
                : formatCents(reconciliation.scheduledPlusUnscheduledCents)}
            </td>
          </tr>
          <tr>
            <td className={td}>Difference</td>
            <td className={td}>
              {reconciliation.differenceCents === null
                ? "Not available"
                : formatCents(reconciliation.differenceCents)}
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
