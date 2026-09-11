/**
 * Phase 7D — finalization snapshot builder.
 *
 * Pure and server-usable: it takes the authoritative persisted `WorkflowDraft`
 * and reruns the existing deterministic engines exactly as the workspace does.
 * It performs NO accounting arithmetic of its own — every number it records is
 * copied verbatim from an engine result field.
 *
 * The browser never supplies engine output: `finalizeRevision` rebuilds the
 * snapshot on the server from the stored canonical inputs, and the stored
 * snapshot is afterwards read back as recorded, never recalculated.
 */

import {
  analyzeContractBalanceWorkflow,
  analyzeWorkflow,
  type ContractBalanceWorkflowResult,
  type WorkflowAnalysisResult,
  type WorkflowDraft,
} from "@/lib/asc606-workflow";
import {
  analyzeGroupedJournalEntries,
  analyzeJournalEntries,
  type GroupedJournalAnalysis,
  type JournalAnalysis,
} from "@/lib/asc606-journals";

import { ARC_WORKFLOW_SCHEMA_VERSION } from "./schema";

/**
 * Version of the deterministic engine composition recorded with every
 * finalized snapshot. Bump it when engine behaviour changes so historical
 * snapshots can be identified as produced by an earlier engine.
 */
export const ARC_ENGINE_VERSION = "arc.engine.v1";

export interface ArcEngineOutputsSnapshot {
  engineVersion: string;
  schemaVersion: string;
  workflow: WorkflowAnalysisResult;
  balances: ContractBalanceWorkflowResult;
  journals: JournalAnalysis | null;
  groupedJournals: GroupedJournalAnalysis | null;
}

/**
 * Engine-provided reconciliation fields, copied as-is. Nothing here is
 * derived, summed or re-derived by ARC.
 */
export interface ArcReconciliationSnapshot {
  engineVersion: string;
  schemaVersion: string;
  step1Conclusion: WorkflowAnalysisResult["step1Conclusion"];
  totals: {
    transactionPriceCents: number | null;
    allocatedCents: number | null;
    revenueCents: number | null;
    unscheduledRevenueCents: number;
    lifecycleConsiderationCents: number | null;
  };
  // Engine-reported reconciliation objects, copied verbatim from the engines.
  core: NonNullable<WorkflowAnalysisResult["analysis"]>["reconciliation"] | null;
  lifecycle: NonNullable<WorkflowAnalysisResult["lifecycle"]>["reconciliation"] | null;
  variableConsideration:
    NonNullable<WorkflowAnalysisResult["variableConsideration"]>["reconciliation"] | null;
  modification: NonNullable<WorkflowAnalysisResult["modification"]>["reconciliation"] | null;
  balances: NonNullable<ContractBalanceWorkflowResult["analysis"]>["reconciliation"] | null;
  groupedBalancesReconciled: boolean | null;
  journalsReconciled: boolean | null;
  groupedJournalsReconciled: boolean | null;
}

export type FinalizationSnapshotResult =
  | {
      ok: true;
      engineOutputs: ArcEngineOutputsSnapshot;
      reconciliation: ArcReconciliationSnapshot;
    }
  | { ok: false; issues: string[] };

/**
 * Reruns the engines against the persisted draft and records the outcome.
 * A draft the engine refuses to finalize can never become a snapshot.
 */
export function buildFinalizationSnapshot(draft: WorkflowDraft): FinalizationSnapshotResult {
  const workflow = analyzeWorkflow(draft);

  if (!workflow.finalized) {
    const issues = [
      ...workflow.workflowValidation.blocking.map((issue) => issue.message),
      ...workflow.adapterErrors,
      ...(workflow.engineValidation && workflow.engineValidation.status !== "passed"
        ? workflow.engineValidation.results
            .filter((check) => !check.passed && check.severity === "blocking")
            .map((check) => check.message)
        : []),
    ];
    return {
      ok: false,
      issues:
        issues.length > 0 ? issues : [workflow.blockedReason ?? "The analysis is not complete."],
    };
  }

  const balances = analyzeContractBalanceWorkflow(draft);
  const groupedJournals =
    balances.finalized && balances.grouped
      ? analyzeGroupedJournalEntries(balances.groupInputs)
      : null;
  const journals =
    balances.finalized && !balances.grouped && balances.engineInput
      ? analyzeJournalEntries(balances.engineInput)
      : null;

  const engineOutputs: ArcEngineOutputsSnapshot = {
    engineVersion: ARC_ENGINE_VERSION,
    schemaVersion: ARC_WORKFLOW_SCHEMA_VERSION,
    workflow,
    balances,
    journals,
    groupedJournals,
  };

  const reconciliation: ArcReconciliationSnapshot = {
    engineVersion: ARC_ENGINE_VERSION,
    schemaVersion: ARC_WORKFLOW_SCHEMA_VERSION,
    step1Conclusion: workflow.step1Conclusion,
    totals: {
      transactionPriceCents: workflow.analysis?.totals.transactionPriceCents ?? null,
      allocatedCents: workflow.analysis?.totals.allocatedCents ?? null,
      revenueCents: workflow.revenueSchedule?.totalCents ?? null,
      unscheduledRevenueCents: workflow.unscheduledRevenueCents,
      lifecycleConsiderationCents: workflow.lifecycleConsiderationCents,
    },
    core: workflow.analysis?.reconciliation ?? null,
    lifecycle: workflow.lifecycle?.reconciliation ?? null,
    variableConsideration: workflow.variableConsideration?.reconciliation ?? null,
    modification: workflow.modification?.reconciliation ?? null,
    balances: balances.analysis?.reconciliation ?? null,
    groupedBalancesReconciled: balances.grouped?.reconciled ?? null,
    journalsReconciled: journals?.reconciliation.reconciled ?? null,
    groupedJournalsReconciled: groupedJournals?.reconciled ?? null,
  };

  // JSON round-trip so what is stored is exactly what can be read back.
  return {
    ok: true,
    engineOutputs: JSON.parse(JSON.stringify(engineOutputs)) as ArcEngineOutputsSnapshot,
    reconciliation: JSON.parse(JSON.stringify(reconciliation)) as ArcReconciliationSnapshot,
  };
}

/**
 * Reads a stored reconciliation snapshot back defensively. A snapshot written
 * by an earlier engine is returned exactly as recorded; it is never rebuilt.
 */
export function readReconciliationSnapshot(value: unknown): ArcReconciliationSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ArcReconciliationSnapshot>;
  if (typeof candidate.engineVersion !== "string" || typeof candidate.schemaVersion !== "string") {
    return null;
  }
  if (!candidate.totals || typeof candidate.totals !== "object") return null;
  return candidate as ArcReconciliationSnapshot;
}
