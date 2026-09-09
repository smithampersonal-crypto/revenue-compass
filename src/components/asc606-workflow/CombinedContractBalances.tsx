import { formatCents } from "@/lib/asc606";
import type { GroupedContractBalanceAnalysis } from "@/lib/asc606-balances";

import { Section, td, th } from "./fields";

/**
 * Phase 5C combined gross balance presentation. Each group is determined
 * independently by the engine; this table only displays the engine's gross
 * aggregation. Contract assets are never offset against contract liabilities.
 */
export function CombinedContractBalances({ grouped }: { grouped: GroupedContractBalanceAnalysis }) {
  if (!grouped.combinedMonthly) return null;
  return (
    <Section
      title="Combined contract balances — gross presentation"
      description="The sum of each contract's separately determined balances. Contract assets and contract liabilities are added gross and are never offset against each other."
    >
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className={th}>Month</th>
              <th className={th}>Revenue</th>
              <th className={th}>Unconditional rights</th>
              <th className={th}>Invoices</th>
              <th className={th}>Cash</th>
              <th className={th}>Billed AR</th>
              <th className={th}>Unbilled AR</th>
              <th className={th}>Total AR</th>
              <th className={th}>Contract asset (gross)</th>
              <th className={th}>Contract liability (gross)</th>
            </tr>
          </thead>
          <tbody>
            {grouped.combinedMonthly.map((row) => (
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
      <p className="text-sm">
        <span className="font-semibold">Combined transaction price: </span>
        {formatCents(grouped.combinedTransactionPriceCents)}
        {grouped.combinedRevenueCents !== null ? (
          <>
            {" · "}
            <span className="font-semibold">Combined revenue recognized: </span>
            {formatCents(grouped.combinedRevenueCents)}
          </>
        ) : null}
      </p>
    </Section>
  );
}
