import { formatCents } from "@/lib/asc606";
import type { ContractBalanceAnalysis } from "@/lib/asc606-balances";

import { Notice, Section, td, th } from "./fields";

/**
 * Read-only presentation of deterministic Phase 3 engine output. Every amount
 * shown here is produced by the contract-balance engine; this component only
 * formats cents.
 */
export function ContractBalanceOutputs({ analysis }: { analysis: ContractBalanceAnalysis }) {
  const { billingSchedule, monthly, reconciliation } = analysis;

  return (
    <div className="space-y-6">
      <Section title="Billing schedule (engine output)">
        {billingSchedule ? (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={th}>Event</th>
                <th className={th}>Amount</th>
                <th className={th}>Unconditional right date</th>
                <th className={th}>Invoice date</th>
                <th className={th}>Cash collected</th>
                <th className={th}>Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {billingSchedule.map((row) => (
                <tr key={row.eventId}>
                  <td className={td}>
                    {row.seq}. {row.eventId}
                  </td>
                  <td className={td}>{formatCents(row.amountCents)}</td>
                  <td className={td}>{row.unconditionalRightDate}</td>
                  <td className={td}>{row.invoiceDate}</td>
                  <td className={td}>{formatCents(row.cashCollectedCents)}</td>
                  <td className={td}>{formatCents(row.outstandingCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Notice tone="danger">No finalized billing schedule is presented.</Notice>
        )}
      </Section>

      <Section title="Monthly contract-balance rollforward (engine output)">
        {monthly ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className={th}>Month</th>
                  <th className={th}>Revenue</th>
                  <th className={th}>Unconditional rights arising</th>
                  <th className={th}>Invoices issued</th>
                  <th className={th}>Cash collected</th>
                  <th className={th}>Billed AR</th>
                  <th className={th}>Unbilled AR</th>
                  <th className={th}>Total AR</th>
                  <th className={th}>Contract asset</th>
                  <th className={th}>Contract liability (deferred revenue)</th>
                </tr>
              </thead>
              <tbody>
                {monthly.map((row) => (
                  <tr key={row.month}>
                    <td className={td}>{row.month}</td>
                    <td className={td}>{formatCents(row.revenueCents)}</td>
                    <td className={td}>{formatCents(row.unconditionalRightsCents)}</td>
                    <td className={td}>{formatCents(row.invoicesIssuedCents)}</td>
                    <td className={td}>{formatCents(row.cashCollectedCents)}</td>
                    <td className={td}>{formatCents(row.billedArCents)}</td>
                    <td className={td}>{formatCents(row.unbilledArCents)}</td>
                    <td className={td}>{formatCents(row.totalArCents)}</td>
                    <td className={td}>{formatCents(row.contractAssetCents)}</td>
                    <td className={td}>{formatCents(row.contractLiabilityCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Notice tone="danger">No finalized contract-balance rollforward is presented.</Notice>
        )}
      </Section>

      {monthly ? (
        <Section title="Cumulative amounts (engine output)">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className={th}>Month</th>
                  <th className={th}>Cumulative revenue</th>
                  <th className={th}>Cumulative unconditional rights</th>
                  <th className={th}>Cumulative invoices issued</th>
                  <th className={th}>Cumulative cash collected</th>
                </tr>
              </thead>
              <tbody>
                {monthly.map((row) => (
                  <tr key={row.month}>
                    <td className={td}>{row.month}</td>
                    <td className={td}>{formatCents(row.cumulativeRevenueCents)}</td>
                    <td className={td}>{formatCents(row.cumulativeUnconditionalRightsCents)}</td>
                    <td className={td}>{formatCents(row.cumulativeInvoicesIssuedCents)}</td>
                    <td className={td}>{formatCents(row.cumulativeCashCollectedCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ) : null}

      <Section title="Contract-balance reconciliation (engine output)">
        <table className="w-full border-collapse text-sm">
          <tbody>
            <tr>
              <td className={td}>Transaction price</td>
              <td className={td}>{formatCents(reconciliation.transactionPriceCents)}</td>
            </tr>
            <tr>
              <td className={td}>Total billing events</td>
              <td className={td}>{formatCents(reconciliation.totalConsiderationEventsCents)}</td>
            </tr>
            <tr>
              <td className={td}>Total revenue recognized</td>
              <td className={td}>
                {reconciliation.totalRevenueCents === null
                  ? "Not available"
                  : formatCents(reconciliation.totalRevenueCents)}
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
            <tr>
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
    </div>
  );
}
