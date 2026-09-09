import type { WorkflowAnalysisResult } from "@/lib/asc606-workflow";

/**
 * Presentation-only status mapping.
 *
 * The approved engine keeps its historical `blockedReason` wording. This helper
 * maps existing result and validation FIELDS (never string parsing, never
 * accounting arithmetic) to draft-oriented product copy. The raw engine reason
 * is preserved on the returned object for diagnostics only.
 */
export type AnalysisStatusTone = "ok" | "attention" | "blocked";

export interface AnalysisStatus {
  tone: AnalysisStatusTone;
  headline: string;
  detail: string;
  /** Raw engine wording; never rendered as the product state. */
  engineReason: string | null;
}

export function analysisStatus(result: WorkflowAnalysisResult): AnalysisStatus {
  const engineReason = result.blockedReason;

  if (result.step1Conclusion === "not_qualified") {
    return {
      tone: "blocked",
      headline: "Step 1 not qualified",
      detail:
        "The arrangement does not currently qualify for a complete ASC 606 draft analysis. Later steps may still be documented, but no allocation or revenue schedule is produced.",
      engineReason,
    };
  }
  if (result.step1Conclusion === "incomplete") {
    return {
      tone: "attention",
      headline: "Step 1 incomplete",
      detail:
        "The Step 1 contract criteria have not all been answered, so complete engine outputs are not yet available.",
      engineReason,
    };
  }
  if (result.workflowValidation.blocking.length > 0) {
    return {
      tone: "attention",
      headline: "Draft items outstanding",
      detail:
        "The draft has unresolved items that must be addressed before complete engine outputs are available.",
      engineReason,
    };
  }
  if (result.adapterErrors.length > 0) {
    return {
      tone: "attention",
      headline: "Engine input could not be assembled",
      detail:
        "The draft could not be converted into a complete engine input. Review the items below.",
      engineReason,
    };
  }
  if (result.engineValidation && result.engineValidation.status !== "passed") {
    return {
      tone: "blocked",
      headline: "Engine validation requires attention",
      detail:
        "The deterministic engine reported blocking validation items. Review the items below.",
      engineReason,
    };
  }
  if (!result.revenueSchedule) {
    return {
      tone: "attention",
      headline: "Outputs not yet available",
      detail: "No revenue schedule is available until the outstanding analysis items are resolved.",
      engineReason,
    };
  }
  return {
    tone: "ok",
    headline: "Draft complete",
    detail:
      "No blocking issues were reported in the ASC 606 five-step analysis. The required revenue-analysis outputs are available.",
    engineReason,
  };
}
