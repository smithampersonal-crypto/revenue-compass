import { formatCents } from "@/lib/asc606";
import type { VariableConsiderationAnalysis } from "@/lib/asc606-variable-consideration";

import { Notice, Section, td, th } from "./fields";

/**
 * Read-only Phase 5B presentation. Every amount is engine output; this
 * component performs no accounting arithmetic.
 */
export function VariableConsiderationOutputs({
  vc,
}: {
  vc: VariableConsiderationAnalysis;
}) {
  const layers = vc.allocation;

  return (
    <>
      <Section
        title="Variable consideration (engine output)"
        description="Each component, the amount included after the accountant's constraint conclusion, and its allocation treatment."
      >
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className={th}>Component</th>
              <th className={th}>Estimation method</th>
              <th className={th}>Allocation treatment</th>
              <th className={th}>Included at inception</th>
              <th className={th}>Currently included</th>
              <th className={th}>Resolved</th>
            </tr>
          </thead>
          <tbody>
            {vc.components.map((component) => (
              <tr key={component.componentId}>
                <td className={td}>{component.description}</td>
                <td className={td}>{component.estimationMethod.replace(/_/g, " ")}</td>
                <td className={td}>{component.allocationTreatment.replace(/_/g, " ")}</td>
                <td className={td}>{formatCents(component.initialIncludedCents)}</td>
                <td className={td}>{formatCents(component.currentIncludedCents)}</td>
                <td className={td}>{component.resolved ? "Yes" : "No"}</td>
              </tr>
            ))}
            {vc.components.length === 0 ? (
              <tr>
                <td className={td} colSpan={6}>
                  No estimated variable-consideration components.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>

        {vc.changeEvents.length > 0 ? (
          <table className="w-full border-collapse text-sm">
            <caption className="mb-1 text-left text-sm font-semibold">
              Dated changes in the transaction price
            </caption>
            <thead>
              <tr>
                <th className={th}>Effective date</th>
                <th className={th}>Month</th>
                <th className={th}>Change in transaction price</th>
                <th className={th}>Cumulative catch-up recognized</th>
                <th className={th}>Affects future periods</th>
                <th className={th}>Resolution</th>
              </tr>
            </thead>
            <tbody>
              {vc.changeEvents.map((event) => (
                <tr key={event.id}>
                  <td className={td}>{event.effectiveDate}</td>
                  <td className={td}>{event.month}</td>
                  <td className={td}>{formatCents(event.transactionPriceChangeCents)}</td>
                  <td className={td}>{formatCents(event.catchUpCents)}</td>
                  <td className={td}>{formatCents(event.futureImpactCents)}</td>
                  <td className={td}>{event.isResolution ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {vc.usagePeriods.length > 0 ? (
          <table className="w-full border-collapse text-sm">
            <caption className="mb-1 text-left text-sm font-semibold">
              Usage-as-incurred consideration
            </caption>
            <thead>
              <tr>
                <th className={th}>Month</th>
                <th className={th}>Performance obligation</th>
                <th className={th}>Usage consideration</th>
              </tr>
            </thead>
            <tbody>
              {vc.usagePeriods.map((period) => (
                <tr key={period.revenueSourceId}>
                  <td className={td}>{period.month}</td>
                  <td className={td}>{period.targetPoId}</td>
                  <td className={td}>{formatCents(period.totalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Section>

      {layers ? (
        <Section
          title="Allocation layers (engine output)"
          description="The relative-SSP allocation of the general pool, the amounts allocated entirely to a specific item under the allocation exception, and the resulting allocation."
        >
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={th}>Performance obligation</th>
                <th className={th}>Base (relative SSP)</th>
                <th className={th}>Inception total</th>
                <th className={th}>Current total</th>
              </tr>
            </thead>
            <tbody>
              {layers.currentFinal.map((row) => (
                <tr key={row.poId}>
                  <td className={td}>{row.name}</td>
                  <td className={td}>
                    {formatCents(
                      layers.base.find((b) => b.poId === row.poId)?.allocatedCents ?? 0,
                    )}
                  </td>
                  <td className={td}>
                    {formatCents(
                      layers.inceptionFinal.find((b) => b.poId === row.poId)?.amountCents ?? 0,
                    )}
                  </td>
                  <td className={td}>{formatCents(row.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {layers.specific.length > 0 ? (
            <table className="w-full border-collapse text-sm">
              <caption className="mb-1 text-left text-sm font-semibold">
                Amounts allocated entirely to a specific item (allocation exception)
              </caption>
              <thead>
                <tr>
                  <th className={th}>Component</th>
                  <th className={th}>Performance obligation</th>
                  <th className={th}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {layers.specific.map((row) => (
                  <tr key={`${row.componentId}-${row.poId}`}>
                    <td className={td}>{row.description}</td>
                    <td className={td}>{row.poName}</td>
                    <td className={td}>{formatCents(row.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          <Notice>
            A single relative-SSP percentage is not presented for the contract as a whole, because
            amounts allocated under the allocation exception are not allocated on that basis.
          </Notice>
        </Section>
      ) : null}

      <Section title="Variable-consideration reconciliation (engine output)">
        <table className="w-full border-collapse text-sm">
          <tbody>
            <tr>
              <td className={td}>Fixed consideration</td>
              <td className={td}>{formatCents(vc.totals.fixedConsiderationCents)}</td>
            </tr>
            <tr>
              <td className={td}>Initial transaction price (fixed plus constrained estimate)</td>
              <td className={td}>{formatCents(vc.totals.initialTransactionPriceCents)}</td>
            </tr>
            <tr>
              <td className={td}>Current estimated consideration</td>
              <td className={td}>{formatCents(vc.totals.currentEstimatedConsiderationCents)}</td>
            </tr>
            <tr>
              <td className={td}>Usage-as-incurred consideration</td>
              <td className={td}>{formatCents(vc.totals.usageConsiderationCents)}</td>
            </tr>
            <tr>
              <td className={td}>Consideration on exercised material rights</td>
              <td className={td}>{formatCents(vc.totals.exerciseConsiderationCents)}</td>
            </tr>
            <tr className="font-semibold">
              <td className={td}>Total lifecycle consideration</td>
              <td className={td}>{formatCents(vc.totals.lifecycleConsiderationCents)}</td>
            </tr>
            <tr>
              <td className={td}>Scheduled revenue</td>
              <td className={td}>
                {vc.totals.scheduledRevenueCents === null
                  ? "Not available"
                  : formatCents(vc.totals.scheduledRevenueCents)}
              </td>
            </tr>
            <tr>
              <td className={td}>Unscheduled consideration</td>
              <td className={td}>
                {vc.totals.unscheduledConsiderationCents === null
                  ? "Not available"
                  : formatCents(vc.totals.unscheduledConsiderationCents)}
              </td>
            </tr>
            <tr>
              <td className={td}>Difference</td>
              <td className={td}>
                {vc.reconciliation.differenceCents === null
                  ? "Not available"
                  : formatCents(vc.reconciliation.differenceCents)}
              </td>
            </tr>
            <tr>
              <td className={td}>Status</td>
              <td className={td}>
                {vc.reconciliation.reconciled === null
                  ? "Not available"
                  : vc.reconciliation.reconciled
                    ? "Reconciled"
                    : "Not reconciled"}
              </td>
            </tr>
          </tbody>
        </table>
      </Section>
    </>
  );
}
