/**
 * Persistent orientation strip: which contract, revision and state is open.
 *
 * Rendered once by the analysis layout so it is visible in every parent area.
 * Presentation only — it reads the authoritative persisted revision metadata
 * and never invokes an accounting engine.
 */

import { useAnalysis } from "@/components/arc/analysis-context";
import { buildAnalysisContextBar } from "@/lib/arc/analysis-context-bar";

const BADGE_CLASS = {
  Draft: "border-border text-muted-foreground",
  Finalized: "border-primary/40 bg-primary/10 text-primary",
  Superseded: "border-border bg-muted text-muted-foreground",
  Unsaved: "border-warning/40 bg-warning/10 text-warning-foreground",
  Sample: "border-border bg-muted text-muted-foreground",
} as const;

export function AnalysisContextBar() {
  const { draft, loadedSample, persistence } = useAnalysis();
  const revision = persistence.revision;

  const model = buildAnalysisContextBar({
    persisted: revision
      ? {
          contractTitle: revision.contractTitle,
          contractNumber: revision.contractNumber,
          customerName: revision.customerName,
          revisionNumber: revision.revisionNumber,
          status: revision.status,
        }
      : null,
    sampleCustomer: loadedSample?.customer ?? null,
    draftCustomerName: draft.contract.customerName,
    draftContractNumber: draft.contract.contractNumber,
  });

  return (
    <div
      aria-label="Analysis context"
      role="status"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-md border border-border bg-card/60 px-3 py-2"
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-foreground">{model.title}</p>
        {model.detail ? (
          <p className="truncate text-xs text-muted-foreground">{model.detail}</p>
        ) : null}
      </div>
      <span
        className={`rounded-md border px-2 py-0.5 text-xs font-medium ${BADGE_CLASS[model.status]}`}
      >
        {model.status}
      </span>
    </div>
  );
}
