import { createFileRoute } from "@tanstack/react-router";

import { useAnalysis } from "@/components/arc/analysis-context";
import { ContractBalancesView } from "@/components/arc/ContractBalancesView";

export const Route = createFileRoute("/analysis/balances")({
  component: ContractBalancesArea,
});

function ContractBalancesArea() {
  const { draft, setDraft } = useAnalysis();
  return <ContractBalancesView draft={draft} onChange={setDraft} />;
}
