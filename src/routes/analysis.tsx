import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import {
  createDemoDraftIfKnown,
  getDemoScenario,
  isDemoScenarioId,
} from "@/lib/demo-scenarios";

import { AnalysisResults } from "@/components/asc606-workflow/AnalysisResults";
import { BillingAndBalances } from "@/components/asc606-workflow/BillingAndBalances";
import { IssueList, Notice } from "@/components/asc606-workflow/fields";

import { Step1Contract } from "@/components/asc606-workflow/Step1Contract";
import { Step2PerformanceObligations } from "@/components/asc606-workflow/Step2PerformanceObligations";
import { Step2Promises } from "@/components/asc606-workflow/Step2Promises";
import { Step3TransactionPrice } from "@/components/asc606-workflow/Step3TransactionPrice";
import { Step4Allocation } from "@/components/asc606-workflow/Step4Allocation";
import { Step5Recognition } from "@/components/asc606-workflow/Step5Recognition";
import { STEPS, WorkflowStepper, type StepKey } from "@/components/asc606-workflow/WorkflowStepper";
import {
  analyzeWorkflow,
  createEmptyDraft,
  type WorkflowDraft,
  type WorkflowStepId,
} from "@/lib/asc606-workflow";

const TITLE = "ASC 606 Five-Step Analysis Workspace";
const DESCRIPTION =
  "Work through the ASC 606 five-step revenue recognition model for a SaaS contract and review deterministic allocation and revenue schedules.";

export const Route = createFileRoute("/analysis")({
  validateSearch: (search: Record<string, unknown>): { sample?: string } =>
    typeof search["sample"] === "string" ? { sample: search["sample"] } : {},
  head: () => ({
    meta: [
      { title: "ASC 606 Five-Step Analysis Workspace" },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AnalysisPage,
});

function AnalysisPage() {
  const { sample } = Route.useSearch();
  // Initial state only: later user edits are never overwritten by a rerender.
  const [draft, setDraft] = useState<WorkflowDraft>(
    () => createDemoDraftIfKnown(sample) ?? createEmptyDraft(),
  );
  const loadedSample = isDemoScenarioId(sample) ? getDemoScenario(sample) : null;
  const unknownSample = sample !== undefined && loadedSample === null;
  const [step, setStep] = useState<StepKey>("1");
  const [showStepIssues, setShowStepIssues] = useState(false);

  const result = useMemo(() => analyzeWorkflow(draft), [draft]);

  const currentIndex = STEPS.findIndex((s) => s.key === step);
  const stepIssues =
    step === "results" || step === "balances"
      ? []
      : (result.workflowValidation.blockingByStep[step as WorkflowStepId] ?? []);


  const goTo = (next: StepKey) => {
    setShowStepIssues(false);
    setStep(next);
  };

  const onContinue = () => {
    if (stepIssues.length > 0) {
      setShowStepIssues(true);
      return;
    }
    const next = STEPS[currentIndex + 1];
    if (next) goTo(next.key);
  };

  const onReset = () => {
    if (window.confirm("Reset this analysis? All entered contract data will be cleared.")) {
      setDraft(createEmptyDraft());
      goTo("1");
    }
  };

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="space-y-2">
        <Link to="/" className="text-sm text-muted-foreground hover:underline">
          ← Revenue Compass Home
        </Link>
        <h1 className="text-2xl font-bold text-foreground">{TITLE}</h1>
        <p className="text-sm text-muted-foreground">
          All accounting judgments are yours. Allocation, revenue recognition and reconciliation
          amounts are produced by the deterministic ASC 606 engine and are read-only.
        </p>
        <Notice>
          This workspace holds one in-memory analysis. Nothing is saved: refreshing the page clears
          all entered data.
        </Notice>
        {loadedSample ? (
          <Notice>
            Sample data loaded: {loadedSample.customer}. Edit any field to experiment with the
            accounting results. Changes are temporary and reset when the page is refreshed.
          </Notice>
        ) : null}
        {unknownSample ? (
          <Notice>
            That sample was not recognized, so a blank analysis was opened.
          </Notice>
        ) : null}
      </header>

      <WorkflowStepper current={step} onSelect={goTo} />

      {step === "1" ? <Step1Contract draft={draft} onChange={setDraft} /> : null}
      {step === "2a" ? <Step2Promises draft={draft} onChange={setDraft} /> : null}
      {step === "2b" ? <Step2PerformanceObligations draft={draft} onChange={setDraft} /> : null}
      {step === "3" ? <Step3TransactionPrice draft={draft} onChange={setDraft} /> : null}
      {step === "4" ? <Step4Allocation draft={draft} onChange={setDraft} /> : null}
      {step === "5" ? <Step5Recognition draft={draft} onChange={setDraft} /> : null}
      {step === "balances" ? <BillingAndBalances draft={draft} onChange={setDraft} /> : null}
      {step === "results" ? <AnalysisResults draft={draft} result={result} /> : null}


      {showStepIssues ? (
        <IssueList title="Resolve these items before continuing" issues={stepIssues} />
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          className="rounded-md border border-border px-3 py-1 text-sm hover:bg-accent disabled:opacity-50"
          disabled={currentIndex <= 0}
          onClick={() => {
            const prev = STEPS[currentIndex - 1];
            if (prev) goTo(prev.key);
          }}
        >
          Back
        </button>
        <button
          type="button"
          className="rounded-md border border-destructive/40 px-3 py-1 text-sm text-destructive hover:bg-destructive/10"
          onClick={onReset}
        >
          Reset Analysis
        </button>
        <button
          type="button"
          className="rounded-md border border-primary bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50"
          disabled={currentIndex >= STEPS.length - 1}
          onClick={onContinue}
        >
          Continue
        </button>
      </div>
    </main>
  );
}
