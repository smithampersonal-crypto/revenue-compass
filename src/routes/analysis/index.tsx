import { createFileRoute } from "@tanstack/react-router";

import { useAnalysis } from "@/components/arc/analysis-context";
import { ContractModifications } from "@/components/asc606-workflow/ContractModifications";
import { Step1Contract } from "@/components/asc606-workflow/Step1Contract";
import { Step2PerformanceObligations } from "@/components/asc606-workflow/Step2PerformanceObligations";
import { Step2Promises } from "@/components/asc606-workflow/Step2Promises";
import { Step3TransactionPrice } from "@/components/asc606-workflow/Step3TransactionPrice";
import { Step4Allocation } from "@/components/asc606-workflow/Step4Allocation";
import { Step5Recognition } from "@/components/asc606-workflow/Step5Recognition";

export const Route = createFileRoute("/analysis/")({
  component: Asc606AnalysisArea,
});

function Asc606AnalysisArea() {
  const { draft, setDraft } = useAnalysis();

  return (
    <div className="space-y-8">
      <Step1Contract draft={draft} onChange={setDraft} />
      <Step2Promises draft={draft} onChange={setDraft} />
      <Step2PerformanceObligations draft={draft} onChange={setDraft} />
      <Step3TransactionPrice draft={draft} onChange={setDraft} />
      <Step4Allocation draft={draft} onChange={setDraft} />
      <Step5Recognition draft={draft} onChange={setDraft} />
      <ContractModifications draft={draft} onChange={setDraft} />
    </div>
  );
}
