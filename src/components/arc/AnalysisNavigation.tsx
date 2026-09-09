import { Link } from "@tanstack/react-router";

import { FEATURES } from "@/lib/arc/features";

/** The six parent areas of the workspace, rendered as a horizontal tab bar. */
export const ANALYSIS_AREAS = [
  { to: "/analysis", label: "ASC 606 Analysis", exact: true },
  { to: "/analysis/schedule", label: "Revenue Schedule", exact: false },
  { to: "/analysis/balances", label: "Contract Balances", exact: false },
  { to: "/analysis/journals", label: "Journal Entries", exact: false },
  {
    to: "/analysis/documents",
    label: "Source Documents",
    exact: false,
    feature: "SOURCE_DOCUMENTS",
  },
  { to: "/analysis/review", label: "Review & Finalize", exact: false },
] as const;

export function AnalysisNavigation() {
  const areas = ANALYSIS_AREAS.filter(
    (area) => !("feature" in area) || FEATURES[area.feature as "SOURCE_DOCUMENTS"],
  );

  return (
    <nav aria-label="Analysis areas" className="overflow-x-auto pb-1">
      <ul className="flex w-max min-w-full gap-1 rounded-lg border border-border bg-card p-1.5">
        {areas.map((area) => (
          <li key={area.to}>
            <Link
              to={area.to}
              search={(previous: Record<string, unknown>) => previous}
              activeOptions={{ exact: area.exact }}
              activeProps={{
                className:
                  "rounded-md border border-primary/50 bg-primary/15 px-3 py-2 text-sm font-semibold text-primary",
                "aria-current": "page",
              }}
              inactiveProps={{
                className:
                  "rounded-md border border-transparent px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
              }}
              className="whitespace-nowrap"
            >
              {area.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
