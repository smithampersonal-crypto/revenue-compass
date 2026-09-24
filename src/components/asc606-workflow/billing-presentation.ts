import { formatCents } from "@/lib/asc606";
import {
  parseUsdToCents,
  type CashCollectionDraft,
  type ConsiderationEventDraft,
  type ContractBalanceWorkflowResult,
} from "@/lib/asc606-workflow";

export type BalanceIssue = ContractBalanceWorkflowResult["validation"]["issues"][number];

export interface FriendlyBalanceLabels {
  billingById: ReadonlyMap<string, string>;
  cashById: ReadonlyMap<string, string>;
}

export function billingEventLabel(index: number): string {
  return `Billing Event ${index + 1}`;
}

export function cashCollectionLabel(index: number): string {
  return `Cash Collection ${index + 1}`;
}

export function buildFriendlyBalanceLabels(
  events: readonly ConsiderationEventDraft[],
  collections: readonly CashCollectionDraft[],
): FriendlyBalanceLabels {
  return {
    billingById: new Map(events.map((event, index) => [event.id, billingEventLabel(index)])),
    cashById: new Map(
      collections.map((collection, index) => [collection.id, cashCollectionLabel(index)]),
    ),
  };
}

export function billingEventOptionLabel(event: ConsiderationEventDraft, index: number): string {
  const label = billingEventLabel(index);
  const amount = parseUsdToCents(event.amountInput);
  return amount.ok ? `${label} — ${formatCents(amount.cents)}` : label;
}

type IssueOwner = { kind: "billing" | "cash"; id: string };

/**
 * Presentation-only ownership recognition for the exact prefixes emitted by
 * validateContractBalanceDraft. This is not an identity fallback: unfamiliar
 * message shapes remain global rather than being guessed from free-form copy.
 */
function exactIssueOwner(issue: BalanceIssue, labels: FriendlyBalanceLabels): IssueOwner | null {
  const billing = /^Billing event ([^:]+): /.exec(issue.message);
  if (billing?.[1] && labels.billingById.has(billing[1])) {
    return { kind: "billing", id: billing[1] };
  }
  const cash = /^Cash collection ([^:]+): /.exec(issue.message);
  if (cash?.[1] && labels.cashById.has(cash[1])) {
    return { kind: "cash", id: cash[1] };
  }
  return null;
}

function issueWithoutExactOwnerPrefix(issue: BalanceIssue, owner: IssueOwner): BalanceIssue {
  const prefix =
    owner.kind === "billing" ? `Billing event ${owner.id}: ` : `Cash collection ${owner.id}: `;
  return { ...issue, message: issue.message.slice(prefix.length) };
}

export interface GroupedBalanceIssues {
  billing: ReadonlyMap<string, BalanceIssue[]>;
  cash: ReadonlyMap<string, BalanceIssue[]>;
  global: BalanceIssue[];
}

export function groupBalanceIssues(
  issues: readonly BalanceIssue[],
  labels: FriendlyBalanceLabels,
): GroupedBalanceIssues {
  const billing = new Map<string, BalanceIssue[]>();
  const cash = new Map<string, BalanceIssue[]>();
  const global: BalanceIssue[] = [];

  for (const issue of issues) {
    const owner = exactIssueOwner(issue, labels);
    if (!owner) {
      global.push(issue);
      continue;
    }
    const groups = owner.kind === "billing" ? billing : cash;
    const current = groups.get(owner.id) ?? [];
    groups.set(owner.id, [...current, issueWithoutExactOwnerPrefix(issue, owner)]);
  }

  return { billing, cash, global };
}

/** Rewrites only the engine's exact quoted billing-reference pattern. */
export function presentGlobalBalanceIssue(
  issue: BalanceIssue,
  labels: FriendlyBalanceLabels,
): BalanceIssue {
  const match = /^(.*billing event ")([^"]+)(".*)$/i.exec(issue.message);
  if (!match?.[1] || !match[2] || !match[3]) return issue;
  const visibleReference = labels.billingById.get(match[2]) ?? "Unavailable billing event";
  return { ...issue, message: `${match[1]}${visibleReference}${match[3]}` };
}
