import { Link } from "@tanstack/react-router";
import { Compass } from "lucide-react";

export function AppHeader() {
  return (
    <header className="border-b border-border bg-card/70">
      <div className="mx-auto flex min-h-16 max-w-6xl items-center px-4 py-3 sm:px-6">
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
      </div>
    </header>
  );
}
