import { createFileRoute } from "@tanstack/react-router";

import { useAnalysis } from "@/components/arc/analysis-context";
import { IssueList, Notice, Section } from "@/components/asc606-workflow/fields";

export const Route = createFileRoute("/analysis/review")({
  component: ReviewFinalizeArea,
});

function ReviewFinalizeArea() {
  const { result } = useAnalysis();
  const { workflowValidation } = result;

  return (
    <div className="space-y-6">
      <Section
        title="Review"
        description="Every outstanding item reported by the deterministic engine and the workflow validation layer."
      >
        <Notice tone={result.blockedReason ? "danger" : "muted"}>
          {result.blockedReason ??
            "No blocking issue was reported. The engine produced a finalized analysis."}
        </Notice>
      </Section>

      <IssueList title="Workflow items requiring attention" issues={workflowValidation.blocking} />
      <IssueList title="Workflow warnings" tone="warning" issues={workflowValidation.warnings} />
      <IssueList
        title="Engine input could not be assembled"
        issues={result.adapterErrors.map((message, index) => ({ id: String(index), message }))}
      />
    </div>
  );
}
