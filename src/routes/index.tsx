import { createFileRoute, Link } from "@tanstack/react-router";

import { DEMO_SCENARIOS } from "@/lib/demo-scenarios";

const TITLE = "Revenue Compass — ASC 606 Contract Analysis";
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
    <main className="mx-auto max-w-5xl space-y-8 p-6">
      <header className="space-y-3">
        <h1 className="text-3xl font-bold text-foreground">Revenue Compass</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          ASC 606 contract analysis from accounting judgments through revenue, contract balances and
          journal entries.
        </p>
        <Link
          to="/analysis"
          className="inline-block rounded-md border border-primary bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
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
              className="flex flex-col gap-2 rounded-md border border-border p-4"
            >
              <h3 className="text-sm font-semibold text-foreground">{scenario.customer}</h3>
              <p className="text-xs font-medium text-muted-foreground">{scenario.headline}</p>
              <p className="text-sm text-muted-foreground">{scenario.description}</p>
              <Link
                to="/analysis"
                search={{ sample: scenario.id }}
                className="mt-auto inline-block w-fit rounded-md border border-border px-3 py-1 text-sm hover:bg-accent"
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
  );
}
