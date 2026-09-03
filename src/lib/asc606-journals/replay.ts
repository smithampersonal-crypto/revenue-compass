/**
 * Deterministic journal replay.
 *
 * Replays generated entries through every Phase 3 month-end and proves that
 * the journal-derived ledger reproduces the approved contract-balance
 * rollforward exactly. All comparisons use BigInt.
 */

import { monthEnd } from "@/lib/asc606";
import type { MonthlyContractBalanceRow } from "@/lib/asc606-balances";
import { JournalEntryError, type JournalEntry, type JournalLedgerMonth } from "./types";

export function replayJournalEntries(
  entries: JournalEntry[],
  monthly: MonthlyContractBalanceRow[],
): JournalLedgerMonth[] {
  let cash = 0n;
  let billed = 0n;
  let unbilled = 0n;
  let asset = 0n;
  let liability = 0n;
  let revenue = 0n;
  const revenueByPo = new Map<string, bigint>();

  let index = 0;
  const ledger: JournalLedgerMonth[] = [];
  let previousCash = 0n;

  for (const row of monthly) {
    const end = monthEnd(row.month);
    while (index < entries.length && entries[index]!.date <= end) {
      for (const line of entries[index]!.lines) {
        const debit = BigInt(line.debitCents);
        const credit = BigInt(line.creditCents);
        switch (line.account) {
          case "cash":
            cash += debit - credit;
            break;
          case "billed_ar":
            billed += debit - credit;
            break;
          case "unbilled_ar":
            unbilled += debit - credit;
            break;
          case "contract_asset":
            asset += debit - credit;
            break;
          case "contract_liability":
            liability += credit - debit;
            break;
          case "revenue": {
            revenue += credit - debit;
            const poId = line.poId ?? "";
            revenueByPo.set(poId, (revenueByPo.get(poId) ?? 0n) + credit - debit);
            break;
          }
        }
      }
      index += 1;
    }

    const tie = (label: string, journal: bigint, phase3: number) => {
      if (journal !== BigInt(phase3)) {
        throw new JournalEntryError(
          `journal replay does not tie to the contract-balance rollforward: ${label} at ${row.month} (journal ${journal}, Phase 3 ${phase3})`,
        );
      }
    };
    tie("billed AR", billed, row.billedArCents);
    tie("unbilled AR", unbilled, row.unbilledArCents);
    tie("contract asset", asset, row.contractAssetCents);
    tie("contract liability", liability, row.contractLiabilityCents);
    tie("cumulative cash", cash, row.cumulativeCashCollectedCents);
    tie("cumulative revenue", revenue, row.cumulativeRevenueCents);

    ledger.push({
      month: row.month,
      cashCents: Number(cash - previousCash),
      billedArCents: Number(billed),
      unbilledArCents: Number(unbilled),
      contractAssetCents: Number(asset),
      contractLiabilityCents: Number(liability),
      cumulativeCashCents: Number(cash),
      cumulativeRevenueCents: Number(revenue),
      revenueByPoCents: Object.fromEntries(
        [...revenueByPo.entries()].map(([poId, amount]) => [poId, Number(amount)]),
      ),
    });
    previousCash = cash;
  }

  if (index !== entries.length) {
    throw new JournalEntryError(
      "journal replay left entries outside the contract-balance accounting horizon",
    );
  }

  return ledger;
}
