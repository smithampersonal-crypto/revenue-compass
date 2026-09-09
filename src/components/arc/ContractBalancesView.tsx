import type { WorkflowAnalysisResult, WorkflowDraft } from "@/lib/asc606-workflow";
import { analyzeContractBalanceWorkflow } from "@/lib/asc606-workflow";

import { BillingAndBalances } from "@/components/asc606-workflow/BillingAndBalances";
import { CombinedContractBalances } from "@/components/asc606-workflow/CombinedContractBalances";
import { ContractBalanceOutputs } from "@/components/asc606-workflow/ContractBalanceOutputs";
import { Notice, Section } from "@/components/asc606-workflow/fields";

/**
 * Contract Balances parent area: the editable billing/cash workpaper followed
 * by the deterministic engine output. The balance workflow is evaluated exactly
 * once here and passed down; the editor renders inputs and the single blocking
 * issue list. Every engine balance output is rendered here exactly once — one
 * per presentation group for grouped Phase 5C contracts, one for an ordinary
 * contract.
 */
export function ContractBalancesView({
  draft,
  result,
  onChange,
}: {
  draft: WorkflowDraft;
  /** Authoritative five-step analysis from AnalysisProvider. */
  result: WorkflowAnalysisResult;
  onChange: (draft: WorkflowDraft) => void;
}) {
  const balances = analyzeContractBalanceWorkflow(draft);
  // Presentation-only selection: distinguishes "the five-step draft is not yet
  // complete" from "the billing workpaper itself is incomplete". No accounting.
  const revenueComplete = result.finalized;

  const editor = (
    <BillingAndBalances
      draft={draft}
      onChange={onChange}
      balances={balances}
      contractGroups={result.contractGroups}
    />
  );

  if (balances.finalized && balances.grouped) {
    return (
      <div className="space-y-6">
        {editor}
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
        {editor}
        <ContractBalanceOutputs analysis={balances.analysis} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {editor}
      <Section title="Billing, receivables and contract balances">
        <Notice tone="warning">
          {revenueComplete
            ? "The Billing & Contract Balances workpaper is incomplete, so no billing schedule or contract-balance rollforward is presented. The outstanding items are listed with the workpaper inputs above. The ASC 606 five-step revenue analysis is unaffected."
            : "The ASC 606 five-step draft analysis must be complete before the Billing & Contract Balances workpaper can be produced."}
        </Notice>
      </Section>
    </div>
  );
}
