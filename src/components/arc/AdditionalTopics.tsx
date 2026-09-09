import { ContractModificationOutputs } from "@/components/asc606-workflow/ContractModificationOutputs";
import { ContractModifications } from "@/components/asc606-workflow/ContractModifications";
import { judgmentLabel, Notice } from "@/components/asc606-workflow/fields";
import type { WorkflowAnalysisResult, WorkflowDraft } from "@/lib/asc606-workflow";
import { Button } from "@/components/ui/button";

import { AccordionSection } from "./AccordionSection";
import { issueStatus } from "./issue-status";

/**
 * Additional Topics Applied.
 *
 * Contract Modifications keeps its existing editor and remains the single
 * authoritative editing location for modification facts. Variable
 * Consideration and Material Rights appear here as read-only summaries with a
 * link to their canonical editors — never as a second editable control.
 */
export function AdditionalTopics({
  draft,
  onChange,
  result,
  open,
  onToggle,
  onNavigate,
}: {
  draft: WorkflowDraft;
  onChange: (draft: WorkflowDraft) => void;
  result: WorkflowAnalysisResult;
  open: Record<string, boolean>;
  onToggle: (id: string, open: boolean) => void;
  onNavigate: (sectionId: string) => void;
}) {
  const vcRelevant = draft.hasVariableConsideration;
  const materialRightPromises = draft.promises.filter((p) => p.kind === "customer_option");
  const materialRightPos = draft.performanceObligations.filter(
    (po) => po.kind === "material_right",
  );
  const materialRightsRelevant = materialRightPromises.length > 0 || materialRightPos.length > 0;
  const modIssues = result.workflowValidation.blockingByStep.mod.length;

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Additional Topics Applied
      </h2>

      <AccordionSection
        id="topic-modifications"
        title="Contract Modifications"
        subtitle="ASC 606-10-25-10 through 25-13. This is the only place modification facts are edited."
        status={issueStatus(modIssues)}
        open={open["topic-modifications"] ?? false}
        onToggle={(next) => onToggle("topic-modifications", next)}
      >
        <div className="space-y-6">
          <ContractModifications draft={draft} onChange={onChange} />
          {result.modification ? (
            <ContractModificationOutputs modification={result.modification} />
          ) : null}
        </div>
      </AccordionSection>

      {vcRelevant ? (
        <AccordionSection
          id="topic-variable-consideration"
          title="Variable Consideration"
          subtitle="Read-only summary. Edited in Step 3 (components and estimates) and Step 5 (measurement)."
          open={open["topic-variable-consideration"] ?? false}
          onToggle={(next) => onToggle("topic-variable-consideration", next)}
        >
          <div className="space-y-3 text-sm">
            {draft.variableConsiderationComponents.length === 0 ? (
              <Notice>
                Variable consideration is indicated but no component has been added yet.
              </Notice>
            ) : (
              <ul className="list-disc space-y-1 pl-5">
                {draft.variableConsiderationComponents.map((component) => (
                  <li key={component.id}>
                    <span className="font-medium">
                      {component.description || `Component ${component.seq}`}
                    </span>{" "}
                    —{" "}
                    {component.treatment === "estimated"
                      ? "estimated variable consideration"
                      : "usage as incurred"}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-muted-foreground">
              {result.variableConsideration
                ? "Engine output for this topic is presented in the Revenue Schedule area."
                : "No variable-consideration output is available for the current draft."}
            </p>
            <TopicLink
              label="Go to Step 3 — Determine the Transaction Price"
              target="step-3"
              onNavigate={onNavigate}
            />
          </div>
        </AccordionSection>
      ) : null}

      {materialRightsRelevant ? (
        <AccordionSection
          id="topic-material-rights"
          title="Material Rights / Customer Options"
          subtitle="Read-only summary. Edited in Step 2 (option and material-right judgments) and Step 4 (standalone selling price)."
          open={open["topic-material-rights"] ?? false}
          onToggle={(next) => onToggle("topic-material-rights", next)}
        >
          <div className="space-y-3 text-sm">
            <ul className="list-disc space-y-1 pl-5">
              {materialRightPromises.map((promise) => (
                <li key={promise.id}>
                  <span className="font-medium">
                    {promise.description || `Promise ${promise.seq}`}
                  </span>{" "}
                  — conveys a material right: {judgmentLabel(promise.conveysMaterialRight)}
                </li>
              ))}
              {materialRightPos.map((po) => (
                <li key={po.id}>
                  <span className="font-medium">
                    {po.name || `Performance obligation ${po.seq}`}
                  </span>{" "}
                  — material-right performance obligation (
                  {po.materialRightStatus.replace(/_/g, " ")})
                </li>
              ))}
            </ul>
            <TopicLink
              label="Go to Step 2 — Identify Performance Obligations"
              target="step-2"
              onNavigate={onNavigate}
            />
          </div>
        </AccordionSection>
      ) : null}
    </div>
  );
}

function TopicLink({
  label,
  target,
  onNavigate,
}: {
  label: string;
  target: string;
  onNavigate: (sectionId: string) => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={() => onNavigate(target)}
    >
      {label}
    </Button>
  );
}
