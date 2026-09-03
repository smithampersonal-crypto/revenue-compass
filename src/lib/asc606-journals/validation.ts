/**
 * Phase 4A validation.
 *
 * Phase 3 owns contract-balance validation; Phase 4A adds only the checks it
 * newly depends on — the per-performance-obligation revenue split. All
 * aggregation is exact BigInt arithmetic.
 */

import { MAX_CENTS } from "@/lib/asc606";
import type { ContractBalanceAnalysis, ContractBalanceInput } from "@/lib/asc606-balances";
import type { JournalCheckResult, JournalValidationOutcome } from "./types";

export function validateJournalInput(
  input: ContractBalanceInput,
  balances: ContractBalanceAnalysis,
): JournalValidationOutcome {
  const results: JournalCheckResult[] = [];
  const fail = (id: string, category: JournalCheckResult["category"], message: string) =>
    results.push({ id, category, severity: "blocking", message, passed: false });

  if (balances.validation.blockingFailures.length > 0) {
    fail(
      "phase3.validation.blocking",
      "phase3",
      "The approved contract-balance engine reported blocking validation failures.",
    );
  }
  if (balances.monthly === null || balances.billingSchedule === null) {
    fail(
      "phase3.outputs.present",
      "phase3",
      "The approved contract-balance engine produced no authoritative billing schedule or rollforward.",
    );
  }
  if (balances.reconciliation.reconciled !== true) {
    fail(
      "phase3.reconciliation.reconciled",
      "phase3",
      "The approved contract-balance engine did not report a reconciled contract.",
    );
  }

  const rows = input.revenueSchedule?.byMonth ?? [];
  let poIdsValid = true;
  let amountsValid = true;
  for (const row of rows) {
    for (const [poId, amount] of Object.entries(row.perPo ?? {})) {
      if (typeof poId !== "string" || poId.trim() === "") poIdsValid = false;
      if (
        typeof amount !== "number" ||
        !Number.isInteger(amount) ||
        amount < 0 ||
        amount > MAX_CENTS
      ) {
        amountsValid = false;
      }
    }
  }
  if (!poIdsValid) {
    fail(
      "revenue_split.po_id.valid",
      "revenue_split",
      "Every performance obligation in the monthly revenue split needs a non-empty identifier.",
    );
  }
  if (!amountsValid) {
    fail(
      "revenue_split.amount.valid",
      "revenue_split",
      "Every performance-obligation revenue amount must be a nonnegative whole-cent amount within the supported monetary range.",
    );
  }
  if (poIdsValid && amountsValid) {
    let reconciles = true;
    for (const row of rows) {
      let sum = 0n;
      for (const amount of Object.values(row.perPo ?? {})) sum += BigInt(amount);
      if (sum !== BigInt(row.totalCents)) reconciles = false;
    }
    if (!reconciles) {
      fail(
        "revenue_split.month_total.reconciles",
        "revenue_split",
        "Revenue by performance obligation does not sum to the monthly revenue total.",
      );
    }
  }

  const blockingFailures = results.filter((r) => r.severity === "blocking" && !r.passed);
  return {
    status: blockingFailures.length > 0 ? "attention" : "passed",
    results,
    blockingFailures,
  };
}
