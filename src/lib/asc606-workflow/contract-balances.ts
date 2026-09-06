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
  type ContractBalanceInput,
} from "@/lib/asc606-balances";
import {
  analyzeGroupedContractBalances,
  type ContractBalanceGroupInput,
  type GroupedContractBalanceAnalysis,
} from "@/lib/asc606-balances";
import { ORIGINAL_GROUP_ID } from "@/lib/asc606-contract-modifications";
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
  /** Exact normalized input used for the Phase 3 engine; null unless finalized. */
  engineInput: ContractBalanceInput | null;
  /**
   * Phase 5C: one normalized engine input per contract presentation group.
   * A single-contract analysis produces exactly one entry.
   */
  groupInputs: ContractBalanceGroupInput[];
  /** Phase 5C grouped output; null unless more than one group exists. */
  grouped: GroupedContractBalanceAnalysis | null;
}

function outcome(issues: ContractBalanceIssue[]): ContractBalanceValidationOutcome {
  return {
    issues,
    blocking: issues.filter((i) => i.severity === "blocking"),
    warnings: issues.filter((i) => i.severity === "warning"),
  };
}

/** Draft-level completeness checks. Monetary rules stay in the engine. */
export function validateContractBalanceDraft(
  draft: WorkflowDraft,
): ContractBalanceValidationOutcome {
  const issues: ContractBalanceIssue[] = [];
  const add = (
    id: string,
    message: string,
    severity: ContractBalanceIssue["severity"] = "blocking",
  ) => issues.push({ id, severity, message });

  const { considerationEvents, cashCollections } = draft.contractBalances;

  if (considerationEvents.length === 0) {
    add("billing.events.exists", "Enter at least one billing event.");
  }
  for (const event of considerationEvents) {
    const label = event.id || `sequence ${event.seq}`;
    const source = event.amountSource ?? "manual";
    if (source === "manual") {
      const amount = parseUsdToCents(event.amountInput);
      if (!amount.ok) add("billing.event.amount", `Billing event ${label}: ${amount.error}`);
      else if (amount.cents <= 0)
        add("billing.event.amount", `Billing event ${label}: amount must be greater than zero.`);
    } else {
      // Phase 5B: a source-linked amount is derived by the engine, so only the
      // link itself is validated here.
      if (!event.sourceComponentId) {
        add(
          "billing.event.source",
          `Billing event ${label}: select the variable-consideration component it bills.`,
        );
      }
      if (source === "usage_period" && !/^\d{4}-\d{2}$/.test(event.sourceMonth ?? "")) {
        add(
          "billing.event.source_month",
          `Billing event ${label}: select the usage month it bills.`,
        );
      }
    }
    if (!isValidIsoDate(event.unconditionalRightDate)) {
      add(
        "billing.event.right_date",
        `Billing event ${label}: enter the date the right to consideration becomes unconditional.`,
      );
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
    else if (amount.cents <= 0)
      add("cash.amount", `Cash collection ${label}: amount must be greater than zero.`);
    if (!isValidIsoDate(collection.collectionDate)) {
      add("cash.collection_date", `Cash collection ${label}: enter a valid collection date.`);
    }
  }

  return outcome(issues);
}

/**
 * Phase 5B: a source-linked billing amount is taken directly from the
 * deterministic variable-consideration engine, never re-entered or
 * recalculated by this layer or by React.
 */
export function resolveConsiderationEventAmount(
  event: WorkflowDraft["contractBalances"]["considerationEvents"][number],
  revenue: ReturnType<typeof analyzeWorkflow>,
  issues: ContractBalanceIssue[],
): number {
  const label = event.id || `sequence ${event.seq}`;
  const source = event.amountSource ?? "manual";
  if (source === "manual") {
    const amount = parseUsdToCents(event.amountInput);
    return amount.ok ? amount.cents : Number.NaN;
  }

  const vc = revenue.variableConsideration;
  if (vc === null) {
    issues.push({
      id: "billing.event.source",
      severity: "blocking",
      message: `Billing event ${label}: the contract has no variable-consideration component to bill.`,
    });
    return Number.NaN;
  }

  if (source === "estimated_component") {
    const component = vc.components.find((c) => c.componentId === event.sourceComponentId);
    if (!component) {
      issues.push({
        id: "billing.event.source",
        severity: "blocking",
        message: `Billing event ${label}: the linked variable-consideration component no longer exists.`,
      });
      return Number.NaN;
    }
    return component.currentIncludedCents;
  }

  const period = vc.usagePeriods.find(
    (p) => p.componentId === event.sourceComponentId && p.month === event.sourceMonth,
  );
  if (!period) {
    issues.push({
      id: "billing.event.source_month",
      severity: "blocking",
      message: `Billing event ${label}: no usage has been recorded for the linked month.`,
    });
    return Number.NaN;
  }
  return period.totalCents;
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
    engineInput: null,
    groupInputs: [],
    grouped: null,
  });

  const revenue = analyzeWorkflow(draft);
  if (
    !revenue.finalized ||
    !revenue.revenueSchedule ||
    revenue.lifecycleConsiderationCents === null
  ) {
    return blocked(
      "The ASC 606 Steps 1-5 revenue analysis is not finalized, so no authoritative billing and contract-balance workpaper is produced.",
    );
  }
  if (draftValidation.blocking.length > 0) {
    return blocked("The billing and contract-balance inputs are incomplete.");
  }

  const sourceIssues: ContractBalanceIssue[] = [];
  const considerationEvents: ConsiderationEvent[] = draft.contractBalances.considerationEvents.map(
    (event) => {
      const amountCents = resolveConsiderationEventAmount(event, revenue, sourceIssues);
      return {
        id: event.id,
        seq: event.seq,
        amountCents,
        unconditionalRightDate: event.unconditionalRightDate,
        invoiceDate: event.invoiceDate,
      };
    },
  );
  if (sourceIssues.length > 0) {
    return blocked(
      "A billing event is linked to a variable-consideration amount that is not determinable.",
      outcome([...draftValidation.issues, ...sourceIssues]),
    );
  }
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

  // ---- Phase 5C: a separate-contract modification produces two contracts --
  const groups = revenue.contractGroups;
  if (groups.length > 1) {
    // Remediation item 11: with more than one contract presentation group a
    // billing event must name its contract. A blank link is an ambiguity and a
    // link to a group that no longer exists is a stale link; both block. An
    // unassigned event is NEVER silently posted to the original contract.
    const knownGroupIds = new Set(groups.map((group) => group.id));
    const groupLinkIssues: ContractBalanceIssue[] = [];
    for (const draftEvent of draft.contractBalances.considerationEvents) {
      const linked = draftEvent.contractGroupId;
      if (!linked) {
        groupLinkIssues.push({
          id: `billing.group.missing.${draftEvent.id}`,
          severity: "blocking",
          message: `Billing event ${draftEvent.seq} is not assigned to a contract. This arrangement contains more than one contract, so the contract must be selected.`,
        });
      } else if (!knownGroupIds.has(linked)) {
        groupLinkIssues.push({
          id: `billing.group.stale.${draftEvent.id}`,
          severity: "blocking",
          message: `Billing event ${draftEvent.seq} is linked to a contract that no longer exists in this analysis.`,
        });
      }
    }
    if (groupLinkIssues.length > 0) {
      const blockedValidation = outcome([...draftValidation.issues, ...groupLinkIssues]);
      return {
        validation: blockedValidation,
        finalized: false,
        blockedReason:
          "Every billing event must name the contract it belongs to before contract balances are presented.",
        analysis: null,
        engineInput: null,
        engineValidation: null,
        groupInputs: [],
        grouped: null,
      };
    }

    const groupInputs: ContractBalanceGroupInput[] = groups.map((group) => {
      const groupEvents = considerationEvents.filter((event, index) => {
        const draftEvent = draft.contractBalances.considerationEvents[index]!;
        return draftEvent.contractGroupId === group.id;
      });
      const eventIds = new Set(groupEvents.map((event) => event.id));
      return {
        groupId: group.id,
        label: group.label,
        input: {
          transactionPriceCents: group.transactionPriceCents,
          revenueSchedule: group.revenueSchedule,
          considerationEvents: groupEvents,
          cashCollections: cashCollections.filter((cash) =>
            eventIds.has(cash.considerationEventId),
          ),
          unscheduledRevenueCents: group.unscheduledRevenueCents,
        },
      };
    });

    const grouped = analyzeGroupedContractBalances(groupInputs);
    const groupIssues: ContractBalanceIssue[] = grouped.groups.flatMap((result) =>
      result.analysis.validation.results
        .filter((r) => !r.passed)
        .map((r) => ({
          id: `${result.groupId}.${r.id}`,
          severity: r.severity,
          message: `${result.label}: ${r.message}`,
        })),
    );
    const mergedGrouped = outcome([...draftValidation.issues, ...groupIssues]);
    if (grouped.reconciled !== true) {
      return {
        validation: mergedGrouped,
        finalized: false,
        blockedReason:
          "The deterministic contract-balance engine reported a blocking issue in at least one contract, so no authoritative billing schedule or rollforward is presented.",
        engineValidation: grouped.groups[0]?.analysis.validation ?? null,
        analysis: null,
        engineInput: null,
        groupInputs,
        grouped,
      };
    }
    return {
      validation: mergedGrouped,
      finalized: true,
      blockedReason: null,
      engineValidation: grouped.groups[0]!.analysis.validation,
      analysis: grouped.groups[0]!.analysis,
      engineInput: null,
      groupInputs,
      grouped,
    };
  }

  const engineInput: ContractBalanceInput = {
    // With material rights this is the lifecycle consideration: the original
    // transaction price plus consideration arising on exercised options.
    transactionPriceCents: revenue.lifecycleConsiderationCents,
    revenueSchedule: revenue.revenueSchedule,
    considerationEvents,
    cashCollections,
    unscheduledRevenueCents: revenue.unscheduledRevenueCents,
  };
  const analysis = analyzeBalances(engineInput);

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
    engineInput,
    groupInputs: [
      {
        groupId: groups[0]?.id ?? ORIGINAL_GROUP_ID,
        label: groups[0]?.label ?? "Contract",
        input: engineInput,
      },
    ],
    grouped: null,
  };
}
