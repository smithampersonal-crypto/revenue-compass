import { createFileRoute, Link } from "@tanstack/react-router";

import { PublicAppShell } from "@/components/arc/PublicAppShell";
import { DEMO_SCENARIOS } from "@/lib/demo-scenarios";

const TITLE = "Ayden's Revenue Compass — ASC 606 Analysis";
const DESCRIPTION =
  "Work an ASC 606 contract from accounting judgments through revenue, contract balances and journal entries with a deterministic engine.";

export const Route = createFileRoute("/")({
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
  component: Index,
});

function Index() {
  return (
    <PublicAppShell>
      <main className="mx-auto max-w-6xl space-y-10 px-4 py-8 sm:px-6 sm:py-12">
        <header className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">ARC</p>
          <h1 className="text-3xl font-bold text-foreground sm:text-4xl">
            Ayden&apos;s Revenue Compass
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            ASC 606 contract analysis from accounting judgments through revenue, contract balances
            and journal entries.
          </p>
          <Link
            to="/analysis"
            className="inline-flex min-h-10 items-center rounded-md border border-primary bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring"
          >
            Start Blank Analysis
          </Link>
        </header>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Try a Sample Contract</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {DEMO_SCENARIOS.map((scenario) => (
              <div
                key={scenario.id}
                className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4"
              >
                <h3 className="text-sm font-semibold text-foreground">{scenario.customer}</h3>
                <p className="text-xs font-medium text-muted-foreground">{scenario.headline}</p>
                <p className="text-sm text-muted-foreground">{scenario.description}</p>
                <Link
                  to="/analysis"
                  search={{ sample: scenario.id }}
                  className="mt-auto inline-flex min-h-9 w-fit items-center rounded-md border border-input bg-secondary px-3 py-1 text-sm font-medium hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Load Sample
                </Link>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-md border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
          <h2 className="text-sm font-semibold text-foreground">Demo mode</h2>
          <p>Analyses are stored in memory only and are not saved.</p>
          <p>Refreshing the page resets your work.</p>
        </section>
      </main>
    </PublicAppShell>
  );
}
