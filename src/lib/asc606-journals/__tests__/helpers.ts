import {
  analyzePhase1,
  type PerformanceObligationInput,
  type RevenueSchedule,
} from "@/lib/asc606";
import type {
  CashCollectionEvent,
  ConsiderationEvent,
  ContractBalanceInput,
} from "@/lib/asc606-balances";
import type { JournalEntry } from "../index";

export function schedule(pos: PerformanceObligationInput[], priceCents: number): RevenueSchedule {
  const analysis = analyzePhase1({
    transactionPriceCents: priceCents,
    performanceObligations: pos,
  });
  if (!analysis.revenueSchedule) {
    throw new Error(`fixture schedule invalid: ${analysis.validation.blockingFailures.map((f) => f.id).join(",")}`);
  }
  return analysis.revenueSchedule;
}

export function pointInTimePo(
  id: string,
  seq: number,
  amountCents: number,
  recognitionDate: string,
): PerformanceObligationInput {
  return {
    id,
    seq,
    name: id,
    sspCents: amountCents,
    recognitionMethod: "point_in_time",
    recognitionDate,
  };
}

export function ratablePo(
  id: string,
  seq: number,
  sspCents: number,
  serviceStart: string,
  serviceEnd: string,
): PerformanceObligationInput {
  return {
    id,
    seq,
    name: id,
    sspCents,
    recognitionMethod: "over_time_ratable",
    serviceStart,
    serviceEnd,
  };
}

export function ce(
  id: string,
  seq: number,
  amountCents: number,
  unconditionalRightDate: string,
  invoiceDate: string,
): ConsiderationEvent {
  return { id, seq, amountCents, unconditionalRightDate, invoiceDate };
}

export function cc(
  id: string,
  seq: number,
  considerationEventId: string,
  amountCents: number,
  collectionDate: string,
): CashCollectionEvent {
  return { id, seq, considerationEventId, amountCents, collectionDate };
}

/** Horizon Logistics — approved Phase 3 Acceptance Scenario A facts. */
export function horizonInput(): ContractBalanceInput {
  const pos = [
    ratablePo("po-saas", 1, 14_400_000, "2027-07-01", "2028-06-30"),
    ratablePo("po-training", 2, 1_200_000, "2027-07-10", "2027-07-11"),
    ratablePo("po-support", 3, 2_400_000, "2027-07-01", "2028-06-30"),
  ];
  return {
    transactionPriceCents: 15_300_000,
    revenueSchedule: schedule(pos, 15_300_000),
    considerationEvents: [
      ce("ce-1", 1, 7_500_000, "2027-07-01", "2027-07-01"),
      ce("ce-2", 2, 3_900_000, "2028-01-01", "2028-01-01"),
      ce("ce-3", 3, 3_900_000, "2028-04-01", "2028-04-01"),
    ],
    cashCollections: [
      cc("cc-1", 1, "ce-1", 7_500_000, "2027-07-31"),
      cc("cc-2", 2, "ce-2", 3_900_000, "2028-03-15"),
      cc("cc-3", 3, "ce-3", 3_900_000, "2028-04-30"),
    ],
  };
}

/** Stellar / Case 5 — approved Phase 3 Acceptance Scenario B facts. */
export function stellarInput(): ContractBalanceInput {
  const pos = [ratablePo("po-saas", 1, 24_000_000, "2027-01-01", "2027-12-31")];
  const quarters = [
    { id: "q1", right: "2027-03-31", invoice: "2027-04-01", cash: "2027-04-30" },
    { id: "q2", right: "2027-06-30", invoice: "2027-07-01", cash: "2027-07-31" },
    { id: "q3", right: "2027-09-30", invoice: "2027-10-01", cash: "2027-10-31" },
    { id: "q4", right: "2027-12-31", invoice: "2028-01-01", cash: "2028-01-31" },
  ];
  return {
    transactionPriceCents: 24_000_000,
    revenueSchedule: schedule(pos, 24_000_000),
    considerationEvents: quarters.map((q, i) => ce(q.id, i + 1, 6_000_000, q.right, q.invoice)),
    cashCollections: quarters.map((q, i) => cc(`cash-${q.id}`, i + 1, q.id, 6_000_000, q.cash)),
  };
}

/** Compact readable form of an entry: [account, debit, credit, poId?]. */
export function linesOf(entry: JournalEntry): [string, number, number, string | undefined][] {
  return entry.lines.map((l) => [l.account, l.debitCents, l.creditCents, l.poId ?? undefined]);
}

export function entryAt(
  entries: JournalEntry[],
  date: string,
  eventType: JournalEntry["eventType"],
  sourceId?: string,
): JournalEntry {
  const found = entries.find(
    (e) =>
      e.date === date &&
      e.eventType === eventType &&
      (sourceId === undefined || e.sourceId === sourceId),
  );
  if (!found) throw new Error(`no ${eventType} entry on ${date}`);
  return found;
}
