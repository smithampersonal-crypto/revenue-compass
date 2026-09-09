import type { WorkflowDraft } from "@/lib/asc606-workflow";
import { analyzeContractBalanceWorkflow } from "@/lib/asc606-workflow";

import { BillingAndBalances } from "@/components/asc606-workflow/BillingAndBalances";
import { CombinedContractBalances } from "@/components/asc606-workflow/CombinedContractBalances";
import { ContractBalanceOutputs } from "@/components/asc606-workflow/ContractBalanceOutputs";
import { IssueList, Notice, Section } from "@/components/asc606-workflow/fields";

/**
 * Contract Balances parent area: the editable billing/cash workpaper followed
 * by the deterministic engine output. Grouped Phase 5C contracts stay
 * separately determined and separately displayed, with a gross combined view.
 */
export function ContractBalancesView({
  draft,
  onChange,
}: {
  draft: WorkflowDraft;
  onChange: (draft: WorkflowDraft) => void;
}) {
  const balances = analyzeContractBalanceWorkflow(draft);

  return (
    <div className="space-y-6">
      <BillingAndBalances draft={draft} onChange={onChange} />

      {balances.finalized && balances.grouped ? (
        <>
          {balances.grouped.groups.map((group) =>
            group.analysis.monthly ? (
              <div key={group.groupId} className="space-y-4">
                <Section
                  title={`Billing, receivables and contract balances — ${group.label}`}
                  description="Each contract is presented separately. Contract assets of one contract are never offset against contract liabilities of another."
                >
                  <Notice>
                    Contract asset and contract liability are determined from cumulative revenue
                    versus cumulative unconditional rights to consideration for this contract only.
                  </Notice>
                </Section>
                <ContractBalanceOutputs analysis={group.analysis} />
              </div>
            ) : null,
          )}
          <CombinedContractBalances grouped={balances.grouped} />
        </>
      ) : balances.finalized && balances.analysis ? (
        <>
          <Section
            title="Billing, receivables and contract balances"
            description="A separate post-ASC-606 workpaper. It does not affect the five-step revenue analysis."
          >
            <Notice>
              Contract asset and contract liability are determined from cumulative revenue versus
              cumulative unconditional rights to consideration; invoicing and cash affect only the
              receivable presentation.
            </Notice>
          </Section>
          <ContractBalanceOutputs analysis={balances.analysis} />
        </>
      ) : (
        <Section title="Billing, receivables and contract balances">
          <Notice tone="warning">
            The Billing &amp; Contract Balances workpaper is incomplete, so no billing schedule or
            contract-balance rollforward is presented. The ASC 606 five-step revenue analysis is
            unaffected.
          </Notice>
          {balances.blockedReason ? (
            <p className="text-sm text-muted-foreground">{balances.blockedReason}</p>
          ) : null}
          <IssueList
            title="Outstanding billing and contract-balance items"
            tone="warning"
            issues={balances.validation.blocking}
          />
        </Section>
      )}
    </div>
  );
}
