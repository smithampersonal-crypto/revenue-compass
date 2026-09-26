import { Link } from "@tanstack/react-router";

import arcLogo from "@/assets/arc-logo.svg";
import { FEATURES } from "@/lib/arc/features";

import { AccountMenu } from "./AccountMenu";

const TOP_LEVEL_NAVIGATION = [
  { label: "New Analysis", to: "/analysis" as const, enabled: true },
  { label: "Case Studies", to: null, enabled: FEATURES.CASE_STUDIES_EXPANDED },
  { label: "Guidance Library", to: null, enabled: FEATURES.GUIDANCE_LIBRARY },
] as const;

export function AppHeader() {
  return (
    <header className="border-b border-border bg-card/70">
      <div className="mx-auto grid min-h-16 max-w-7xl grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-2 px-4 py-2.5 sm:flex sm:flex-wrap sm:justify-between sm:px-6">
        <Link
          to="/"
          aria-label="Ayden's Revenue Compass home"
          className="inline-flex min-w-0 items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <img
            src={arcLogo}
            alt=""
            aria-hidden="true"
            width={60}
            height={60}
            className="size-[60px] shrink-0 object-contain"
          />
          <span className="truncate text-[20px] font-semibold leading-tight text-foreground">
            Ayden&apos;s Revenue Compass
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
                      className={
                        item.label === "New Analysis"
                          ? "inline-flex min-h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          : "inline-flex min-h-9 items-center rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                      }
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
