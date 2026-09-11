import { createFileRoute } from "@tanstack/react-router";

import { useAnalysis } from "@/components/arc/analysis-context";
import { ContractBalancesView } from "@/components/arc/ContractBalancesView";

export const Route = createFileRoute("/analysis/balances")({
  head: () => ({
    meta: [
      { title: "Contract Balances — Ayden's Revenue Compass" },
      {
        name: "description",
        content: "Review billing, receivables and gross ASC 606 contract balances.",
      },
      { property: "og:title", content: "Contract Balances — Ayden's Revenue Compass" },
      {
        property: "og:description",
        content: "Review billing, receivables and gross ASC 606 contract balances.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "/analysis/balances" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "/analysis/balances" }],
  }),
  component: ContractBalancesArea,
});

function ContractBalancesArea() {
  const { draft, setDraft, result, workpaper } = useAnalysis();
  return (
    <ContractBalancesView
      draft={draft}
      result={result}
      balances={workpaper.balances}
      onChange={setDraft}
    />
  );
}
