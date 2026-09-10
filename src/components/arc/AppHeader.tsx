import { Link } from "@tanstack/react-router";
import { Compass } from "lucide-react";

import { FEATURES } from "@/lib/arc/features";

import { AccountMenu } from "./AccountMenu";

const TOP_LEVEL_NAVIGATION = [
  { label: "Analyze", to: "/analysis" as const, enabled: true },
  { label: "Case Studies", to: null, enabled: FEATURES.CASE_STUDIES_EXPANDED },
  { label: "Guidance Library", to: null, enabled: FEATURES.GUIDANCE_LIBRARY },
] as const;

export function AppHeader() {
  return (
    <header className="border-b border-border bg-card/70">
      <div className="mx-auto flex min-h-16 max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <Link
          to="/"
          aria-label="Ayden's Revenue Compass home"
          className="group inline-flex min-w-0 items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-primary/40 bg-primary/15 text-primary transition-colors group-hover:bg-primary/20">
            <Compass aria-hidden="true" className="size-5" strokeWidth={1.8} />
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-sm font-semibold text-foreground sm:text-base">
              Ayden&apos;s Revenue Compass
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              ASC 606 Analysis Platform
            </span>
          </span>
        </Link>

        <div className="flex flex-wrap items-center gap-2">
          <nav aria-label="Primary navigation">
            <ul className="flex items-center gap-1">
              {TOP_LEVEL_NAVIGATION.map((item) =>
                item.enabled && item.to ? (
                  <li key={item.label}>
                    <Link
                      to={item.to}
                      className="inline-flex min-h-9 items-center rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                      activeProps={{ className: "bg-accent text-foreground" }}
                    >
                      {item.label}
                    </Link>
                  </li>
                ) : null,
              )}
            </ul>
          </nav>

          <AccountMenu />
        </div>
      </div>
    </header>
  );
}
