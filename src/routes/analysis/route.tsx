import { createFileRoute, Link, Outlet } from "@tanstack/react-router";

import { AnalysisNavigation } from "@/components/arc/AnalysisNavigation";
import { AnalysisProvider, useAnalysis } from "@/components/arc/analysis-context";
import { AnalysisSummary } from "@/components/arc/AnalysisSummary";
import { Notice } from "@/components/asc606-workflow/fields";

const TITLE = "ASC 606 Analysis — Ayden's Revenue Compass";
const DESCRIPTION =
  "Work through the ASC 606 five-step revenue recognition model for a SaaS contract and review deterministic allocation, revenue, contract balance and journal output.";

export const Route = createFileRoute("/analysis")({
  validateSearch: (search: Record<string, unknown>): { sample?: string } =>
    typeof search["sample"] === "string" ? { sample: search["sample"] } : {},
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AnalysisLayout,
});

function AnalysisLayout() {
  const { sample } = Route.useSearch();

  return (
    <AnalysisProvider sample={sample}>
      <AnalysisWorkspace />
    </AnalysisProvider>
  );
}

function AnalysisWorkspace() {
  const { unknownSample } = useAnalysis();

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="space-y-2">
        <Link to="/" className="text-sm text-muted-foreground hover:underline">
          ← Back to Home
        </Link>
        <h1 className="text-2xl font-bold text-foreground">ASC 606 Analysis</h1>
        <p className="text-sm text-muted-foreground">
          Enter and review the accounting judgments. All accounting judgments are yours; allocation,
          revenue recognition and reconciliation amounts are produced by the deterministic ASC 606
          engine and are read-only.
        </p>
        <Notice>
          This workspace holds one in-memory analysis. Nothing is saved: refreshing the page clears
          all entered data.
        </Notice>
        {unknownSample ? (
          <Notice>That sample was not recognized, so a blank analysis was opened.</Notice>
        ) : null}
      </header>

      <AnalysisSummary />

      <AnalysisNavigation />

      <Outlet />
    </main>
  );
}
