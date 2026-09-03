/**
 * Phase 3 workflow layer: converts the accountant's billing draft into the
 * deterministic contract-balance engine input and returns engine output.
 *
 * Separate from Phase 2 on purpose: `analyzeWorkflow(...).finalized` keeps its
 * existing ASC 606 Steps 1-5 meaning, and a missing billing schedule can never
 * un-finalize a correct revenue analysis.
 *
 * React never builds engine inputs and never performs balance accounting.
 */

import { isValidIsoDate } from "@/lib/asc606";
import {
  analyzeContractBalances,
  type BalanceValidationOutcome,
  type CashCollectionEvent,
  type ConsiderationEvent,
  type ContractBalanceAnalysis,
} from "@/lib/asc606-balances";
import { analyzeWorkflow } from "./analysis";
import { parseUsdToCents } from "./money-input";
import type { WorkflowDraft } from "./types";

export interface ContractBalanceIssue {
  id: string;
  severity: "blocking" | "warning";
  message: string;
}

export interface ContractBalanceValidationOutcome {
  issues: ContractBalanceIssue[];
  blocking: ContractBalanceIssue[];
  warnings: ContractBalanceIssue[];
}

export interface ContractBalanceWorkflowResult {
  validation: ContractBalanceValidationOutcome;
  finalized: boolean;
  blockedReason: string | null;
  /** Engine-owned validation, exposed whenever the balance engine ran. */
  engineValidation: BalanceValidationOutcome | null;
  analysis: ContractBalanceAnalysis | null;
}

function outcome(issues: ContractBalanceIssue[]): ContractBalanceValidationOutcome {
  return {
    issues,
    blocking: issues.filter((i) => i.severity === "blocking"),
    warnings: issues.filter((i) => i.severity === "warning"),
  };
}

/** Draft-level completeness checks. Monetary rules stay in the engine. */
export function validateContractBalanceDraft(draft: WorkflowDraft): ContractBalanceValidationOutcome {
  const issues: ContractBalanceIssue[] = [];
  const add = (id: string, message: string, severity: ContractBalanceIssue["severity"] = "blocking") =>
    issues.push({ id, severity, message });

  const { considerationEvents, cashCollections } = draft.contractBalances;

  if (considerationEvents.length === 0) {
    add("billing.events.exists", "Enter at least one billing event.");
  }
  for (const event of considerationEvents) {
    const label = event.id || `sequence ${event.seq}`;
    const amount = parseUsdToCents(event.amountInput);
    if (!amount.ok) add("billing.event.amount", `Billing event ${label}: ${amount.error}`);
    else if (amount.cents <= 0) add("billing.event.amount", `Billing event ${label}: amount must be greater than zero.`);
    if (!isValidIsoDate(event.unconditionalRightDate)) {
      add("billing.event.right_date", `Billing event ${label}: enter the date the right to consideration becomes unconditional.`);
    }
    if (!isValidIsoDate(event.invoiceDate)) {
      add("billing.event.invoice_date", `Billing event ${label}: enter the invoice date.`);
    }
  }

  for (const collection of cashCollections) {
    const label = collection.id || `sequence ${collection.seq}`;
    if (collection.considerationEventId === null || collection.considerationEventId === "") {
      add("cash.event_selected", `Cash collection ${label}: select the related billing event.`);
    }
    const amount = parseUsdToCents(collection.amountInput);
    if (!amount.ok) add("cash.amount", `Cash collection ${label}: ${amount.error}`);
    else if (amount.cents <= 0) add("cash.amount", `Cash collection ${label}: amount must be greater than zero.`);
    if (!isValidIsoDate(collection.collectionDate)) {
      add("cash.collection_date", `Cash collection ${label}: enter a valid collection date.`);
    }
  }

  return outcome(issues);
}

export interface ContractBalanceDeps {
  analyzeBalances?: typeof analyzeContractBalances;
}

export function analyzeContractBalanceWorkflow(
  draft: WorkflowDraft,
  deps: ContractBalanceDeps = {},
): ContractBalanceWorkflowResult {
  const analyzeBalances = deps.analyzeBalances ?? analyzeContractBalances;
  const draftValidation = validateContractBalanceDraft(draft);

  const blocked = (
    reason: string,
    validation: ContractBalanceValidationOutcome = draftValidation,
    engineValidation: BalanceValidationOutcome | null = null,
  ): ContractBalanceWorkflowResult => ({
    validation,
    finalized: false,
    blockedReason: reason,
    engineValidation,
    analysis: null,
  });

  const revenue = analyzeWorkflow(draft);
  if (!revenue.finalized || !revenue.analysis?.revenueSchedule) {
    return blocked(
      "The ASC 606 Steps 1-5 revenue analysis is not finalized, so no authoritative billing and contract-balance workpaper is produced.",
    );
  }
  if (draftValidation.blocking.length > 0) {
    return blocked("The billing and contract-balance inputs are incomplete.");
  }

  const considerationEvents: ConsiderationEvent[] = draft.contractBalances.considerationEvents.map(
    (event) => {
      const amount = parseUsdToCents(event.amountInput);
      return {
        id: event.id,
        seq: event.seq,
        amountCents: amount.ok ? amount.cents : Number.NaN,
        unconditionalRightDate: event.unconditionalRightDate,
        invoiceDate: event.invoiceDate,
      };
    },
  );
  const cashCollections: CashCollectionEvent[] = draft.contractBalances.cashCollections.map(
    (collection) => {
      const amount = parseUsdToCents(collection.amountInput);
      return {
        id: collection.id,
        seq: collection.seq,
        considerationEventId: collection.considerationEventId ?? "",
        amountCents: amount.ok ? amount.cents : Number.NaN,
        collectionDate: collection.collectionDate,
      };
    },
  );

  const analysis = analyzeBalances({
    transactionPriceCents: revenue.analysis.totals.transactionPriceCents,
    revenueSchedule: revenue.analysis.revenueSchedule,
    considerationEvents,
    cashCollections,
  });

  const engineIssues: ContractBalanceIssue[] = analysis.validation.results
    .filter((r) => !r.passed)
    .map((r) => ({ id: r.id, severity: r.severity, message: r.message }));
  const merged = outcome([...draftValidation.issues, ...engineIssues]);

  if (
    analysis.validation.blockingFailures.length > 0 ||
    analysis.monthly === null ||
    analysis.billingSchedule === null ||
    analysis.reconciliation.reconciled !== true
  ) {
    return blocked(
      "The deterministic contract-balance engine reported a blocking issue, so no authoritative billing schedule or rollforward is presented.",
      merged,
      analysis.validation,
    );
  }

  return {
    validation: merged,
    finalized: true,
    blockedReason: null,
    engineValidation: analysis.validation,
    analysis,
  };
}
