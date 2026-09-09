import { Link } from "@tanstack/react-router";

import { useAnalysis } from "@/components/arc/analysis-context";
import { buildAnalysisSummary } from "@/lib/arc/analysis-summary";
import { FEATURES } from "@/lib/arc/features";

const TONE_CLASS = {
  ok: "border-border bg-muted text-muted-foreground",
  attention: "border-border bg-accent text-accent-foreground",
  blocked: "border-destructive/40 bg-destructive/10 text-destructive",
} as const;

/**
 * Compact orientation card shown above the parent-area navigation.
 *
 * Presentation only: it consumes the authoritative draft and analysis result
 * from the workspace context and never invokes an accounting engine.
 */
export function AnalysisSummary() {
  const { draft, result, origin, loadedSample, resetAnalysis } = useAnalysis();
  const summary = buildAnalysisSummary({ draft, result, origin, scenario: loadedSample });

  return (
    <section
      aria-label="Analysis summary"
      className="space-y-3 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md border border-border bg-muted px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {summary.originLabel}
        </span>
        <span
          className={`rounded-md border px-2 py-1 text-xs font-medium ${TONE_CLASS[summary.statusTone]}`}
        >
          {summary.statusLabel}
        </span>
        {summary.recognitionLabel ? (
          <span className="rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground">
            Recognition · {summary.recognitionLabel}
          </span>
        ) : null}
      </div>

      {summary.identity.length > 0 ? (
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          {summary.identity.map((item) => (
            <p key={item.label} className="text-sm text-foreground">
              <span className="text-muted-foreground">{item.label}: </span>
              <span className="font-semibold">{item.value}</span>
            </p>
          ))}
        </div>
      ) : null}

      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
        {summary.metrics.map((metric) => (
          <div key={metric.label} className="space-y-0.5">
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              {metric.label}
            </dt>
            <dd className="text-sm font-semibold tabular-nums text-foreground">{metric.value}</dd>
          </div>
        ))}
      </dl>

      {summary.originDetail ? (
        <p className="text-xs text-muted-foreground">{summary.originDetail}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Link
          to="/analysis/review"
          search={(previous: Record<string, unknown>) => previous}
          className="rounded-md border border-border px-3 py-1 text-sm font-medium text-foreground hover:bg-accent"
        >
          Review &amp; Finalize
        </Link>
        {FEATURES.SOURCE_DOCUMENTS ? (
          <Link
            to="/analysis/documents"
            search={(previous: Record<string, unknown>) => previous}
            className="rounded-md border border-border px-3 py-1 text-sm font-medium text-foreground hover:bg-accent"
          >
            Source Documents
          </Link>
        ) : null}
        <button
          type="button"
          className="rounded-md border border-destructive/40 px-3 py-1 text-sm text-destructive hover:bg-destructive/10"
          onClick={() => {
            const message = loadedSample
              ? "Reset this sample? Your edits to the sample contract will be discarded."
              : "Reset this analysis? All entered contract data will be cleared.";
            if (window.confirm(message)) resetAnalysis();
          }}
        >
          {summary.resetLabel}
        </button>
      </div>
    </section>
  );
}
