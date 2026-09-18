import { createFileRoute } from "@tanstack/react-router";

import { AiReviewTargetProvider } from "@/components/arc/AiReviewTarget";
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

export function ContractBalancesArea() {
  const { draft, setDraft, result, workpaper, ai } = useAnalysis();
  return (
    <AiReviewTargetProvider workspace={ai.workspace}>
      <ContractBalancesView
        draft={draft}
        result={result}
        balances={workpaper.balances}
        onChange={setDraft}
      />
    </AiReviewTargetProvider>
  );
}
