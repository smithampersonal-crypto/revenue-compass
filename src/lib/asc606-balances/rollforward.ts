/**
 * Deterministic monthly contract-balance rollforward.
 *
 * Accounting rules implemented here (and nowhere else in the application):
 *  - Revenue comes straight from the approved ASC 606 revenue schedule.
 *  - Contract asset / contract liability = cumulative revenue vs cumulative
 *    unconditional rights, at the contract level. Invoicing and cash are
 *    irrelevant to that comparison.
 *  - Receivables are determined event by event at each calendar month-end:
 *    right not yet unconditional → no AR; unconditional but not invoiced →
 *    unbilled AR; unconditional and invoiced → billed AR.
 *  - All arithmetic is integer cents; aggregation and invariants use BigInt.
 */

import { accountingHorizon, monthEnd, monthKeyOf, monthRange, type MonthKey } from "@/lib/asc606";
import {
  ContractBalanceError,
  type BillingScheduleRow,
  type ContractBalanceInput,
  type MonthlyContractBalanceRow,
} from "./types";

export function buildBillingSchedule(input: ContractBalanceInput): BillingScheduleRow[] {
  const collected = new Map<string, bigint>();
  for (const c of input.cashCollections) {
    collected.set(
      c.considerationEventId,
      (collected.get(c.considerationEventId) ?? 0n) + BigInt(c.amountCents),
    );
  }
  return [...input.considerationEvents]
    .sort((a, b) => a.seq - b.seq)
    .map((event) => {
      const cash = collected.get(event.id) ?? 0n;
      const outstanding = BigInt(event.amountCents) - cash;
      if (outstanding < 0n) {
        throw new ContractBalanceError(
          `receivable invariant violated: billing event "${event.id}" is over-collected`,
        );
      }
      return {
        seq: event.seq,
        eventId: event.id,
        amountCents: event.amountCents,
        unconditionalRightDate: event.unconditionalRightDate,
        invoiceDate: event.invoiceDate,
        cashCollectedCents: Number(cash),
        outstandingCents: Number(outstanding),
      };
    });
}

/**
 * Continuous monthly horizon spanning revenue recognition plus every
 * unconditional-right, invoice and cash-collection month.
 */
export function contractBalanceMonths(input: ContractBalanceInput): MonthKey[] {
  const revenueMonths = input.revenueSchedule.byMonth.map((row) => row.month);
  const eventMonths = input.considerationEvents.flatMap((e) => [
    monthKeyOf(e.unconditionalRightDate),
    monthKeyOf(e.invoiceDate),
  ]);
  const cashMonths = input.cashCollections.map((c) => monthKeyOf(c.collectionDate));
  const horizon = accountingHorizon([revenueMonths, eventMonths, cashMonths]);
  if (!horizon) return [];
  // Defense in depth: refuse an unsupported horizon before enumerating months.
  if (exceedsSupportedHorizon(horizon.firstMonth, horizon.lastMonth)) {
    throw new ContractBalanceError(
      `accounting horizon exceeds the supported ${MAX_SUPPORTED_ACCOUNTING_HORIZON_MONTHS}-month range`,
    );
  }
  return monthRange(horizon.firstMonth, horizon.lastMonth);
}

export function buildMonthlyRollforward(input: ContractBalanceInput): MonthlyContractBalanceRow[] {
  const months = contractBalanceMonths(input);
  const revenueByMonth = new Map(
    input.revenueSchedule.byMonth.map((row) => [row.month, BigInt(row.totalCents)]),
  );

  const rows: MonthlyContractBalanceRow[] = [];
  let cumRevenue = 0n;
  let cumRights = 0n;
  let cumInvoices = 0n;
  let cumCash = 0n;

  for (const month of months) {
    const end = monthEnd(month);

    const revenue = revenueByMonth.get(month) ?? 0n;
    let rights = 0n;
    let invoices = 0n;
    let cash = 0n;

    for (const event of input.considerationEvents) {
      if (monthKeyOf(event.unconditionalRightDate) === month) rights += BigInt(event.amountCents);
      if (monthKeyOf(event.invoiceDate) === month) invoices += BigInt(event.amountCents);
    }
    for (const collection of input.cashCollections) {
      if (monthKeyOf(collection.collectionDate) === month) cash += BigInt(collection.amountCents);
    }

    cumRevenue += revenue;
    cumRights += rights;
    cumInvoices += invoices;
    cumCash += cash;

    // Event-by-event receivable position as of this month-end.
    let billed = 0n;
    let unbilled = 0n;
    for (const event of input.considerationEvents) {
      if (event.unconditionalRightDate > end) continue; // right still conditional
      let applied = 0n;
      for (const collection of input.cashCollections) {
        if (collection.considerationEventId !== event.id) continue;
        if (collection.collectionDate <= end) applied += BigInt(collection.amountCents);
      }
      const outstanding = BigInt(event.amountCents) - applied;
      if (outstanding < 0n) {
        throw new ContractBalanceError(
          `receivable invariant violated: billing event "${event.id}" is over-collected at ${month}`,
        );
      }
      if (event.invoiceDate <= end) billed += outstanding;
      else unbilled += outstanding;
    }

    const net = cumRevenue - cumRights;
    const contractAsset = net > 0n ? net : 0n;
    const contractLiability = net < 0n ? -net : 0n;
    const totalAr = billed + unbilled;

    // Defense in depth: never return an unreconciled monthly position.
    if (billed < 0n || unbilled < 0n || contractAsset < 0n || contractLiability < 0n) {
      throw new ContractBalanceError(`negative balance invariant violated at ${month}`);
    }
    if (contractAsset > 0n && contractLiability > 0n) {
      throw new ContractBalanceError(
        `contract asset and contract liability are both positive at ${month}`,
      );
    }
    if (totalAr !== cumRights - cumCash) {
      throw new ContractBalanceError(`receivable rollforward invariant violated at ${month}`);
    }
    if (cumRevenue + contractLiability !== cumRights + contractAsset) {
      throw new ContractBalanceError(`contract position invariant violated at ${month}`);
    }
    if (billed + unbilled + contractAsset - contractLiability !== cumRevenue - cumCash) {
      throw new ContractBalanceError(`balance-sheet bridge invariant violated at ${month}`);
    }

    rows.push({
      month,
      revenueCents: Number(revenue),
      cumulativeRevenueCents: Number(cumRevenue),
      unconditionalRightsCents: Number(rights),
      cumulativeUnconditionalRightsCents: Number(cumRights),
      invoicesIssuedCents: Number(invoices),
      cumulativeInvoicesIssuedCents: Number(cumInvoices),
      cashCollectedCents: Number(cash),
      cumulativeCashCollectedCents: Number(cumCash),
      billedArCents: Number(billed),
      unbilledArCents: Number(unbilled),
      totalArCents: Number(totalAr),
      contractAssetCents: Number(contractAsset),
      contractLiabilityCents: Number(contractLiability),
    });
  }

  return rows;
}
