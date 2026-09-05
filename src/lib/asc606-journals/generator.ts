/**
 * Deterministic journal generation.
 *
 * Accounting rules (Phase 4A):
 *  - Monthly revenue posts at calendar month-end and first consumes any
 *    existing contract liability; any excess creates contract asset. Revenue
 *    credits stay separated by performance obligation.
 *  - An unconditional right debits billed AR when the invoice was issued on or
 *    before the right date, otherwise unbilled AR. The credit side first
 *    clears contract asset, then creates contract liability.
 *  - A later invoice date reclassifies unbilled AR to billed AR.
 *  - Cash debits cash and credits billed AR.
 *  - Same-day ordering: revenue, unconditional right, invoice, cash.
 */

import { monthEnd, monthKeyOf } from "@/lib/asc606";
import type { ContractBalanceInput } from "@/lib/asc606-balances";
import {
  JournalEntryError,
  type JournalEntry,
  type JournalEventType,
  type JournalLine,
} from "./types";

const PRIORITY: Record<JournalEventType, number> = {
  revenue_recognition: 1,
  unconditional_right: 2,
  invoice_reclassification: 3,
  cash_collection: 4,
};

interface PendingOp {
  date: string;
  eventType: JournalEventType;
  seq: number;
  id: string;
  sourceId: string | null;
}

function finalize(
  op: PendingOp,
  description: string,
  lines: JournalLine[],
): JournalEntry {
  let debits = 0n;
  let credits = 0n;
  for (const line of lines) {
    if (line.debitCents < 0 || line.creditCents < 0) {
      throw new JournalEntryError(`negative journal amount in entry "${op.id}"`);
    }
    if (line.debitCents > 0 && line.creditCents > 0) {
      throw new JournalEntryError(`line in entry "${op.id}" carries both a debit and a credit`);
    }
    debits += BigInt(line.debitCents);
    credits += BigInt(line.creditCents);
  }
  if (debits !== credits) {
    throw new JournalEntryError(`journal entry "${op.id}" does not balance`);
  }
  return {
    id: op.id,
    date: op.date,
    month: monthKeyOf(op.date),
    eventType: op.eventType,
    sourceId: op.sourceId,
    description,
    lines,
    totalDebitsCents: Number(debits),
    totalCreditsCents: Number(credits),
  };
}

export function generateJournalEntries(input: ContractBalanceInput): JournalEntry[] {
  const eventById = new Map(input.considerationEvents.map((e) => [e.id, e]));
  const cashById = new Map(input.cashCollections.map((c) => [c.id, c]));
  const revenueByMonth = new Map(input.revenueSchedule.byMonth.map((row) => [row.month, row]));

  // Deterministic performance-obligation ordering, taken from the approved
  // revenue schedule rather than object key iteration order.
  const poOrder: string[] = [];
  for (const row of input.revenueSchedule.byPo) {
    if (!poOrder.includes(row.poId)) poOrder.push(row.poId);
  }
  const poRank = (poId: string) => {
    const index = poOrder.indexOf(poId);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };

  const ops: PendingOp[] = [];
  for (const row of input.revenueSchedule.byMonth) {
    // Phase 5B: a month whose signed source amounts offset to zero still
    // requires a revenue reclassification entry.
    const hasRevenueActivity =
      row.totalCents !== 0 || Object.values(row.perPo ?? {}).some((amount) => amount !== 0);
    if (!hasRevenueActivity) continue;
    ops.push({
      date: monthEnd(row.month),
      eventType: "revenue_recognition",
      seq: 0,
      id: `rev-${row.month}`,
      sourceId: null,
    });
  }
  for (const event of input.considerationEvents) {
    ops.push({
      date: event.unconditionalRightDate,
      eventType: "unconditional_right",
      seq: event.seq,
      id: `right-${event.id}`,
      sourceId: event.id,
    });
    if (event.invoiceDate > event.unconditionalRightDate) {
      ops.push({
        date: event.invoiceDate,
        eventType: "invoice_reclassification",
        seq: event.seq,
        id: `invoice-${event.id}`,
        sourceId: event.id,
      });
    }
  }
  for (const collection of input.cashCollections) {
    ops.push({
      date: collection.collectionDate,
      eventType: "cash_collection",
      seq: collection.seq,
      id: `cash-${collection.id}`,
      sourceId: collection.id,
    });
  }

  ops.sort(
    (a, b) =>
      (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
      PRIORITY[a.eventType] - PRIORITY[b.eventType] ||
      a.seq - b.seq ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  let contractAsset = 0n;
  let contractLiability = 0n;
  const entries: JournalEntry[] = [];

  for (const op of ops) {
    if (op.eventType === "revenue_recognition") {
      const row = revenueByMonth.get(monthKeyOf(op.date))!;
      const revenue = BigInt(row.totalCents);
      const lines: JournalLine[] = [];

      if (revenue > 0n) {
        // Net positive month: consume contract liability first, then create
        // contract asset (approved Phase 4A behavior).
        const liabilityUsed = revenue < contractLiability ? revenue : contractLiability;
        const assetIncrease = revenue - liabilityUsed;
        if (liabilityUsed > 0n) {
          lines.push({
            account: "contract_liability",
            debitCents: Number(liabilityUsed),
            creditCents: 0,
          });
        }
        if (assetIncrease > 0n) {
          lines.push({ account: "contract_asset", debitCents: Number(assetIncrease), creditCents: 0 });
        }
        contractLiability -= liabilityUsed;
        contractAsset += assetIncrease;
      } else if (revenue < 0n) {
        // Net negative month (post-satisfaction reversal): reduce contract
        // asset first, then increase contract liability.
        const magnitude = -revenue;
        const assetReduced = magnitude < contractAsset ? magnitude : contractAsset;
        const liabilityIncrease = magnitude - assetReduced;
        if (assetReduced > 0n) {
          lines.push({ account: "contract_asset", debitCents: 0, creditCents: Number(assetReduced) });
        }
        if (liabilityIncrease > 0n) {
          lines.push({
            account: "contract_liability",
            debitCents: 0,
            creditCents: Number(liabilityIncrease),
          });
        }
        contractAsset -= assetReduced;
        contractLiability += liabilityIncrease;
      }

      for (const [poId, amount] of Object.entries(row.perPo).sort(
        (a, b) => poRank(a[0]) - poRank(b[0]) || (a[0] < b[0] ? -1 : 1),
      )) {
        if (amount === 0) continue;
        // A negative source amount reverses previously recognized revenue.
        lines.push(
          amount > 0
            ? { account: "revenue", debitCents: 0, creditCents: amount, poId }
            : { account: "revenue", debitCents: -amount, creditCents: 0, poId },
        );
      }
      entries.push(finalize(op, `Revenue recognized for ${row.month}`, lines));
      continue;
    }

    if (op.eventType === "unconditional_right") {
      const event = eventById.get(op.sourceId!)!;
      const amount = BigInt(event.amountCents);
      const receivable =
        event.invoiceDate <= event.unconditionalRightDate ? "billed_ar" : "unbilled_ar";
      const assetCleared = amount < contractAsset ? amount : contractAsset;
      const liabilityIncrease = amount - assetCleared;
      const lines: JournalLine[] = [
        { account: receivable, debitCents: Number(amount), creditCents: 0 },
      ];
      if (assetCleared > 0n) {
        lines.push({ account: "contract_asset", debitCents: 0, creditCents: Number(assetCleared) });
      }
      if (liabilityIncrease > 0n) {
        lines.push({
          account: "contract_liability",
          debitCents: 0,
          creditCents: Number(liabilityIncrease),
        });
      }
      contractAsset -= assetCleared;
      contractLiability += liabilityIncrease;
      entries.push(
        finalize(op, `Right to consideration becomes unconditional (${event.id})`, lines),
      );
      continue;
    }

    if (op.eventType === "invoice_reclassification") {
      const event = eventById.get(op.sourceId!)!;
      entries.push(
        finalize(op, `Invoice issued (${event.id})`, [
          { account: "billed_ar", debitCents: event.amountCents, creditCents: 0 },
          { account: "unbilled_ar", debitCents: 0, creditCents: event.amountCents },
        ]),
      );
      continue;
    }

    const collection = cashById.get(op.sourceId!)!;
    entries.push(
      finalize(op, `Cash collected (${collection.id})`, [
        { account: "cash", debitCents: collection.amountCents, creditCents: 0 },
        { account: "billed_ar", debitCents: 0, creditCents: collection.amountCents },
      ]),
    );
  }

  return entries;
}
