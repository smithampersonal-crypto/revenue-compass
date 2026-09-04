/**
 * Phase 4A deterministic journal-entry engine — public surface.
 *
 * Consumes the approved Phase 3 contract-balance engine (which itself consumes
 * the approved Phase 1 revenue engine) and converts the resulting accounting
 * events into balanced journal entries. Pure TypeScript: no React, DOM,
 * network, database or AI dependency and no mutable global accounting state.
 */

export * from "./types";
export * from "./validation";
export * from "./generator";
export * from "./replay";

import { analyzeContractBalances, type ContractBalanceInput } from "@/lib/asc606-balances";
import { generateJournalEntries } from "./generator";
import { replayJournalEntries } from "./replay";
import { JournalEntryError, type JournalAnalysis } from "./types";
import { validateJournalInput } from "./validation";

export function analyzeJournalEntries(input: ContractBalanceInput): JournalAnalysis {
  const balances = analyzeContractBalances(input);
  const validation = validateJournalInput(input, balances);

  if (validation.blockingFailures.length > 0) {
    return {
      validation,
      entries: null,
      ledgerByMonth: null,
      reconciliation: {
        allEntriesBalanced: null,
        monthlyBalancesTie: null,
        revenueByPoTies: null,
        sourceEventsComplete: null,
        reconciled: null,
      },
    };
  }

  const monthly = balances.monthly!;
  const entries = generateJournalEntries(input);

  // Every entry balances (generation throws otherwise) — re-proved here.
  for (const entry of entries) {
    let debits = 0n;
    let credits = 0n;
    for (const line of entry.lines) {
      debits += BigInt(line.debitCents);
      credits += BigInt(line.creditCents);
    }
    if (debits !== credits) {
      throw new JournalEntryError(`journal entry "${entry.id}" does not balance`);
    }
  }

  const ledgerByMonth = replayJournalEntries(entries, monthly);

  // Revenue credits must reproduce the approved schedule by PO and by month.
  for (const row of input.revenueSchedule.byMonth) {
    const posted = new Map<string, bigint>();
    for (const entry of entries) {
      if (entry.eventType !== "revenue_recognition" || entry.month !== row.month) continue;
      for (const line of entry.lines) {
        if (line.account !== "revenue") continue;
        posted.set(line.poId!, (posted.get(line.poId!) ?? 0n) + BigInt(line.creditCents));
      }
    }
    for (const [poId, amount] of Object.entries(row.perPo)) {
      if ((posted.get(poId) ?? 0n) !== BigInt(amount)) {
        throw new JournalEntryError(
          `revenue-by-PO invariant violated at ${row.month} for "${poId}"`,
        );
      }
      posted.delete(poId);
    }
    if (posted.size > 0) {
      throw new JournalEntryError(`unexpected revenue credit at ${row.month}`);
    }
  }
  let totalRevenue = 0n;
  for (const entry of entries) {
    for (const line of entry.lines) {
      if (line.account === "revenue") totalRevenue += BigInt(line.creditCents);
    }
  }
  if (
    totalRevenue !== BigInt(input.revenueSchedule.totalCents) ||
    totalRevenue + BigInt(input.unscheduledRevenueCents ?? 0) !==
      BigInt(input.transactionPriceCents)
  ) {
    throw new JournalEntryError(
      "total journal revenue does not tie to the revenue schedule and transaction price",
    );
  }

  // Source-event completeness: no invented and no missing entries.
  const countOf = (type: string, predicate?: (id: string | null) => boolean) =>
    entries.filter((e) => e.eventType === type && (!predicate || predicate(e.sourceId))).length;
  const expectedRevenueEntries = input.revenueSchedule.byMonth.filter(
    (r) => r.totalCents !== 0,
  ).length;
  const expectedReclass = input.considerationEvents.filter(
    (e) => e.invoiceDate > e.unconditionalRightDate,
  ).length;
  if (
    countOf("revenue_recognition") !== expectedRevenueEntries ||
    countOf("unconditional_right") !== input.considerationEvents.length ||
    countOf("invoice_reclassification") !== expectedReclass ||
    countOf("cash_collection") !== input.cashCollections.length ||
    new Set(entries.map((e) => e.id)).size !== entries.length
  ) {
    throw new JournalEntryError("source-event completeness invariant violated");
  }

  return {
    validation,
    entries,
    ledgerByMonth,
    reconciliation: {
      allEntriesBalanced: true,
      monthlyBalancesTie: true,
      revenueByPoTies: true,
      sourceEventsComplete: true,
      reconciled: true,
    },
  };
}
