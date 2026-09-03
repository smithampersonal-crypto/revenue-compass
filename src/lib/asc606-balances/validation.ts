/**
 * Phase 3 defense-in-depth validation.
 *
 * The balance engine independently validates its own inputs and never relies
 * on the workflow layer having done so. All monetary aggregation is exact
 * BigInt arithmetic.
 */

import { isValidIsoDate, MAX_CENTS } from "@/lib/asc606";
import type {
  BalanceCheckResult,
  BalanceValidationOutcome,
  ContractBalanceInput,
} from "./types";

export function validateContractBalanceInput(
  input: ContractBalanceInput,
): BalanceValidationOutcome {
  const results: BalanceCheckResult[] = [];
  const fail = (
    id: string,
    category: BalanceCheckResult["category"],
    message: string,
    severity: BalanceCheckResult["severity"] = "blocking",
  ) => results.push({ id, category, severity, message, passed: false });

  const events = input.considerationEvents;
  const cash = input.cashCollections;

  // ---- Revenue schedule integrity ----------------------------------------
  // The balance engine never trusts the upstream revenue schedule: an
  // internally inconsistent schedule must block every authoritative output.
  validateRevenueSchedule(input, fail);

  // ---- Consideration events ----------------------------------------------
  const ids = events.map((e) => (e.id ?? "").trim());
  if (ids.some((id) => id === "")) {
    fail("consideration.id.empty", "consideration", "Every billing event needs a non-empty identifier.");
  }
  const nonEmptyIds = ids.filter((id) => id !== "");
  if (new Set(nonEmptyIds).size !== nonEmptyIds.length) {
    fail("consideration.id.unique", "consideration", "Billing event identifiers must be unique.");
  }
  const seqs = events.map((e) => e.seq);
  if (seqs.some((s) => !Number.isInteger(s) || s <= 0)) {
    fail("consideration.seq.valid", "consideration", "Every billing event sequence must be a positive whole number.");
  }
  const validSeqs = seqs.filter((s) => Number.isInteger(s) && s > 0);
  if (new Set(validSeqs).size !== validSeqs.length) {
    fail("consideration.seq.unique", "consideration", "Billing event sequences must be unique.");
  }
  const amountValid = (value: unknown): value is number =>
    typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    Math.abs(value) <= MAX_CENTS;
  if (events.some((e) => !amountValid(e.amountCents))) {
    fail(
      "consideration.amount.valid",
      "consideration",
      "Every billing event amount must be a supported whole-cent amount greater than zero.",
    );
  }
  if (events.some((e) => !isValidIsoDate(e.unconditionalRightDate))) {
    fail(
      "consideration.unconditional_right_date.valid",
      "consideration",
      "Every billing event needs a valid date on which the right to consideration becomes unconditional.",
    );
  }
  if (events.some((e) => !isValidIsoDate(e.invoiceDate))) {
    fail("consideration.invoice_date.valid", "consideration", "Every billing event needs a valid invoice date.");
  }

  let totalEvents = 0n;
  for (const e of events) if (amountValid(e.amountCents)) totalEvents += BigInt(e.amountCents);
  if (totalEvents > BigInt(MAX_CENTS)) {
    fail(
      "consideration.total.supported_range",
      "consideration",
      "The aggregate billing event amount exceeds the supported monetary range.",
    );
  }
  if (events.length === 0) {
    fail("consideration.exists", "consideration", "Enter at least one billing event.");
  }
  const priceValid = amountValid(input.transactionPriceCents);
  if (!priceValid) {
    fail("consideration.transaction_price.valid", "consideration", "The transaction price is not a supported whole-cent amount.");
  } else if (events.length > 0 && totalEvents !== BigInt(input.transactionPriceCents)) {
    fail(
      "consideration.total.equals_transaction_price",
      "consideration",
      "Total billing events must equal the contract transaction price exactly before the contract-balance workpaper can be finalized.",
    );
  }

  // ---- Cash collections ---------------------------------------------------
  const cashIds = cash.map((c) => (c.id ?? "").trim());
  if (cashIds.some((id) => id === "")) {
    fail("cash.id.empty", "cash", "Every cash collection needs a non-empty identifier.");
  }
  const nonEmptyCashIds = cashIds.filter((id) => id !== "");
  if (new Set(nonEmptyCashIds).size !== nonEmptyCashIds.length) {
    fail("cash.id.unique", "cash", "Cash collection identifiers must be unique.");
  }
  const cashSeqs = cash.map((c) => c.seq);
  if (cashSeqs.some((s) => !Number.isInteger(s) || s <= 0)) {
    fail("cash.seq.valid", "cash", "Every cash collection sequence must be a positive whole number.");
  }
  const validCashSeqs = cashSeqs.filter((s) => Number.isInteger(s) && s > 0);
  if (new Set(validCashSeqs).size !== validCashSeqs.length) {
    fail("cash.seq.unique", "cash", "Cash collection sequences must be unique.");
  }
  if (cash.some((c) => !amountValid(c.amountCents))) {
    fail("cash.amount.valid", "cash", "Every cash collection must be a supported whole-cent amount greater than zero.");
  }
  if (cash.some((c) => !isValidIsoDate(c.collectionDate))) {
    fail("cash.collection_date.valid", "cash", "Every cash collection needs a valid collection date.");
  }

  const byId = new Map(events.map((e) => [e.id, e]));
  if (cash.some((c) => !byId.has(c.considerationEventId))) {
    fail("cash.event_reference.valid", "cash", "Every cash collection must reference an existing billing event.");
  }

  let cashBeforeInvoice = false;
  let cashBeforeRight = false;
  const appliedByEvent = new Map<string, bigint>();
  for (const c of cash) {
    const event = byId.get(c.considerationEventId);
    if (!event) continue;
    if (isValidIsoDate(c.collectionDate) && isValidIsoDate(event.invoiceDate) && c.collectionDate < event.invoiceDate) {
      cashBeforeInvoice = true;
    }
    if (
      isValidIsoDate(c.collectionDate) &&
      isValidIsoDate(event.unconditionalRightDate) &&
      c.collectionDate < event.unconditionalRightDate
    ) {
      cashBeforeRight = true;
    }
    if (amountValid(c.amountCents)) {
      appliedByEvent.set(
        event.id,
        (appliedByEvent.get(event.id) ?? 0n) + BigInt(c.amountCents),
      );
    }
  }
  if (cashBeforeInvoice) {
    fail(
      "cash.before_invoice_date",
      "cash",
      "Cash collected before the invoice date is not supported in this phase (customer deposits and advance receipts are out of scope).",
    );
  }
  if (cashBeforeRight) {
    fail(
      "cash.before_unconditional_right_date",
      "cash",
      "Cash collected before the right to consideration becomes unconditional is not supported in this phase.",
    );
  }
  for (const [eventId, applied] of appliedByEvent) {
    const event = byId.get(eventId)!;
    if (amountValid(event.amountCents) && applied > BigInt(event.amountCents)) {
      fail(
        "cash.exceeds_event_amount",
        "cash",
        `Cash collected against billing event "${eventId}" exceeds the billing event amount.`,
      );
      break;
    }
  }

  const blockingFailures = results.filter((r) => r.severity === "blocking" && !r.passed);
  return {
    status: blockingFailures.length > 0 ? "attention" : "passed",
    results,
    blockingFailures,
  };
}
