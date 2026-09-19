import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";

import { AccordionSection } from "@/components/arc/AccordionSection";
import { issueStatus } from "@/components/arc/issue-status";
import { AdditionalTopics } from "@/components/arc/AdditionalTopics";
import { AiReviewTargetProvider } from "@/components/arc/AiReviewTarget";
import { useAnalysis } from "@/components/arc/analysis-context";
import { describeReviewTarget } from "@/lib/arc/ai/review-presentation";
import { IssueList } from "@/components/asc606-workflow/fields";
import { Step1Contract } from "@/components/asc606-workflow/Step1Contract";
import { Step2PerformanceObligations } from "@/components/asc606-workflow/Step2PerformanceObligations";
import { Step2Promises } from "@/components/asc606-workflow/Step2Promises";
import { Step3TransactionPrice } from "@/components/asc606-workflow/Step3TransactionPrice";
import { Step4Allocation } from "@/components/asc606-workflow/Step4Allocation";
import { Step5Recognition } from "@/components/asc606-workflow/Step5Recognition";

export const Route = createFileRoute("/analysis/")({
  head: () => ({
    meta: [
      { title: "ASC 606 Five-Step Analysis — Ayden's Revenue Compass" },
      {
        name: "description",
        content: "Document ASC 606 judgments across the five-step revenue recognition model.",
      },
      { property: "og:title", content: "ASC 606 Five-Step Analysis — Ayden's Revenue Compass" },
      {
        property: "og:description",
        content: "Document ASC 606 judgments across the five-step revenue recognition model.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "/analysis" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "/analysis" }],
  }),
  component: Asc606AnalysisArea,
});

export function Asc606AnalysisArea() {
  const { draft, setDraft, result, ai } = useAnalysis();
  const navigate = useNavigate();
  const search = useSearch({ from: "/analysis" }) as Record<string, string | undefined>;
  // Presentation-only: which sections are expanded. Multiple may be open at
  // once. No accounting state lives here.
  const [open, setOpen] = useState<Record<string, boolean>>({ "step-1": true });
  const toggle = (id: string, next: boolean) => setOpen((prev) => ({ ...prev, [id]: next }));

  const blocking = result.workflowValidation.blockingByStep;
  const step2Issues = [...blocking["2a"], ...blocking["2b"]];

  // AI review items per accordion, counted from the server-owned review state
  // only. Deterministic issues keep their own separate count.
  const aiReviewCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of ai.workspace?.reviewItems ?? []) {
      if (item.state === "resolved") continue;
      const id = describeReviewTarget(item.targetKey, item.section).sectionElementId;
      counts[id] = (counts[id] ?? 0) + 1;
    }
    return counts;
  }, [ai.workspace]);
  const aiReviewStatus = (id: string) => {
    const count = aiReviewCounts[id] ?? 0;
    return count === 0 ? null : `${count} AI review`;
  };

  const reveal = (id: string) => {
    setOpen((prev) => ({ ...prev, [id]: true }));
    if (typeof document !== "undefined") {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  // One-shot review intent. It opens and focuses the persisted target, then
  // removes only itself from the URL so the same click can be repeated later.
  const consumedReviewRef = useRef<string | null>(null);
  const requestedReview = search["review"] ?? null;
  // An explicit navigation request may name an actionable review item OR a
  // Phase 9G-R Task R2 routine assumption. Resolution for THIS one-shot intent
  // is the only place the two queues are read together; assumptions stay out of
  // every count, action, "next issue" and finalization path.
  const reviewItem =
    requestedReview === null
      ? null
      : ((ai.workspace?.reviewItems.find((item) => item.id === requestedReview) ??
          ai.workspace?.assumptionItems.find((item) => item.id === requestedReview)) ??
        null);

  useEffect(() => {
    if (requestedReview === null) {
      consumedReviewRef.current = null;
      return;
    }
    if (consumedReviewRef.current === requestedReview) return;
    // Wait until the authoritative review state that names the target arrives.
    if (ai.loadState !== "ready") return;

    const { review: _pending, ...withoutReview } = search;
    if (reviewItem === null) {
      // The item is gone — another tab resolved it, an edit cured it, or the
      // link is stale. Drop only this parameter and keep every other identity
      // hint; never fabricate a target or open an arbitrary section.
      consumedReviewRef.current = requestedReview;
      void navigate({ to: "/analysis", search: withoutReview, replace: true });
      return;
    }
    consumedReviewRef.current = requestedReview;

    const target = describeReviewTarget(reviewItem.targetKey, reviewItem.section);
    const sectionId = target.sectionElementId;
    setOpen((prev) => ({ ...prev, [sectionId]: true }));
    if (typeof document !== "undefined") {
      const anchor = target.anchorId === null ? null : document.getElementById(target.anchorId);
      (anchor ?? document.getElementById(sectionId))?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }

    void navigate({ to: "/analysis", search: withoutReview, replace: true });
  }, [requestedReview, reviewItem, navigate, search, ai.loadState]);

  return (
    <AiReviewTargetProvider workspace={ai.workspace}>
      <div className="space-y-8">
        <div className="space-y-4">
          <h1 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            ASC 606 Analysis
          </h1>

          <AccordionSection
            id="step-1"
            aiReviewStatus={aiReviewStatus("step-1")}
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
            aiReviewStatus={aiReviewStatus("step-2")}
            title="Step 2 — Identify Performance Obligations"
            status={issueStatus(step2Issues.length)}
            open={open["step-2"] ?? false}
            onToggle={(next) => toggle("step-2", next)}
          >
            <div className="space-y-6">
              <IssueList title="Items requiring attention in Step 2" issues={step2Issues} />
              <Step2Promises draft={draft} onChange={setDraft} />
              <Step2PerformanceObligations
                draft={draft}
                onChange={setDraft}
                warnings={result.workflowValidation.warningsByStep["2b"]}
              />
            </div>
          </AccordionSection>

          <AccordionSection
            id="step-3"
            aiReviewStatus={aiReviewStatus("step-3")}
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
            aiReviewStatus={aiReviewStatus("step-4")}
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
            aiReviewStatus={aiReviewStatus("step-5")}
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
          aiReviewStatus={aiReviewStatus}
        />
      </div>
    </AiReviewTargetProvider>
  );
}
