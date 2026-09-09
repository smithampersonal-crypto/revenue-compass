/**
 * Presentation-only summary view model for the analysis workspace header.
 *
 * Selection, counting, labelling and formatting of values that already exist on
 * the authoritative WorkflowDraft and WorkflowAnalysisResult. No accounting
 * arithmetic of any kind is performed here, and no accounting engine is invoked
 * from this module: the caller passes the already-memoized analysis result.
 */

import { formatCents } from "@/lib/asc606";
import type { WorkflowAnalysisResult, WorkflowDraft } from "@/lib/asc606-workflow";
import { analysisStatus, type AnalysisStatusTone } from "@/components/arc/analysis-status";
import type { AnalysisOrigin } from "@/components/arc/analysis-context";
import type { DemoScenario } from "@/lib/demo-scenarios";

export interface SummaryMetric {
  label: string;
  value: string;
}

export interface AnalysisSummaryModel {
  /** Product state derived from provenance only, never from engine finalization. */
  originLabel: string;
  /** Short supporting sentence; null for an ordinary manual draft. */
  originDetail: string | null;
  statusLabel: string;
  statusTone: AnalysisStatusTone;
  /** Contract identity fields, empty values omitted. */
  identity: SummaryMetric[];
  metrics: SummaryMetric[];
  /** Common recognition method, or null when mixed/incomplete/ambiguous. */
  recognitionLabel: string | null;
  /** "Reset Sample" for a loaded sample, otherwise "Reset Analysis". */
  resetLabel: string;
}

const ORIGIN_LABELS: Record<AnalysisOrigin, string> = {
  manual: "Draft Analysis",
  sample: "Sample Analysis — Fictional Contract",
  ai: "AI Draft",
};

const RECOGNITION_LABELS = {
  over_time_ratable: "Over time",
  point_in_time: "Point in time",
} as const;

function statusLabel(result: WorkflowAnalysisResult): {
  label: string;
  tone: AnalysisStatusTone;
} {
  const status = analysisStatus(result);
  const outstanding = result.workflowValidation.blocking.length;
  if (status.tone === "ok") return { label: "Draft complete", tone: "ok" };
  if (outstanding > 0) {
    return {
      label: `${outstanding} outstanding analysis ${outstanding === 1 ? "item" : "items"}`,
      tone: status.tone,
    };
  }
  return { label: "Needs attention", tone: status.tone };
}

export function buildAnalysisSummary({
  draft,
  result,
  origin,
  scenario,
}: {
  draft: WorkflowDraft;
  result: WorkflowAnalysisResult;
  origin: AnalysisOrigin;
  scenario: DemoScenario | null;
}): AnalysisSummaryModel {
  const status = statusLabel(result);

  const identity: SummaryMetric[] = [];
  if (draft.contract.customerName.trim() !== "") {
    identity.push({ label: "Customer", value: draft.contract.customerName.trim() });
  }
  if (draft.contract.contractNumber.trim() !== "") {
    identity.push({ label: "Contract", value: draft.contract.contractNumber.trim() });
  }

  const metrics: SummaryMetric[] = [
    { label: "Performance obligations", value: String(draft.performanceObligations.length) },
  ];

  const hasMaterialRight = draft.performanceObligations.some((po) => po.kind === "material_right");
  const hasVariableConsideration =
    draft.hasVariableConsideration && draft.variableConsiderationComponents.length > 0;
  const modification = result.modification;
  const modificationTotals =
    modification && modification.classification !== null ? modification.totals : null;

  if (modificationTotals && modification?.classification) {
    metrics.push(
      {
        label: "Original consideration",
        value: formatCents(modificationTotals.originalTransactionPriceCents),
      },
      {
        label: "Modification consideration",
        value: formatCents(modificationTotals.considerationChangeCents),
      },
      {
        label: "Lifecycle consideration",
        value: formatCents(modificationTotals.lifecycleConsiderationCents),
      },
      { label: "Modification treatment", value: modification.classification.label },
    );
  } else if (
    !hasVariableConsideration &&
    !hasMaterialRight &&
    modification === null &&
    result.analysis !== null
  ) {
    metrics.push({
      label: "Transaction price",
      value: formatCents(result.analysis.totals.transactionPriceCents),
    });
  }

  const methods = draft.performanceObligations.map((po) => po.recognitionMethod);
  const commonMethod =
    methods.length > 0 && methods.every((m) => m !== null && m === methods[0]) ? methods[0] : null;
  const recognitionLabel =
    commonMethod && modification === null ? RECOGNITION_LABELS[commonMethod] : null;

  return {
    originLabel: ORIGIN_LABELS[origin],
    originDetail: scenario
      ? "Fictional sample — edit any assumption to explore the accounting."
      : null,
    statusLabel: status.label,
    statusTone: status.tone,
    identity,
    metrics,
    recognitionLabel,
    resetLabel: scenario ? "Reset Sample" : "Reset Analysis",
  };
}
