import { createFileRoute, Link } from "@tanstack/react-router";

import { PublicAppShell } from "@/components/arc/PublicAppShell";
const TITLE = "ASC 606 Analysis Platform — Ayden's Revenue Compass";
const DESCRIPTION =
  "Work from accountant-owned ASC 606 judgments through deterministic allocation, revenue schedules, contract balances and journal entries.";

const PRINCIPLES = [
  {
    title: "Accountant-owned judgments",
    description: "You make the ASC 606 conclusions. ARC structures and documents them.",
  },
  {
    title: "Deterministic calculations",
    description:
      "Allocation, schedules, balances and journals are produced by tested calculation engines rather than generated accounting math.",
  },
  {
    title: "Traceable workpaper",
    description:
      "Move from contract analysis through revenue, balances and journal entries in one consistent workspace.",
  },
] as const;

const OUTPUTS = [
  "ASC 606 Analysis",
  "Revenue Schedule",
  "Contract Balances",
  "Journal Entries",
  "Review & Finalize",
] as const;

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "/" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "/" }],
  }),
  component: Index,
});

function Index() {
  return (
    <PublicAppShell>
      <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <header className="max-w-4xl">
          <p className="text-xs font-semibold uppercase text-primary">
            ARC · ASC 606 Analysis Platform
          </p>
          <h1 className="mt-4 text-3xl font-bold leading-tight text-foreground sm:text-5xl">
            ASC 606 analysis, from contract judgment to journal entry.
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg">
            Work through accountant-owned judgments and produce deterministic allocation, revenue
            schedules, contract balances and journal entries.
          </p>
        </header>

        <section aria-label="Get started" className="mt-9 grid gap-4 md:grid-cols-2">
          <article className="flex flex-col border-t-2 border-primary bg-card p-5 sm:p-6">
            <h2 className="text-lg font-semibold text-foreground">Analyze Your Contract</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Enter contract facts and accounting judgments in the ARC workspace.
            </p>
            <Link
              to="/analysis"
              className="mt-5 inline-flex min-h-10 w-fit items-center justify-center rounded-md border border-primary bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring"
            >
              Start Analysis
            </Link>
          </article>

          <article className="flex flex-col border-t-2 border-border bg-card p-5 sm:p-6">
            <h2 className="text-lg font-semibold text-foreground">Try a Sample Contract</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Explore a fictional ASC 606 analysis using ARC&apos;s deterministic engines.
            </p>
            <Link
              to="/analysis"
              search={{ sample: "redwood" }}
              className="mt-5 inline-flex min-h-10 w-fit items-center justify-center rounded-md border border-input bg-secondary px-4 py-2 text-sm font-semibold text-secondary-foreground transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            >
              Try the Sample
            </Link>
          </article>
        </section>

        <section className="mt-12 border-t border-border pt-8">
          <div className="mb-5">
            <p className="text-xs font-semibold uppercase text-primary">Why ARC</p>
            <h2 className="mt-2 text-2xl font-semibold text-foreground">Built for accountable analysis</h2>
          </div>
          <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-3">
            {PRINCIPLES.map((principle) => (
              <article key={principle.title} className="bg-card p-5">
                <h3 className="text-sm font-semibold text-foreground">{principle.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {principle.description}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-12 border-t border-border pt-8">
          <p className="text-xs font-semibold uppercase text-primary">Workpaper outputs</p>
          <h2 className="mt-2 text-2xl font-semibold text-foreground">What ARC produces</h2>
          <ul className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {OUTPUTS.map((output, index) => (
              <li key={output} className="border-l border-border py-2 pl-3">
                <span className="block text-xs tabular-nums text-muted-foreground">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="mt-1 block text-sm font-medium text-foreground">{output}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </PublicAppShell>
  );
}
