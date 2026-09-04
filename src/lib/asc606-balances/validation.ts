/**
 * Phase 3 defense-in-depth validation.
 *
 * The balance engine independently validates its own inputs and never relies
 * on the workflow layer having done so. All monetary aggregation is exact
 * BigInt arithmetic.
 */

import {
  exceedsSupportedHorizon,
  isValidIsoDate,
  monthKeyOf,
  MAX_CENTS,
  MAX_SUPPORTED_ACCOUNTING_HORIZON_MONTHS,
} from "@/lib/asc606";
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

  // ---- Accounting horizon -------------------------------------------------
  // Determined arithmetically from the earliest/latest relevant month; no
  // month list is built, so an absurd date can never drive enumeration.
  validateAccountingHorizon(input, fail);

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

const MONTH_KEY_PATTERN = /^\d{4}-\d{2}$/;

function isValidMonthKey(value: unknown): value is string {
  if (typeof value !== "string" || !MONTH_KEY_PATTERN.test(value)) return false;
  const month = Number(value.slice(5, 7));
  return month >= 1 && month <= 12;
}

type FailFn = (
  id: string,
  category: BalanceCheckResult["category"],
  message: string,
  severity?: BalanceCheckResult["severity"],
) => void;

/**
 * Independent structural validation of the revenue schedule consumed by the
 * balance engine. Monthly rows and the declared total must be internally
 * consistent, and for a complete fixed-consideration contract the total must
 * equal the transaction price. All arithmetic is exact BigInt.
 */
function validateRevenueSchedule(input: ContractBalanceInput, fail: FailFn): void {
  const schedule = input.revenueSchedule;
  if (!schedule || !Array.isArray(schedule.byMonth)) {
    fail("revenue_schedule.present", "revenue_schedule", "A completed revenue schedule is required.");
    return;
  }

  const rows = schedule.byMonth;

  if (rows.some((row) => !isValidMonthKey(row.month))) {
    fail(
      "revenue_schedule.month.valid",
      "revenue_schedule",
      "Every revenue schedule row must have a valid reporting month.",
    );
  }
  const months = rows.map((row) => row.month);
  if (new Set(months).size !== months.length) {
    fail(
      "revenue_schedule.month.unique",
      "revenue_schedule",
      "The revenue schedule contains duplicate reporting months.",
    );
  }

  const amountValid = (value: unknown): value is number =>
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_CENTS;

  const amountsValid = rows.every((row) => amountValid(row.totalCents));
  if (!amountsValid) {
    fail(
      "revenue_schedule.amount.valid",
      "revenue_schedule",
      "Every monthly revenue amount must be a nonnegative whole-cent amount within the supported monetary range.",
    );
  }

  const totalValid =
    typeof schedule.totalCents === "number" &&
    Number.isInteger(schedule.totalCents) &&
    schedule.totalCents >= 0 &&
    schedule.totalCents <= MAX_CENTS;
  if (!totalValid) {
    fail(
      "revenue_schedule.total.valid",
      "revenue_schedule",
      "Total revenue must be a nonnegative whole-cent amount within the supported monetary range.",
    );
  }

  if (!amountsValid || !totalValid) return;

  let sum = 0n;
  for (const row of rows) sum += BigInt(row.totalCents);
  if (sum > BigInt(MAX_CENTS)) {
    fail(
      "revenue_schedule.total.supported_range",
      "revenue_schedule",
      "The aggregate monthly revenue exceeds the supported monetary range.",
    );
    return;
  }
  if (sum !== BigInt(schedule.totalCents)) {
    fail(
      "revenue_schedule.monthly_total.reconciles",
      "revenue_schedule",
      "Monthly revenue does not sum to the total revenue reported by the revenue schedule.",
    );
  }

  // Cumulative metadata, when present, must tie month by month and end at the total.
  let running = 0n;
  let cumulativeBroken = false;
  for (const row of rows) {
    running += BigInt(row.totalCents);
    const cumulative = (row as { cumulativeCents?: unknown }).cumulativeCents;
    if (cumulative === undefined) continue;
    if (typeof cumulative !== "number" || !Number.isInteger(cumulative) || BigInt(cumulative) !== running) {
      cumulativeBroken = true;
    }
  }
  if (cumulativeBroken) {
    fail(
      "revenue_schedule.cumulative.reconciles",
      "revenue_schedule",
      "Cumulative revenue in the revenue schedule does not tie to the monthly revenue amounts.",
    );
  }

  const priceValid =
    typeof input.transactionPriceCents === "number" &&
    Number.isInteger(input.transactionPriceCents);
  const unscheduled = input.unscheduledRevenueCents ?? 0;
  if (!Number.isInteger(unscheduled) || unscheduled < 0) {
    fail(
      "revenue_schedule.unscheduled.valid",
      "revenue_schedule",
      "Unscheduled material-right consideration must be a nonnegative whole-cent amount.",
      );
  } else if (
    priceValid &&
    BigInt(schedule.totalCents) + BigInt(unscheduled) !== BigInt(input.transactionPriceCents)
  ) {
    fail(
      "revenue_schedule.total.equals_transaction_price",
      "revenue_schedule",
      "Scheduled revenue plus unscheduled material-right consideration must equal the contract transaction price exactly.",
    );
  }
}

/**
 * Earliest and latest relevant accounting month across the revenue schedule,
 * unconditional-right dates, invoice dates and cash-collection dates.
 */
function validateAccountingHorizon(input: ContractBalanceInput, fail: FailFn): void {
  const months: string[] = [];
  for (const row of input.revenueSchedule?.byMonth ?? []) {
    if (isValidMonthKey(row.month)) months.push(row.month);
  }
  for (const event of input.considerationEvents ?? []) {
    if (isValidIsoDate(event.unconditionalRightDate)) months.push(monthKeyOf(event.unconditionalRightDate));
    if (isValidIsoDate(event.invoiceDate)) months.push(monthKeyOf(event.invoiceDate));
  }
  for (const collection of input.cashCollections ?? []) {
    if (isValidIsoDate(collection.collectionDate)) months.push(monthKeyOf(collection.collectionDate));
  }
  if (months.length === 0) return;
  const first = months.reduce((a, b) => (a < b ? a : b));
  const last = months.reduce((a, b) => (a > b ? a : b));
  if (exceedsSupportedHorizon(first, last)) {
    fail(
      "accounting_horizon.supported_range",
      "accounting_horizon",
      `Accounting horizon exceeds the current ${MAX_SUPPORTED_ACCOUNTING_HORIZON_MONTHS / 12}-year supported range. Check the entered dates.`,
    );
  }
}
