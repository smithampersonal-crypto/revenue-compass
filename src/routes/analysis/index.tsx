import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { AccordionSection } from "@/components/arc/AccordionSection";
import { issueStatus } from "@/components/arc/issue-status";
import { AdditionalTopics } from "@/components/arc/AdditionalTopics";
import { useAnalysis } from "@/components/arc/analysis-context";
import { IssueList } from "@/components/asc606-workflow/fields";
import { Step1Contract } from "@/components/asc606-workflow/Step1Contract";
import { Step2PerformanceObligations } from "@/components/asc606-workflow/Step2PerformanceObligations";
import { Step2Promises } from "@/components/asc606-workflow/Step2Promises";
import { Step3TransactionPrice } from "@/components/asc606-workflow/Step3TransactionPrice";
import { Step4Allocation } from "@/components/asc606-workflow/Step4Allocation";
import { Step5Recognition } from "@/components/asc606-workflow/Step5Recognition";

export const Route = createFileRoute("/analysis/")({
  component: Asc606AnalysisArea,
});

function Asc606AnalysisArea() {
  const { draft, setDraft, result } = useAnalysis();
  // Presentation-only: which sections are expanded. Multiple may be open at
  // once. No accounting state lives here.
  const [open, setOpen] = useState<Record<string, boolean>>({ "step-1": true });
  const toggle = (id: string, next: boolean) => setOpen((prev) => ({ ...prev, [id]: next }));

  const blocking = result.workflowValidation.blockingByStep;
  const step2Issues = [...blocking["2a"], ...blocking["2b"]];

  const reveal = (id: string) => {
    setOpen((prev) => ({ ...prev, [id]: true }));
    if (typeof document !== "undefined") {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <h1 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          ASC 606 Analysis
        </h1>

        <AccordionSection
          id="step-1"
          title="Step 1 — Identify the Contract"
          status={issueStatus(blocking["1"].length)}
          open={open["step-1"] ?? false}
          onToggle={(next) => toggle("step-1", next)}
        >
          <div className="space-y-4">
            <IssueList title="Items requiring attention in Step 1" issues={blocking["1"]} />
            <Step1Contract draft={draft} onChange={setDraft} />
          </div>
        </AccordionSection>

        <AccordionSection
          id="step-2"
          title="Step 2 — Identify Performance Obligations"
          status={issueStatus(step2Issues.length)}
          open={open["step-2"] ?? false}
          onToggle={(next) => toggle("step-2", next)}
        >
          <div className="space-y-6">
            <IssueList title="Items requiring attention in Step 2" issues={step2Issues} />
            <Step2Promises draft={draft} onChange={setDraft} />
            <Step2PerformanceObligations draft={draft} onChange={setDraft} />
          </div>
        </AccordionSection>

        <AccordionSection
          id="step-3"
          title="Step 3 — Determine the Transaction Price"
          status={issueStatus(blocking["3"].length)}
          open={open["step-3"] ?? false}
          onToggle={(next) => toggle("step-3", next)}
        >
          <div className="space-y-4">
            <IssueList title="Items requiring attention in Step 3" issues={blocking["3"]} />
            <Step3TransactionPrice draft={draft} onChange={setDraft} />
          </div>
        </AccordionSection>

        <AccordionSection
          id="step-4"
          title="Step 4 — Allocate the Transaction Price"
          status={issueStatus(blocking["4"].length)}
          open={open["step-4"] ?? false}
          onToggle={(next) => toggle("step-4", next)}
        >
          <div className="space-y-4">
            <IssueList title="Items requiring attention in Step 4" issues={blocking["4"]} />
            <Step4Allocation draft={draft} onChange={setDraft} />
          </div>
        </AccordionSection>

        <AccordionSection
          id="step-5"
          title="Step 5 — Recognize Revenue"
          status={issueStatus(blocking["5"].length)}
          open={open["step-5"] ?? false}
          onToggle={(next) => toggle("step-5", next)}
        >
          <div className="space-y-4">
            <IssueList title="Items requiring attention in Step 5" issues={blocking["5"]} />
            <Step5Recognition draft={draft} onChange={setDraft} />
          </div>
        </AccordionSection>
      </div>

      <AdditionalTopics
        draft={draft}
        onChange={setDraft}
        result={result}
        open={open}
        onToggle={toggle}
        onNavigate={reveal}
      />
    </div>
  );
}
