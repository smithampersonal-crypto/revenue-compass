/**
 * Phase 7D — the ARC workpaper bundle and the finalization snapshot builder.
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
import { isDecodableEngineOutputs, isDecodableReconciliation } from "./snapshot-schema";


/**
 * Version of the deterministic engine composition recorded with every
 * finalized snapshot. Bump it when engine behaviour changes so historical
 * snapshots can be identified as produced by an earlier engine.
 */
export const ARC_ENGINE_VERSION = "arc.engine.v1";

/**
 * The applicable journal output for a contract. A contract is either ordinary
 * or grouped (Phase 5C); it is never both and a complete workpaper is never
 * neither. Modelling it as a discriminated union makes "finalized with no
 * journal output" structurally impossible.
 */
export type ArcJournalSnapshot =
  | { kind: "ordinary"; analysis: JournalAnalysis }
  | { kind: "grouped"; analysis: GroupedJournalAnalysis };

/** Every engine output the workspace presents, computed exactly once. */
export interface ArcWorkpaper {
  workflow: WorkflowAnalysisResult;
  balances: ContractBalanceWorkflowResult;
  /** Null while the billing workpaper is incomplete. */
  journals: ArcJournalSnapshot | null;
}

export interface ArcEngineOutputsSnapshot {
  engineVersion: string;
  schemaVersion: string;
  workflow: WorkflowAnalysisResult;
  balances: ContractBalanceWorkflowResult;
  journals: ArcJournalSnapshot;
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
 * Runs every deterministic engine for a draft exactly once, in the same order
 * and with the same inputs the workspace uses. No accounting decision is made
 * here: which journal engine applies is the balance engine's own `grouped`
 * conclusion.
 */
export function buildWorkpaper(draft: WorkflowDraft): ArcWorkpaper {
  const workflow = analyzeWorkflow(draft);
  const balances = analyzeContractBalanceWorkflow(draft);

  let journals: ArcJournalSnapshot | null = null;
  if (balances.finalized && balances.grouped) {
    journals = { kind: "grouped", analysis: analyzeGroupedJournalEntries(balances.groupInputs) };
  } else if (balances.finalized && balances.engineInput) {
    journals = { kind: "ordinary", analysis: analyzeJournalEntries(balances.engineInput) };
  }

  return { workflow, balances, journals };
}

/** Engine-reported blocking messages for an incomplete five-step analysis. */
function workflowIssues(workflow: WorkflowAnalysisResult): string[] {
  const issues = [
    ...workflow.workflowValidation.blocking.map((issue) => issue.message),
    ...workflow.adapterErrors,
    ...(workflow.engineValidation && workflow.engineValidation.status !== "passed"
      ? workflow.engineValidation.results
          .filter((check) => !check.passed && check.severity === "blocking")
          .map((check) => check.message)
      : []),
  ];
  return issues.length > 0
    ? issues
    : [workflow.blockedReason ?? "The ASC 606 analysis is not complete."];
}

/**
 * Reruns the engines against the persisted draft and records the outcome.
 *
 * A revision may be finalized only when the whole workpaper is complete: the
 * five-step analysis, the billing and contract-balance workpaper with a
 * reconciled balance conclusion, and the applicable reconciled journal
 * output. Warnings stay warnings; every blocking condition reported here is
 * reported by an existing engine.
 */
export function buildFinalizationSnapshot(draft: WorkflowDraft): FinalizationSnapshotResult {
  const workpaper = buildWorkpaper(draft);
  const { workflow, balances, journals } = workpaper;

  if (!workflow.finalized) {
    return { ok: false, issues: workflowIssues(workflow) };
  }

  if (!balances.finalized) {
    const issues = balances.validation.blocking.map((issue) => issue.message);
    return {
      ok: false,
      issues:
        issues.length > 0 ? issues : ["The Billing & Contract Balances workpaper is not complete."],
    };
  }

  if (!journals) {
    return {
      ok: false,
      issues: ["No journal entries could be produced from the billing workpaper."],
    };
  }

  if (journals.kind === "grouped") {
    if (balances.grouped?.reconciled !== true) {
      return { ok: false, issues: ["The combined gross contract balances do not reconcile."] };
    }
    for (const group of balances.grouped.groups) {
      if (group.analysis.reconciliation.reconciled !== true) {
        return {
          ok: false,
          issues: [`The contract balances for ${group.label} do not reconcile.`],
        };
      }
    }
    if (journals.analysis.reconciled !== true) {
      return { ok: false, issues: ["The grouped journal entries do not reconcile."] };
    }
  } else {
    if (balances.analysis?.reconciliation.reconciled !== true) {
      return { ok: false, issues: ["The contract balance workpaper does not reconcile."] };
    }
    if (journals.analysis.reconciliation.reconciled !== true) {
      return { ok: false, issues: ["The journal entries do not reconcile."] };
    }
  }

  // Structural guarantee: a successful snapshot always carries applicable
  // journal output; it can never mean "no journals".
  const engineOutputs: ArcEngineOutputsSnapshot = {
    engineVersion: ARC_ENGINE_VERSION,
    schemaVersion: ARC_WORKFLOW_SCHEMA_VERSION,
    workflow,
    balances,
    journals,
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
    journalsReconciled:
      journals.kind === "ordinary" ? journals.analysis.reconciliation.reconciled : null,
    groupedJournalsReconciled: journals.kind === "grouped" ? journals.analysis.reconciled : null,
  };

  // JSON round-trip so what is stored is exactly what can be read back.
  return {
    ok: true,
    engineOutputs: JSON.parse(JSON.stringify(engineOutputs)) as ArcEngineOutputsSnapshot,
    reconciliation: JSON.parse(JSON.stringify(reconciliation)) as ArcReconciliationSnapshot,
  };
}

/** Metadata the stored row itself carries, used to detect a rewritten row. */
export interface SnapshotMetadata {
  engineVersion: string;
  schemaVersion: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function matchesMetadata(value: Record<string, unknown>, expected?: SnapshotMetadata): boolean {
  if (typeof value["engineVersion"] !== "string") return false;
  if (typeof value["schemaVersion"] !== "string") return false;
  if (!expected) return true;
  return (
    value["engineVersion"] === expected.engineVersion &&
    value["schemaVersion"] === expected.schemaVersion
  );
}

/**
 * Reads a stored reconciliation snapshot back defensively, through the decoder
 * registered for the engine version that produced it. A snapshot written by an
 * earlier engine is returned exactly as recorded; it is never rebuilt. When the
 * row's own metadata is supplied it must agree with the snapshot's.
 */
export function readReconciliationSnapshot(
  value: unknown,
  expected?: SnapshotMetadata,
): ArcReconciliationSnapshot | null {
  if (!isObject(value)) return null;
  if (!matchesMetadata(value, expected)) return null;
  if (!isDecodableReconciliation(value, value["engineVersion"] as string)) return null;
  return value as unknown as ArcReconciliationSnapshot;
}

/**
 * Reads recorded engine outputs back defensively.
 *
 * Every nested structure the canonical historical renderers dereference is
 * validated by the versioned decoder for the recording's own engine version,
 * together with the integrity rules a successfully finalized workpaper must
 * satisfy. When the stored row's own metadata is supplied, the row and the
 * snapshot must also agree on the engine and schema versions.
 *
 * Returns null when the recording is missing, structurally unusable or
 * inconsistent with its row; the caller must then fail closed rather than
 * recalculate the inputs with the current engine.
 */
export function readEngineOutputsSnapshot(
  value: unknown,
  expected?: SnapshotMetadata,
): ArcEngineOutputsSnapshot | null {
  if (!isObject(value)) return null;
  if (!matchesMetadata(value, expected)) return null;
  if (!isDecodableEngineOutputs(value, value["engineVersion"] as string)) return null;
  return value as unknown as ArcEngineOutputsSnapshot;
}


/**
 * Client-side readiness only: whether the whole workpaper — five-step
 * analysis, contract balances and the applicable journal output — is complete
 * and reconciled, using exactly the engine conclusions the server checks. The
 * server remains authoritative; this only decides whether the Finalize action
 * is offered.
 */
export function isWorkpaperComplete(workpaper: ArcWorkpaper): boolean {
  const { workflow, balances, journals } = workpaper;
  if (!workflow.finalized || !balances.finalized || !journals) return false;
  if (journals.kind === "grouped") {
    return (
      balances.grouped?.reconciled === true &&
      balances.grouped.groups.every((group) => group.analysis.reconciliation.reconciled === true) &&
      journals.analysis.reconciled === true
    );
  }
  return (
    balances.analysis?.reconciliation.reconciled === true &&
    journals.analysis.reconciliation.reconciled === true
  );
}
