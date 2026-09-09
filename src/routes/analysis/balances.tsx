import { createFileRoute } from "@tanstack/react-router";

import { useAnalysis } from "@/components/arc/analysis-context";
import { BillingAndBalances } from "@/components/asc606-workflow/BillingAndBalances";
import { ContractBalanceOutputs } from "@/components/asc606-workflow/ContractBalanceOutputs";
import { IssueList, Notice, Section } from "@/components/asc606-workflow/fields";
import { analyzeContractBalanceWorkflow } from "@/lib/asc606-workflow";

export const Route = createFileRoute("/analysis/balances")({
  component: ContractBalancesArea,
});

function ContractBalancesArea() {
  const { draft, setDraft } = useAnalysis();
  const balances = analyzeContractBalanceWorkflow(draft);

  return (
    <div className="space-y-6">
      <BillingAndBalances draft={draft} onChange={setDraft} />

      {balances.finalized && balances.analysis ? (
        <ContractBalanceOutputs analysis={balances.analysis} />
      ) : (
        <Section title="Billing, receivables and contract balances">
          <Notice tone="warning">
            The billing and contract-balance workpaper is incomplete, so no billing schedule or
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
