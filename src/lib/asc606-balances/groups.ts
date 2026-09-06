/**
 * Phase 5C grouped contract balances.
 *
 * A separate-contract modification creates two contracts for presentation.
 * Each presentation group runs through the SAME approved single-contract
 * balance engine independently; the combined view then aggregates the group
 * results GROSS. Contract assets of one group are never netted against
 * contract liabilities of another.
 */

import { monthRange, type MonthKey } from "@/lib/asc606";

import { analyzeContractBalances } from "./index";
import type {
  ContractBalanceAnalysis,
  ContractBalanceInput,
  MonthlyContractBalanceRow,
} from "./types";

export interface ContractBalanceGroupInput {
  groupId: string;
  label: string;
  input: ContractBalanceInput;
}

export interface ContractBalanceGroupResult {
  groupId: string;
  label: string;
  analysis: ContractBalanceAnalysis;
}

export interface GroupedContractBalanceAnalysis {
  groups: ContractBalanceGroupResult[];
  /** Gross aggregation across groups; null when any group is blocked. */
  combinedMonthly: MonthlyContractBalanceRow[] | null;
  combinedTransactionPriceCents: number;
  combinedRevenueCents: number | null;
  /** true only when every group reconciles. */
  reconciled: boolean | null;
}

const FLOWS = [
  "revenueCents",
  "unconditionalRightsCents",
  "invoicesIssuedCents",
  "cashCollectedCents",
] as const;

const STOCKS = [
  "cumulativeRevenueCents",
  "cumulativeUnconditionalRightsCents",
  "cumulativeInvoicesIssuedCents",
  "cumulativeCashCollectedCents",
  "billedArCents",
  "unbilledArCents",
  "totalArCents",
  "contractAssetCents",
  "contractLiabilityCents",
] as const;

export function analyzeGroupedContractBalances(
  groups: readonly ContractBalanceGroupInput[],
): GroupedContractBalanceAnalysis {
  const results: ContractBalanceGroupResult[] = groups.map((group) => ({
    groupId: group.groupId,
    label: group.label,
    analysis: analyzeContractBalances(group.input),
  }));

  const combinedTransactionPriceCents = groups.reduce(
    (total, group) => total + group.input.transactionPriceCents,
    0,
  );

  const blocked = results.some(
    (result) => result.analysis.monthly === null || result.analysis.reconciliation.reconciled !== true,
  );
  if (blocked) {
    return {
      groups: results,
      combinedMonthly: null,
      combinedTransactionPriceCents,
      combinedRevenueCents: null,
      reconciled: null,
    };
  }

  const months = new Set<MonthKey>();
  for (const result of results) for (const row of result.analysis.monthly!) months.add(row.month);
  const sorted = [...months].sort();
  const allMonths =
    sorted.length > 0 ? monthRange(sorted[0]!, sorted[sorted.length - 1]!) : [];

  const byGroup = results.map(
    (result) => new Map(result.analysis.monthly!.map((row) => [row.month, row])),
  );
  const carry = results.map(() => null as MonthlyContractBalanceRow | null);

  const combinedMonthly: MonthlyContractBalanceRow[] = allMonths.map((month) => {
    const row: MonthlyContractBalanceRow = {
      month,
      revenueCents: 0,
      cumulativeRevenueCents: 0,
      unconditionalRightsCents: 0,
      cumulativeUnconditionalRightsCents: 0,
      invoicesIssuedCents: 0,
      cumulativeInvoicesIssuedCents: 0,
      cashCollectedCents: 0,
      cumulativeCashCollectedCents: 0,
      billedArCents: 0,
      unbilledArCents: 0,
      totalArCents: 0,
      contractAssetCents: 0,
      contractLiabilityCents: 0,
    };
    byGroup.forEach((map, index) => {
      const groupRow = map.get(month);
      if (groupRow) carry[index] = groupRow;
      const current = groupRow ?? carry[index];
      if (!current) return;
      if (groupRow) for (const key of FLOWS) row[key] += groupRow[key];
      for (const key of STOCKS) row[key] += current[key];
    });
    return row;
  });

  const combinedRevenueCents = results.reduce(
    (total, result) => total + (result.analysis.reconciliation.totalRevenueCents ?? 0),
    0,
  );

  return {
    groups: results,
    combinedMonthly,
    combinedTransactionPriceCents,
    combinedRevenueCents,
    reconciled: true,
  };
}
