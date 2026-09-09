import type { WorkflowDraft } from "@/lib/asc606-workflow";
import { analyzeContractBalanceWorkflow, analyzeWorkflow } from "@/lib/asc606-workflow";

import { BillingAndBalances } from "@/components/asc606-workflow/BillingAndBalances";
import { CombinedContractBalances } from "@/components/asc606-workflow/CombinedContractBalances";
import { ContractBalanceOutputs } from "@/components/asc606-workflow/ContractBalanceOutputs";
import { IssueList, Notice, Section } from "@/components/asc606-workflow/fields";

/**
 * Contract Balances parent area: the editable billing/cash workpaper followed
 * by the deterministic engine output. The editor renders inputs only; every
 * engine balance output is rendered here exactly once — one per presentation
 * group for grouped Phase 5C contracts, one for an ordinary contract.
 */
export function ContractBalancesView({
  draft,
  onChange,
}: {
  draft: WorkflowDraft;
  onChange: (draft: WorkflowDraft) => void;
}) {
  const balances = analyzeContractBalanceWorkflow(draft);
  // Presentation-only selection: distinguishes "the five-step draft is not yet
  // complete" from "the billing workpaper itself is incomplete". No accounting.
  const revenueComplete = analyzeWorkflow(draft).finalized;

  if (balances.finalized && balances.grouped) {
    return (
      <div className="space-y-6">
        <BillingAndBalances draft={draft} onChange={onChange} />
        {balances.grouped.groups.map((group) => (
          <div key={group.groupId} className="space-y-4">
            <Section
              title={`Billing, receivables and contract balances — ${group.label}`}
              description="Each contract is presented separately. Contract assets of one contract are never offset against contract liabilities of another."
            >
              <Notice>
                Contract asset and contract liability are determined from cumulative revenue versus
                cumulative unconditional rights to consideration for this contract only.
              </Notice>
            </Section>
            <ContractBalanceOutputs analysis={group.analysis} />
          </div>
        ))}
        <CombinedContractBalances grouped={balances.grouped} />
      </div>
    );
  }

  if (balances.finalized && balances.analysis) {
    return (
      <div className="space-y-6">
        <BillingAndBalances draft={draft} onChange={onChange} />
        <ContractBalanceOutputs analysis={balances.analysis} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <BillingAndBalances draft={draft} onChange={onChange} />
      <Section title="Billing, receivables and contract balances">
        <Notice tone="warning">
          {revenueComplete
            ? "The Billing & Contract Balances workpaper is incomplete, so no billing schedule or contract-balance rollforward is presented. The ASC 606 five-step revenue analysis is unaffected."
            : "The ASC 606 five-step draft analysis must be complete before the Billing & Contract Balances workpaper can be produced."}
        </Notice>
        <IssueList
          title="Outstanding billing and contract-balance items"
          tone="warning"
          issues={balances.validation.blocking}
        />
      </Section>
    </div>
  );
}
