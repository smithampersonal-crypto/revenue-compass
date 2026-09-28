import { createFileRoute } from "@tanstack/react-router";

import { PublicAppShell } from "@/components/arc/PublicAppShell";
import { StartAnalysisButton } from "@/components/arc/StartAnalysisButton";
import { DEMO_SCENARIOS } from "@/lib/demo-scenarios";

const TITLE = "New Analysis — Ayden's Revenue Compass";
const DESCRIPTION =
  "Start a new ASC 606 analysis: upload a contract PDF, enter the contract details yourself, or open a sample contract.";

export const Route = createFileRoute("/analysis_/new")({
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
  component: NewAnalysisPage,
});

/**
 * Package 3D-T chooser. Visiting this page creates nothing: every option is a
 * button, and only a click starts exactly one temporary analysis.
 */
function NewAnalysisPage() {
  return (
    <PublicAppShell>
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        <h1 className="text-2xl font-bold text-foreground sm:text-3xl">New Analysis</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Each new analysis is kept separately. Your other analyses stay in Recent Analyses.
        </p>

        <section aria-label="Ways to start" className="mt-8 grid gap-4 md:grid-cols-2">
          <article className="flex flex-col border-t-2 border-primary bg-card p-5 sm:p-6">
            <h2 className="text-lg font-semibold text-foreground">Upload a Contract PDF</h2>
            <p className="mt-2 flex-1 text-sm leading-6 text-muted-foreground">
              Start from the contract document and let AI interpret it for your review.
            </p>
            <div className="mt-5">
              <StartAnalysisButton origin="upload" destination="upload">
                Upload PDF
              </StartAnalysisButton>
            </div>
          </article>
          <article className="flex flex-col border-t-2 border-border bg-card p-5 sm:p-6">
            <h2 className="text-lg font-semibold text-foreground">Enter Contract Details Manually</h2>
            <p className="mt-2 flex-1 text-sm leading-6 text-muted-foreground">
              Enter contract facts and accounting judgments directly.
            </p>
            <div className="mt-5">
              <StartAnalysisButton origin="blank" variant="outline">
                Start Manually
              </StartAnalysisButton>
            </div>
          </article>
        </section>

        <section aria-labelledby="samples-heading" className="mt-10">
          <h2 id="samples-heading" className="text-lg font-semibold text-foreground">
            Or open a sample contract
          </h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {DEMO_SCENARIOS.map((scenario) => (
              <li key={scenario.id} className="flex flex-col rounded-md border border-border bg-card p-4">
                <p className="text-sm font-semibold text-foreground">{scenario.customer}</p>
                <p className="text-xs text-muted-foreground">{scenario.headline}</p>
                <p className="mt-2 flex-1 text-sm text-muted-foreground">{scenario.description}</p>
                <div className="mt-3">
                  <StartAnalysisButton origin={`sample:${scenario.id}`} variant="outline">
                    Open sample
                  </StartAnalysisButton>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </PublicAppShell>
  );
}
