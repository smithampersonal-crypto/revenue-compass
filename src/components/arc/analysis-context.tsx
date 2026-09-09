import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import {
  analyzeWorkflow,
  createEmptyDraft,
  type WorkflowAnalysisResult,
  type WorkflowDraft,
} from "@/lib/asc606-workflow";
import { createDemoDraftIfKnown, getDemoScenario, isDemoScenarioId } from "@/lib/demo-scenarios";
import type { DemoScenario } from "@/lib/demo-scenarios";

/**
 * Presentation-only provenance of the analysis currently open. It affects
 * labels and contextual actions only; every origin renders the exact same
 * workspace and the exact same engine output.
 */
export type AnalysisOrigin = "manual" | "sample" | "ai";

export interface AnalysisContextValue {
  /** The single authoritative in-memory analysis draft. */
  draft: WorkflowDraft;
  setDraft: (updater: WorkflowDraft | ((previous: WorkflowDraft) => WorkflowDraft)) => void;
  /** Deterministic engine output for the current draft. */
  result: WorkflowAnalysisResult;
  origin: AnalysisOrigin;
  /** The sample id in the URL, when one was supplied. */
  sample: string | undefined;
  loadedSample: DemoScenario | null;
  unknownSample: boolean;
  resetAnalysis: () => void;
}

const AnalysisContext = createContext<AnalysisContextValue | null>(null);

export function AnalysisProvider({
  sample,
  children,
}: {
  sample: string | undefined;
  children: ReactNode;
}) {
  // Initial state only: later user edits are never overwritten by a rerender,
  // and navigating between parent areas never remounts this provider.
  const [draft, setDraft] = useState<WorkflowDraft>(
    () => createDemoDraftIfKnown(sample) ?? createEmptyDraft(),
  );

  const result = useMemo(() => analyzeWorkflow(draft), [draft]);

  const loadedSample = isDemoScenarioId(sample) ? getDemoScenario(sample) : null;
  const unknownSample = sample !== undefined && loadedSample === null;

  const value = useMemo<AnalysisContextValue>(
    () => ({
      draft,
      setDraft,
      result,
      origin: loadedSample ? "sample" : "manual",
      sample,
      loadedSample,
      unknownSample,
      // A sample resets back to its canonical fixture (the URL, and therefore
      // the sample origin, is untouched); a manual analysis resets to blank.
      resetAnalysis: () => {
        setDraft(createDemoDraftIfKnown(sample) ?? createEmptyDraft());
      },
    }),
    [draft, result, loadedSample, unknownSample, sample],
  );

  return <AnalysisContext.Provider value={value}>{children}</AnalysisContext.Provider>;
}

export function useAnalysis(): AnalysisContextValue {
  const value = useContext(AnalysisContext);
  if (!value) {
    throw new Error("useAnalysis must be used inside the /analysis layout route.");
  }
  return value;
}
