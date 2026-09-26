import { createFileRoute, Link } from "@tanstack/react-router";

import { PublicAppShell } from "@/components/arc/PublicAppShell";

const TITLE = "Sitemap — Ayden's Revenue Compass";
const DESCRIPTION = "All main pages of Ayden's Revenue Compass (ARC) in one place.";

export const Route = createFileRoute("/sitemap")({
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
  component: SitemapPage,
});

const LINK =
  "text-sm font-medium text-foreground underline-offset-2 hover:text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring";

function Note({ children }: { children: string }) {
  return <span className="ml-2 text-xs text-muted-foreground">{children}</span>;
}

function SitemapPage() {
  return (
    <PublicAppShell>
      <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-10 sm:px-6 sm:py-14">
        <h1 className="text-3xl font-bold text-foreground">Sitemap</h1>
        <ul className="divide-y divide-border rounded-md border border-border bg-card">
          <li className="px-4 py-3">
            <Link to="/" className={LINK}>
              Home
            </Link>
          </li>
          <li className="px-4 py-3">
            <Link to="/analysis" className={LINK}>
              Analyze Contract
            </Link>
          </li>
          <li className="px-4 py-3">
            <Link to="/analysis" search={{ sample: "horizon" }} className={LINK}>
              Horizon Sample
            </Link>
          </li>
          <li className="px-4 py-3">
            <Link to="/auth" className={LINK}>
              Sign in
            </Link>
          </li>
          <li className="px-4 py-3">
            <Link to="/workspace" className={LINK}>
              My Contracts
            </Link>
            <Note>Sign-in required</Note>
          </li>
          <li className="px-4 py-3">
            <Link to="/account" className={LINK}>
              Account Settings
            </Link>
            <Note>Sign-in required</Note>
          </li>
          <li className="px-4 py-3">
            <Link to="/privacy" className={LINK}>
              Privacy
            </Link>
          </li>
          <li className="px-4 py-3">
            <Link to="/sitemap" className={LINK}>
              Sitemap
            </Link>
          </li>
        </ul>
      </main>
    </PublicAppShell>
  );
}
